/**
 * media-capabilities.ts — generated from shared/media-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/media-capabilities.ts — 媒体能力的唯一表。
 *
 * 宿主各处（持久化任务映射、入口校验、供应商声明键、generateMedia 别名）只查这一张表；
 * 查不到就报错，不再默认当图片。`shared/media-generation-kind.ts` 的集合由这里派生。
 *
 * 规则：
 * - `audio` 是 speech_recognition 的兼容入口别名（generateMedia 里的 kind "audio" 仍表示
 *   语音识别），不属于 audio_generation。
 * - speech_generation 与 audio_generation 共享 deferred 类型 `audio-generation` 与产物 kind
 *   `audio`：deferred 类型映射到产物 kind，不映射到能力。
 * - 旧任务 type 与旧 deferred 类型照常可读；未知任务 type 的 image/video 包含式推断保留。
 */
export type MediaCapabilityId = "image_generation" | "video_generation" | "speech_generation" | "audio_generation" | "speech_recognition";
export type MediaOutputKind = "image" | "video" | "audio";
export type MediaDeferredType = "image-generation" | "video-generation" | "audio-generation";
export interface MediaCapabilityEntry {
    readonly id: MediaCapabilityId;
    /** 供应商声明里的键，例如 imageGeneration。 */
    readonly declarationKey: string;
    /** 产物种类；语音识别是输入侧，没有产物，为 null。 */
    readonly outputKind: MediaOutputKind | null;
    /** 该能力持久化的任务 type，含旧值。 */
    readonly taskTypes: readonly string[];
    readonly deferredType: MediaDeferredType | null;
    /** generateMedia / 工具入口接受的别名（不含 id 与 declarationKey，二者总是被接受）。 */
    readonly entryAliases: readonly string[];
}
export declare const MEDIA_CAPABILITIES: readonly MediaCapabilityEntry[];
/** 按 id、声明键或入口别名查能力；查不到返回 null。 */
export declare function resolveMediaCapability(value: unknown): MediaCapabilityEntry | null;
/** 同 resolveMediaCapability，但查不到时抛错，错误信息带原始值。 */
export declare function requireMediaCapability(value: unknown): MediaCapabilityEntry;
/**
 * 持久化任务 type → 能力。精确匹配任务类型表；查不到时保留既有的包含式推断
 * （含 "video" 归视频，含 "image" 归图片），以便读取旧任务。仍查不到返回 null。
 */
export declare function mediaCapabilityForTaskType(type: unknown): MediaCapabilityEntry | null;
//# sourceMappingURL=media-capabilities.d.ts.map