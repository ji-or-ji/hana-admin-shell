/**
 * lib/channel.js — 管理员通道。
 *
 * 一个提权守护进程（runtime/admin-agent.ps1）在后台等着，App 通过一个文件队列
 * 给它派命令。App 进程本身永远不提权，也永远不碰网络。
 *
 * 目录布局（都在 App 的 dataDir 下）：
 *   channel/req/        App 写请求
 *   channel/res/        守护进程写结果
 *   channel/tmp/        临时脚本
 *   channel/state.json  守护进程心跳
 *   channel/lease.json  App 写租约
 *   channel/meta.json   App 写的通道元信息（token、版本）
 *   channel/stop        结束信号
 *   channel/audit.log   审计
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const AGENT_PS1 = path.join(PKG_ROOT, "runtime", "admin-agent.ps1");

// 心跳 15 秒一跳（守护进程侧），这里留三倍宽容，免得偶尔的磁盘繁忙被误判成死了
const HEARTBEAT_STALE_MS = 45000;
const LAUNCH_TIMEOUT_MS = 120000;
const POLL_MS = 120;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.rmSync(file, { force: true });
    } catch { }
    fs.renameSync(tmp, file);
  }
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 把一个 PowerShell 命令串以 -EncodedCommand 形式交给 powershell.exe，绕开所有引号问题 */
function spawnPowerShell(encodedCommand) {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
      { windowsHide: true, stdio: "ignore" },
    );
    child.on("error", (err) => resolve({ code: -1, error: err.message }));
    child.on("exit", (code) => resolve({ code: code ?? -1 }));
  });
}

function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

export class AdminChannel {
  constructor(sdk, options = {}) {
    this.sdk = sdk;
    this.root = path.join(sdk.dataDir, "channel");
    this.reqDir = path.join(this.root, "req");
    this.resDir = path.join(this.root, "res");
    this.tmpDir = path.join(this.root, "tmp");
    this.statePath = path.join(this.root, "state.json");
    this.leasePath = path.join(this.root, "lease.json");
    this.metaPath = path.join(this.root, "meta.json");
    this.stopPath = path.join(this.root, "stop");
    this.auditPath = path.join(this.root, "audit.log");
    this.options = options;
    this.seq = 0;
    this.queue = Promise.resolve();
    ensureDir(this.reqDir);
    ensureDir(this.resDir);
    ensureDir(this.tmpDir);
  }

  // ------------------------------------------------------------ 状态读取

  readMeta() {
    return readJson(this.metaPath) || {};
  }

  readState() {
    return readJson(this.statePath);
  }

  /**
   * 通道现状。alive 只看进程标记和身份，心跳只用来区分“空闲”与“可能忙着”。
   * 执行长命令时守护进程是阻塞的，不会写心跳，所以不能把“心跳陈旧”当成“已经死了”。
   */
  describe() {
    const state = this.readState();
    const meta = this.readMeta();
    if (!state || !state.alive) {
      return {
        alive: false,
        reason: state?.exitReason ? `上一次窗口已结束（${state.exitReason}）` : "还没有管理员窗口",
      };
    }
    const sameToken = !meta.token || state.token === meta.token;
    if (!sameToken) return { alive: false, reason: "通道身份对不上" };
    const fresh = Date.now() - (state.lastBeatAt || 0) < HEARTBEAT_STALE_MS;
    return {
      alive: true,
      stale: !fresh,
      pid: state.pid,
      elevated: Boolean(state.elevated),
      user: state.user,
      startedAt: state.startedAt,
      lastBeatAt: state.lastBeatAt,
      hardDeadline: state.hardDeadline,
      processed: state.processed ?? 0,
      exitReason: null,
    };
  }

  isAlive() {
    return this.describe().alive;
  }

  // ------------------------------------------------------------ 启动提权

