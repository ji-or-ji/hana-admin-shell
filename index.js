/**
 * index.js — 管理员通道 v2 入口。
 *
 * 三件事：注册工具、把设置读进来、给状态卡开一条只读 route。
 * 提权进程的一切都在 runtime/admin-agent.ps1 里，通过 lib/channel.js 的文件队列说话。
 */
import { defineApp } from "./sdk/app-contract/server-client.js";
import { AdminChannel } from "./lib/channel.js";
import { LeaseBook } from "./lib/leases.js";
import { registerTools, createStatusMirror, leftText, stamp } from "./lib/tools.js";

const APP_VERSION = "0.1.0";

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

export default defineApp(async (sdk) => {
  const channel = new AdminChannel(sdk);
  const book = new LeaseBook(sdk, { idleMinutes: 30, maxLifeMinutes: 240 });
  const mirror = createStatusMirror(sdk, book);
  const settings = { version: APP_VERSION, defaultTimeoutSec: 120 };

  await registerTools(sdk, book, channel, settings, mirror);

  // 状态卡读的这条 route：只读，不改任何东西
  try {
    await sdk.routes.register((app) => {
      app.get("/state", (c) => {
        const state = channel.describe();
        const leases = book.list();
        return c.json({
          channel: state,
          leases: leases.map((item) => ({
            title: item.title || item.sessionId || item.sessionPath,
            sessionId: item.sessionId,
            sessionPath: item.sessionPath,
            openedAt: item.openedAt,
            lastUsedAt: item.lastUsedAt,
            expiresAt: item.expiresAt,
            hardExpiresAt: item.hardExpiresAt,
            idleMinutes: item.idleMinutes,
            leftMs: Math.max(0, Math.min(item.expiresAt, item.hardExpiresAt) - Date.now()),
            leftText: leftText(item),
            openedText: stamp(item.openedAt),
          })),
          audit: channel.readAudit(20),
          serverNow: Date.now(),
        });
      });
    });
  } catch (err) {
    try { await sdk.logger.error(`路由注册失败：${err?.message || err}`); } catch { }
  }

  await sdk.logger.info("管理员通道已加载");

  // 设置要等 apply 落定才读得到
  const kickoff = setTimeout(async () => {
    try {
      const cfg = (await sdk.config.getAll()) || {};
      book.defaultIdleMinutes = num(cfg.idleMinutes, 30, 1, 720);
      book.defaultMaxLifeMinutes = num(cfg.maxLifeMinutes, 240, 1, 1440);
      settings.defaultTimeoutSec = num(cfg.defaultTimeoutSec, 120, 5, 3600);

      // 输入栏的贡献要等 apply 落定才登记，太早调用会被“没有声明这个 item”拒掉
      mirror.start();

      // Hana 重启后租约还在：把心跳续上，别让后台窗口以为没人了
      const alive = channel.describe();
      if (alive.alive) {
        const leases = book.list();
        if (leases.length) {
          channel.writeLease({ sessions: book.channelSessions() });
          await sdk.logger.info(`管理员通道还在，${leases.length} 个会话握着它`);
        } else {
          // 没有租约却还活着：让它自己看到过期后退出
          channel.writeLease({ sessions: [] });
        }
      } else if (book.list().length) {
        // 记着租约但进程没了（重启电脑之类），清掉，别让状态卡说谎
        book.clearAll();
      }
    } catch (err) {
      try { await sdk.logger.error(`读取设置失败：${err?.message || err}`); } catch { }
    }
  }, 3000);
  kickoff.unref?.();
});
