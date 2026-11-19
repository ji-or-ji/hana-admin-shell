/**
 * lib/tools.js — 五个工具 + 输入栏状态镜像。
 *
 * open/exec/close/status 是主链路，toggle 挂在输入栏按钮上。
 * 输入栏那行字是宿主的覆盖层，不会自己走，所以这里有个 30 秒的镜像定时器：
 * 该变的时候变，该消失的时候消失。
 */
import os from "node:os";

const MAX_TEXT = 12000;
const STATUS_INTERVAL_MS = 30000;

function text(body) {
  return { content: [{ type: "text", text: body }] };
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function trim(textValue, limit = MAX_TEXT) {
  const s = String(textValue ?? "");
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}\n…（后面还有 ${s.length - limit} 字符，已截断）`;
}

function leftMs(lease) {
  return Math.min(lease.expiresAt, lease.hardExpiresAt) - Date.now();
}

function leftText(lease) {
  const ms = leftMs(lease);
  if (!Number.isFinite(ms)) return "?";
  if (ms <= 0) return "已到期";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

function clock(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function stamp(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(ts);
  }
}

async function resolveIdentity(sdk, context = {}) {
  const identity = {
    sessionId: context.sessionId || null,
    sessionPath: context.sessionPath || null,
    agentId: context.agentId || null,
    sessionTitle: context.sessionTitle || null,
  };
  if (!identity.sessionId && identity.sessionPath) {
    try {
      const snapshot = await sdk.sessions.get({ sessionPath: identity.sessionPath });
      const id = snapshot?.sessionId || snapshot?.id || snapshot?.snapshot?.sessionId;
      if (id) identity.sessionId = id;
      if (!identity.agentId && snapshot?.agentId) identity.agentId = snapshot.agentId;
      if (!identity.sessionTitle && snapshot?.title) identity.sessionTitle = snapshot.title;
    } catch {
      /* 拿不到就只用 sessionPath 做键 */
    }
  }
  return identity;
}

/**
 * 输入栏那行字的镜像：宿主的覆盖层是快照，不刷新就会一直停在旧数字上。
 * 这里统一管「该显示什么」和「该消失了」。
 */
export function createStatusMirror(sdk, book) {
  const shown = new Set();
  const canWrite = Boolean(sdk.inputStatus);

  async function apply(lease) {
    if (!canWrite || !lease?.sessionId) return;
    const ms = leftMs(lease);
    if (!Number.isFinite(ms) || ms <= 0) return;
    const mins = Math.floor(ms / 60000);
    const label = mins >= 1 ? `管理员 · 剩 ${mins} 分` : "管理员 · 不到 1 分";
    try {
      await sdk.inputStatus.set({
        sessionId: lease.sessionId,
        id: "admin",
        text: label,
        tooltip: `本会话握着一个管理员窗口，还剩 ${leftText(lease)}。点一下结束它`,
        visible: true,
      });
      shown.add(lease.sessionId);
    } catch {
      /* 输入栏写失败不影响功能 */
    }
  }

  async function clear(sessionId) {
    if (!canWrite || !sessionId) return;
    try {
      await sdk.inputStatus.remove({ sessionId, id: "admin" });
    } catch { }
    shown.delete(sessionId);
  }

  /** 单个会话对齐一次 */
  async function syncFor(identity) {
    const lease = book.find(identity);
    if (lease) await apply(lease);
    else if (identity?.sessionId) await clear(identity.sessionId);
  }

  /** 全量对齐：删掉过期的，补上还在的，清掉已经不该显示的 */
  async function syncAll() {
    book.prune();
    const live = new Map();
    for (const lease of book.list()) {
      if (lease.sessionId) live.set(lease.sessionId, lease);
    }
    for (const lease of live.values()) await apply(lease);
    for (const sid of [...shown]) {
      if (!live.has(sid)) await clear(sid);
    }
  }

  function start(intervalMs = STATUS_INTERVAL_MS) {
    void syncAll();
    const timer = setInterval(() => {
      void syncAll();
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  return { syncFor, syncAll, start };
}

export async function registerTools(sdk, book, channel, settings, mirror) {
  const version = settings.version || "0";

  async function openFor(identity, { idleMinutes, maxLifeMinutes } = {}) {
    const idle = clampNum(idleMinutes, 1, 720, book.defaultIdleMinutes);
    const maxLife = clampNum(maxLifeMinutes, 1, 1440, book.defaultMaxLifeMinutes);
    // 先把租约写下去：提权进程启动后十秒内看不到租约就会自己退
    const lease = book.open(identity, { idleMinutes: idle, maxLifeMinutes: maxLife });
    channel.writeLease({ sessions: book.channelSessions() });
    try {
      const result = await channel.ensure({
        idleTimeoutSec: idle * 60,
        maxLifeSec: Math.max(60, Math.floor((lease.hardExpiresAt - Date.now()) / 1000)),
        version,
      });
      channel.writeLease({ sessions: book.channelSessions() });
      await mirror.syncFor(identity);
      return { lease, result };
    } catch (err) {
      // 没开成（UAC 被取消）就把租约撤掉，别留一个假的「握着窗口」
      book.close(identity);
      channel.writeLease({ sessions: book.channelSessions() });
      await mirror.syncFor(identity);
      throw err;
    }
  }

  // ── open ───────────────────────────────────────────────────────────────
  await sdk.tools.register({
    name: "admin_open",
    description:
      "给当前会话开一个带有效期的管理员（提权）窗口。首次会在屏幕上弹一次 UAC 确认框，"
      + "必须有人点「是」；之后就由后台隐藏进程接管，不再打扰。开着的时候用 admin_exec 执行需要管理员权限的命令，"
      + "admin_close 收掉。闲置到期或到达硬上限时窗口自己关掉。",
    parameters: {
      type: "object",
      properties: {
        idleMinutes: {
          type: "number",
          description: "闲置多少分钟后自动关闭；每执行一条命令就重新计时。默认 30",
        },
        maxLifeMinutes: {
          type: "number",
          description: "这一次开通最多活多久（从开通算起，不因续期延长）。默认 240",
        },
      },
    },
    sessionPermission: { kind: "external_side_effect" },
    execute: async (args) => {
      const identity = await resolveIdentity(sdk, args?.context);
      const { lease, result } = await openFor(identity, {
        idleMinutes: args?.idleMinutes,
        maxLifeMinutes: args?.maxLifeMinutes,
      });
      const lines = [
        result.reused ? "管理员窗口已经在跑，本会话直接接上。" : "管理员窗口已打开。",
        `身份：${result.elevated ? "已提权（管理员）" : "未提权（这一层没拿到管理员权限）"} · PID ${result.pid ?? "?"}`,
        `闲置 ${lease.idleMinutes} 分钟后自动关；本次最晚 ${stamp(lease.hardExpiresAt)} 收工（还剩 ${leftText(lease)}）。`,
        "接下来需要管理员权限的命令走 admin_exec。",
      ];
      return text(lines.join("\n"));
    },
  });

  // ── exec ───────────────────────────────────────────────────────────────
  await sdk.tools.register({
    name: "admin_exec",
    description:
      "在管理员窗口里执行一条命令，返回退出码、stdout、stderr。需要先用 admin_open 给这个会话开窗口；"
      + "窗口没开或已到期会直接报错，不会自己偷偷弹 UAC。适合装服务、改系统设置、动 Program Files、"
      + "看管理员才能读的注册表之类。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令；多行也可以" },
        shell: {
          type: "string",
          enum: ["auto", "cmd", "powershell"],
          description: "用哪个壳执行，默认 auto（看命令长相挑）",
        },
        cwd: { type: "string", description: "工作目录，默认用户主目录" },
        timeoutSec: { type: "number", description: "超时秒数，默认 120，最多 3600" },
      },
      required: ["command"],
    },
    sessionPermission: { kind: "external_side_effect" },
    execute: async (args) => {
      const identity = await resolveIdentity(sdk, args?.context);
      const lease = book.find(identity);
      if (!lease) {
        return text("这个会话还没有管理员窗口。先调 admin_open（会弹一次 UAC），然后用 admin_exec 执行命令。");
      }
      if (!channel.isAlive()) {
        book.close(identity);
        await mirror.syncFor(identity);
        return text("管理员窗口已经关掉了（到期或被杀）。需要的话重新 admin_open，会再弹一次 UAC。");
      }

      const started = Date.now();
      const result = await channel.exec({
        command: args?.command,
        shell: args?.shell || "auto",
        cwd: args?.cwd || os.homedir(),
        timeoutSec: args?.timeoutSec || settings.defaultTimeoutSec || 120,
        sessionKey: lease.key,
      });

      book.touch(identity);
      channel.writeLease({ sessions: book.channelSessions() });
      await mirror.syncFor(identity);

      const head = [
        `[admin] exit=${result.exitCode ?? "?"}${result.timedOut ? " · 超时被终止" : ""}`
          + ` · ${result.durationMs ?? Date.now() - started}ms`
          + ` · ${result.shell}`
          + ` · ${result.cwd || ""}`,
        result.error ? `启动错误：${result.error}` : null,
      ].filter(Boolean);
      const body = [...head];
      const stdout = trim(result.stdout);
      const stderr = trim(result.stderr);
      body.push(stdout.trim() ? `stdout:\n${stdout.replace(/\s+$/, "")}` : "stdout: （空）");
      if (stderr.trim()) body.push(`stderr:\n${stderr.replace(/\s+$/, "")}`);
      return text(body.join("\n"));
    },
  });

  // ── close ──────────────────────────────────────────────────────────────
  await sdk.tools.register({
    name: "admin_close",
    description:
      "结束管理员窗口。默认只交还当前会话手里的那份；all=true 时不管谁开的，整个窗口收掉。"
      + "所有会话都交还后守护进程自己退出。",
    parameters: {
      type: "object",
      properties: {
        all: { type: "boolean", description: "连别的会话一起收掉" },
      },
    },
    sessionPermission: { kind: "external_side_effect" },
    execute: async (args) => {
      const identity = await resolveIdentity(sdk, args?.context);
      if (args?.all) {
        book.clearAll();
        const closed = await channel.close();
        await mirror.syncAll();
        return text(closed.alreadyClosed ? "本来就没有开着的管理员窗口。" : "管理员窗口已收掉（所有会话）。");
      }
      const existed = book.close(identity);
      const left = book.list();
      if (!left.length) {
        const closed = await channel.close();
        await mirror.syncFor(identity);
        return text(
          existed
            ? `本会话已交还管理员窗口${closed.alreadyClosed ? "（守护进程本来就不在了）" : "，没有别的会话在用，窗口已关闭"}。`
            : "本会话本来就没有管理员窗口；现在也没有别的会话在用，守护进程已撤。",
        );
      }
      channel.writeLease({ sessions: book.channelSessions() });
      await mirror.syncFor(identity);
      return text(
        `${existed ? "本会话已交还管理员窗口。" : "本会话本来就没有管理员窗口。"}`
          + `还有 ${left.length} 个会话在用，窗口继续留着。`,
      );
    },
  });

  // ── status ─────────────────────────────────────────────────────────────
  await sdk.tools.register({
    name: "admin_status",
    description: "看管理员窗口现在是什么状态：是否开着、PID、哪些会话握着、各自还剩多久、最近跑过什么。",
    parameters: {
      type: "object",
      properties: {
        audit: { type: "number", description: "顺便回最近多少条审计记录，默认 10，最多 50" },
      },
    },
    sessionPermission: { readOnly: true },
    execute: async (args) => {
      const identity = await resolveIdentity(sdk, args?.context);
      const state = channel.describe();
      const leases = book.list();
      const mine = book.find(identity);
      const lines = [];
      lines.push(state.alive
        ? `管理员窗口：在跑 · PID ${state.pid} · ${state.elevated ? "已提权" : "未提权"} · 已执行 ${state.processed} 条`
        : `管理员窗口：没开（${state.reason}）`);
      if (state.alive && state.hardDeadline) {
        lines.push(`守护进程最晚 ${clock(state.hardDeadline)} 收工（还剩 ${leftText({ expiresAt: state.hardDeadline, hardExpiresAt: state.hardDeadline })}）`);
      }
      lines.push(mine
        ? `本会话：握着，闲置 ${mine.idleMinutes} 分钟后自动释放，剩 ${leftText(mine)}（最晚 ${clock(mine.hardExpiresAt)}）`
        : "本会话：没有管理员窗口");
      if (leases.length) {
        lines.push(`当前握着窗口的会话（${leases.length}）：`);
        for (const item of leases) {
          const label = item.title || item.sessionId || item.sessionPath || item.key;
          lines.push(`- ${label} · 剩 ${leftText(item)}`);
        }
      }
      const auditLimit = clampNum(args?.audit, 0, 50, 10);
      if (auditLimit > 0) {
        const records = channel.readAudit(auditLimit);
        if (records.length) {
          lines.push(`最近 ${records.length} 条审计：`);
          for (const record of records) {
            if (record.event === "exec") lines.push(`- ${stamp(record.t)} 执行 ${String(record.command || "").slice(0, 120)}`);
            else if (record.event === "done") lines.push(`- ${stamp(record.t)} 完成 exit=${record.exitCode}${record.timedOut ? "（超时）" : ""} ${record.durationMs}ms`);
            else lines.push(`- ${stamp(record.t)} ${record.event}${record.reason ? ` · ${record.reason}` : ""}${record.message ? ` · ${record.message}` : ""}`);
          }
        }
      }
      return text(lines.join("\n"));
    },
  });

  // ── toggle（输入栏按钮）────────────────────────────────────────────────
  await sdk.tools.register({
    name: "admin_toggle",
    description: "输入栏那个「管理员」按钮用的一步开关：本会话没窗口就开一个，有就结束它。",
    parameters: { type: "object", properties: {} },
    sessionPermission: { kind: "external_side_effect" },
    execute: async (args) => {
      const identity = await resolveIdentity(sdk, args?.context);
      const lease = book.find(identity);
      if (lease) {
        book.close(identity);
        const left = book.list();
        if (!left.length) await channel.close();
        else channel.writeLease({ sessions: book.channelSessions() });
        await mirror.syncFor(identity);
        return text("本会话的管理员窗口已结束。");
      }
      const { lease: created, result } = await openFor(identity, {});
      return text(
        `${result.reused ? "接上了已有的管理员窗口" : "管理员窗口已打开"}`
          + `（${result.elevated ? "已提权" : "未提权"}，剩 ${leftText(created)}）。`,
      );
    },
  });
}

export { leftText, stamp, clock };
