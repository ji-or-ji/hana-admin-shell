/**
 * media-guide.ts — generated from shared/media-guide.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/media-guide.ts — 媒体写法指南（guide）的唯一校验入口。
 *
 * 指南挂在「供应商 + 能力」或「模型」上，只写怎么写，面向 Agent。宿主在注册、
 * App 写入模型、App manifest 读取三处都经这里校验，上限与报错口径一致。
 */
export declare const MEDIA_GUIDE_MAX_BYTES = 8192;
export interface MediaGuide {
    readonly body: string;
    readonly source?: string;
}
/**
 * 校验并拷贝一份指南。`label` 说明它属于哪个供应商、能力或模型，只用于报错。
 * body 必须是非空字符串，UTF-8 不超过 8192 字节；source 可选，但给出时必须是字符串。
 * 未知字段直接拒绝，不静默丢弃。
 */
export declare function normalizeMediaGuide(raw: unknown, label: string): MediaGuide;
//# sourceMappingURL=media-guide.d.ts.map