  /**
   * 确保一个提权守护进程在跑。没有就弹一次 UAC 拉起来。
   * @returns {Promise<{reused:boolean,pid?:number,elevated?:boolean}>}
   */
  async ensure({ idleTimeoutSec, maxLifeSec, version } = {}) {
    const existing = this.describe();
    if (existing.alive) {
      return { reused: true, pid: existing.pid, elevated: existing.elevated };
    }

    // 上一轮的残留：能收就收，收不掉（高完整性进程普通权限杀不了）就写 stop 请它自己走
    const stale = this.readState();
    if (stale?.alive) {
      try {
        fs.writeFileSync(this.stopPath, "", "utf8");
      } catch { }
      for (let i = 0; i < 15; i++) {
        await sleep(200);
        const s = this.readState();
        if (!s || !s.alive) break;
      }
      try {
        fs.rmSync(this.stopPath, { force: true });
      } catch { }
    }

    this.resetDirs();

    const token = randomBytes(18).toString("hex");
    writeJson(this.metaPath, { token, version: version || "0", createdAt: Date.now() });

    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      AGENT_PS1,
      "-Root",
      this.root,
      "-IdleTimeoutSec",
      String(idleTimeoutSec ?? 1800),
      "-MaxLifeSec",
      String(maxLifeSec ?? 14400),
      "-Token",
      token,
      "-AppVersion",
      String(version || "0"),
    ];
    const argList = args
      .map((a) => (/[\s"]/.test(a) ? `'"${a.replace(/"/g, '""')}"'` : `'${a}'`))
      .join(",");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$argList = @(${argList})`,
      "Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs -WindowStyle Hidden",
    ].join("; ");

    const launcher = await spawnPowerShell(encodePowerShell(script));
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(250);
      const state = this.readState();
      if (state?.alive && state.token === token) {
        return { reused: false, pid: state.pid, elevated: Boolean(state.elevated) };
      }
      if (launcher.code !== 0) {
        // 启动器已经退了（通常是 UAC 被取消或拒绝）
        await sleep(400);
        const again = this.readState();
        if (again?.alive && again.token === token) {
          return { reused: false, pid: again.pid, elevated: Boolean(again.elevated) };
        }
        throw new Error(
          launcher.error
            ? `拉起提权进程失败：${launcher.error}`
            : "提权被取消。屏幕上会出现一次 UAC 确认框，需要点「是」才开得起来。",
        );
      }
    }
    throw new Error("等了两分钟还没看到管理员窗口就绪，可能 UAC 没点确认。");
  }

  resetDirs() {
    for (const dir of [this.reqDir, this.resDir, this.tmpDir]) {
      try {
        for (const name of fs.readdirSync(dir)) {
          try {
            fs.rmSync(path.join(dir, name), { force: true, recursive: true });
          } catch { }
        }
      } catch { }
    }
    for (const f of [this.statePath, this.leasePath]) {
      try {
        fs.rmSync(f, { force: true });
      } catch { }
    }
  }

  // ------------------------------------------------------------ 租约

  /**
   * 把租约视图写给守护进程。sessions 为空就是“没人用了”，它会自己退场。
   * @param {{sessions: Array<{key:string, expiresAt:number}>}} payload
   */
  writeLease({ sessions } = {}) {
    const now = Date.now();
    const active = Array.isArray(sessions) ? sessions.filter((s) => s && s.expiresAt > now) : [];
    const furthest = active.length ? Math.max(...active.map((s) => s.expiresAt)) : now - 1;
    writeJson(this.leasePath, {
      expiresAt: furthest,
      hardExpiresAt: furthest,
      sessions: active,
      updatedAt: now,
    });
  }

  // ------------------------------------------------------------ 执行

  /**
   * 在提权上下文里跑一条命令。
   * @param {{command:string, cwd?:string, shell?:string, timeoutSec?:number, sessionKey?:string}} req
   */
  async exec(req) {
    const state = this.describe();
    if (!state.alive) throw new Error("管理员窗口没在跑，先调用 admin_open");

    const run = async () => {
      this.seq = (this.seq + 1) % 1000000;
      const id = `${Date.now().toString(36)}${this.seq.toString(36)}${randomBytes(3).toString("hex")}`;
      const timeoutSec = Math.min(Math.max(Number(req.timeoutSec) || 120, 1), 3600);
      const payload = {
        id,
        command: String(req.command ?? ""),
        cwd: req.cwd || os.homedir(),
        shell: req.shell || "auto",
        timeoutSec,
        sessionPath: req.sessionKey || "",
        requestedAt: Date.now(),
      };
      const name = `${String(Date.now()).padStart(15, "0")}-${id}.json`;
      writeJson(path.join(this.reqDir, name), payload);

      const deadline = Date.now() + (timeoutSec + 90) * 1000;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        const resFile = path.join(this.resDir, `${id}.json`);
        if (fs.existsSync(resFile)) {
          const result = readJson(resFile);
          try {
            fs.rmSync(resFile, { force: true });
          } catch { }
          if (!result) throw new Error("管理员窗口返回的结果读不出来");
          return result;
        }
        // 长命令跑着的时候守护进程不写心跳，所以这里只看 alive 标记，
        // 不能用 describe()（它会把“正在忙”误判成“死了”）
        const now = this.readState();
        if (!now || !now.alive) throw new Error("执行过程中管理员窗口掉了");
      }
      throw new Error("等管理员窗口回话超时");
    };

    const task = this.queue.then(run, run);
    this.queue = task.catch(() => { });
    return task;
  }

  /** 拉一段审计日志（最近的） */
  readAudit(limit = 40) {
    try {
      const raw = fs.readFileSync(this.auditPath, "utf8").replace(/^\uFEFF/, "");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const tail = lines.slice(-Math.max(1, limit));
      return tail
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { event: "raw", line };
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** 结束这个管理员窗口 */
  async close() {
    const state = this.readState();
    if (!state?.alive) {
      this.resetDirs();
      return { alreadyClosed: true };
    }
    try {
      fs.writeFileSync(this.stopPath, "", "utf8");
    } catch { }
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      const s = this.readState();
      if (!s || !s.alive) break;
    }
    const after = this.readState();
    const stopped = !after?.alive;
    try {
      fs.rmSync(this.stopPath, { force: true });
    } catch { }
    this.resetDirs();
    return { alreadyClosed: false, stopped, exitReason: after?.exitReason ?? null };
  }
}
