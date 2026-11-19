/**
 * lib/leases.js — 哪个会话还握着管理员窗口。
 *
 * 每次开通记一条租约，执行命令即续期；闲置到期或硬上限到达就作废。
 * 全部作废时通道自己会退场（守护进程读 lease.json）。
 */
import fs from "node:fs";
import path from "node:path";

const FILE_VERSION = 1;

export class LeaseBook {
  constructor(sdk, options = {}) {
    this.file = path.join(sdk.dataDir, "leases.json");
    this.defaultIdleMinutes = options.idleMinutes ?? 30;
    this.defaultMaxLifeMinutes = options.maxLifeMinutes ?? 240;
    this.items = new Map();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, "utf8").replace(/^\uFEFF/, "");
      const data = JSON.parse(raw);
      const list = Array.isArray(data?.leases) ? data.leases : [];
      for (const item of list) {
        if (!item?.key) continue;
        this.items.set(item.key, item);
      }
    } catch {
      /* 没有就是空的 */
    }
    this.prune();
  }

  save() {
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, leases: [...this.items.values()] }), "utf8");
      try {
        fs.renameSync(tmp, this.file);
      } catch {
        fs.rmSync(this.file, { force: true });
        fs.renameSync(tmp, this.file);
      }
    } catch {
      /* 写不进去也不该让工具挂掉 */
    }
  }

  static keyOf(identity = {}) {
    if (identity.sessionId) return `id:${identity.sessionId}`;
    if (identity.sessionPath) return `path:${identity.sessionPath}`;
    return null;
  }

  static describeOf(identity = {}) {
    const parts = [];
    if (identity.sessionTitle) parts.push(String(identity.sessionTitle));
    if (identity.agentId) parts.push(String(identity.agentId));
    return parts.join(" · ");
  }

  prune(now = Date.now()) {
    let changed = false;
    for (const [key, item] of this.items) {
      const expired = (item.expiresAt && item.expiresAt <= now) || (item.hardExpiresAt && item.hardExpiresAt <= now);
      if (expired) {
        this.items.delete(key);
        changed = true;
      }
    }
    if (changed) this.save();
    return changed;
  }

  /**
   * 按身份找租约。同一个会话可能先以 sessionPath 为键记下、后来才学到 sessionId，
   * 两边都要能对上。
   */
  find(identity = {}) {
    this.prune();
    if (identity.sessionId) {
      const direct = this.items.get(`id:${identity.sessionId}`);
      if (direct) return direct;
    }
    if (identity.sessionPath) {
      const direct = this.items.get(`path:${identity.sessionPath}`);
      if (direct) return direct;
      for (const item of this.items.values()) {
        if (item.sessionPath && item.sessionPath === identity.sessionPath) return item;
      }
    }
    if (identity.sessionId) {
      for (const item of this.items.values()) {
        if (item.sessionId && item.sessionId === identity.sessionId) return item;
      }
    }
    return null;
  }

  get(key) {
    if (!key) return null;
    this.prune();
    return this.items.get(key) || null;
  }

  /**
   * 开通或续期。已有租约时保留最初的 hardExpiresAt，不因为反复调用把窗口续成永久。
   */
  open(identity, overrides = {}) {
    if (!LeaseBook.keyOf(identity)) throw new Error("拿不到会话身份，开不了管理员窗口");
    this.prune();
    const now = Date.now();
    const idleMinutes = clamp(overrides.idleMinutes ?? this.defaultIdleMinutes, 1, 720);
    const maxLifeMinutes = clamp(overrides.maxLifeMinutes ?? this.defaultMaxLifeMinutes, 1, 1440);
    const existing = this.find(identity);
    // 优先用 id 键：学到 sessionId 之后就把 path 键那条并过来，免得一个会话两条租约
    const key = identity.sessionId ? `id:${identity.sessionId}` : (existing?.key || LeaseBook.keyOf(identity));
    const hardExpiresAt = existing?.hardExpiresAt && existing.hardExpiresAt > now
      ? existing.hardExpiresAt
      : now + maxLifeMinutes * 60000;
    const item = {
      key,
      sessionId: identity.sessionId || existing?.sessionId || null,
      sessionPath: identity.sessionPath || existing?.sessionPath || null,
      agentId: identity.agentId || existing?.agentId || null,
      title: LeaseBook.describeOf(identity) || existing?.title || "",
      openedAt: existing?.openedAt || now,
      lastUsedAt: now,
      expiresAt: Math.min(now + idleMinutes * 60000, hardExpiresAt),
      hardExpiresAt,
      idleMinutes,
      maxLifeMinutes,
    };
    if (existing && existing.key !== key) this.items.delete(existing.key);
    this.items.set(key, item);
    this.save();
    return item;
  }

  /**
   * 每次执行命令后续期。
   * @returns {object|null} 现在的租约，过期就是 null
   */
  touch(identity) {
    const item = this.find(identity);
    if (!item) return null;
    const now = Date.now();
    item.lastUsedAt = now;
    item.expiresAt = Math.min(now + (item.idleMinutes ?? this.defaultIdleMinutes) * 60000, item.hardExpiresAt);
    if (identity.sessionId && !item.sessionId) item.sessionId = identity.sessionId;
    if (identity.sessionPath && !item.sessionPath) item.sessionPath = identity.sessionPath;
    this.items.set(item.key, item);
    this.save();
    return item;
  }

  close(identity) {
    const item = this.find(identity);
    if (!item) return false;
    const existed = this.items.delete(item.key);
    if (existed) this.save();
    return existed;
  }

  clearAll() {
    this.items.clear();
    this.save();
  }

  list() {
    this.prune();
    return [...this.items.values()].sort((a, b) => a.openedAt - b.openedAt);
  }

  /** 给通道的租约视图 */
  channelSessions() {
    return this.list().map((item) => ({ key: item.key, expiresAt: Math.min(item.expiresAt, item.hardExpiresAt) }));
  }

  /** 最长还能活多久（毫秒），用于守护进程的硬上限 */
  hardestDeadline() {
    const list = this.list();
    if (!list.length) return 0;
    return Math.max(...list.map((item) => item.hardExpiresAt || 0));
  }
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.round(n), min), max);
}
