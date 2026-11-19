/**
 * media-generation-kind.ts — generated from shared/media-generation-kind.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/media-generation-kind.ts — 媒体生成任务/产物/deferred 的 kind 映射入口。
 *
 * 集合与能力表（`shared/media-capabilities.ts`）同源，本文件只做派生。
 * 任务类别（持久）：image / video / speech / 音频生成的各 type。
 * 产物 kind：image / video / audio。
 * 后台 deferred 类型：image-generation / video-generation / audio-generation。
 *
 * 注意：kind "audio" 指语音合成与音频生成的产物；它与"音频输入 ASR"是不同语义，ASR 不在这里。
 */
import { MEDIA_CAPABILITIES, mediaCapabilityForTaskType } from "./media-capabilities.js";
/** 任务 type → 产物 kind；未知返回 null。 */
export function mediaGenerationKindForTaskType(type) {
    return mediaCapabilityForTaskType(type)?.outputKind ?? null;
}
/** 产物 kind → 后台 deferred 类型；未知返回 null。 */
export function deferredTypeForMediaKind(kind) {
    const entry = MEDIA_CAPABILITIES.find((item) => item.outputKind === kind && item.deferredType);
    return entry?.deferredType ?? null;
}
/** 后台 deferred 类型 → 产物 kind；未知返回 null。 */
export function mediaKindForDeferredType(type) {
    const entry = MEDIA_CAPABILITIES.find((item) => item.deferredType !== null && item.deferredType === type);
    return entry?.outputKind ?? null;
}
/** type guard：是否为已知的媒体生成 deferred 类型。 */
export function isMediaGenerationDeferredType(value) {
    return MEDIA_CAPABILITIES.some((item) => item.deferredType !== null && item.deferredType === value);
}
//# sourceMappingURL=media-generation-kind.js.map