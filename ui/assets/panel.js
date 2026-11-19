import { hana } from "./sdk.js";

const POLL_MS = 3000;

const el = (id) => document.getElementById(id);

function timeText(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function render(state) {
  const channel = state.channel || {};
  const leases = Array.isArray(state.leases) ? state.leases : [];
  const audit = Array.isArray(state.audit) ? state.audit : [];

  const dot = el("dot");
  const title = el("title");
  const sub = el("sub");

  if (channel.alive) {
    dot.dataset.state = "live";
    title.textContent = channel.elevated ? "管理员窗口在跑" : "窗口在跑，但没提权";
    const bits = [`PID ${channel.pid ?? "?"}`];
    if (channel.processed != null) bits.push(`已执行 ${channel.processed} 条`);
    if (channel.hardDeadline) {
      const left = Math.max(0, channel.hardDeadline - Date.now());
      bits.push(`最晚 ${timeText(channel.hardDeadline)} 收工（剩 ${fmtLeft(left)}）`);
    }
    sub.textContent = bits.join(" · ");
  } else {
    dot.dataset.state = "idle";
    title.textContent = "管理员窗口没开";
    sub.textContent = channel.reason || "需要提权的命令先开一个窗口";
  }

  const leasesBox = el("leases");
  leasesBox.textContent = "";
  if (!leases.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "还没有会话开管理员窗口";
    leasesBox.append(empty);
  } else {
    for (const item of leases) {
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = item.title || shortSession(item.sessionId) || "（未命名会话）";
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `剩 ${item.leftText || fmtLeft(item.leftMs)}`;
      row.append(name, meta);
      leasesBox.append(row);
    }
  }

  const auditBox = el("audit");
  auditBox.textContent = "";
  const lines = audit.slice(-8).reverse();
  if (!lines.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "暂无记录";
    auditBox.append(empty);
  } else {
    for (const rec of lines) {
      const row = document.createElement("div");
      row.className = "row audit";
      const cmd = document.createElement("span");
      cmd.className = "cmd";
      let label = "";
      if (rec.event === "exec") label = rec.command || "";
      else if (rec.event === "done") label = `完成 exit=${rec.exitCode}${rec.timedOut ? "（超时）" : ""} ${rec.durationMs || 0}ms`;
      else if (rec.event === "start") label = "守护进程启动";
      else if (rec.event === "exit") label = `守护进程退出（${rec.reason || "?"}）`;
      else label = rec.message || rec.event || "";
      cmd.textContent = String(label).slice(0, 160);
      const done = rec.event === "done";
      if (done) cmd.classList.add(rec.exitCode === 0 ? "ok" : "bad");
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = timeText(rec.t);
      row.append(cmd, meta);
      auditBox.append(row);
    }
  }

  el("foot").textContent =
    "窗口由提权守护进程持有，闲置超时或到达硬上限会自己关。每条命令都记在审计里；"
    + "要收掉它，在会话里让 agent 执行 admin_close，或右键会话选「结束本会话的管理员窗口」。";
}

function shortSession(id) {
  if (!id) return "";
  const parts = String(id).split("_");
  return parts.length > 1 ? `会话 ${parts[1]}` : String(id).slice(0, 10);
}

function fmtLeft(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "已到期";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

let busy = false;

async function load() {
  if (busy) return;
  busy = true;
  try {
    // 必须走 hana.api.fetch：原生 fetch 不带 appSurfaceSession，会被 403 挡住
    const res = await hana.api.fetch(`state?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
  } catch (err) {
    el("dot").dataset.state = "dead";
    el("title").textContent = "读不到通道状态";
    el("sub").textContent = String(err?.message || err);
  } finally {
    busy = false;
  }
}

el("refresh").addEventListener("click", () => {
  void load();
});

async function boot() {
  try {
    await hana.ready?.();
  } catch { }
  await load();
  setInterval(load, POLL_MS);
}

void boot();
