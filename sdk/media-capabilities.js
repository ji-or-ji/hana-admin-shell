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
export const MEDIA_CAPABILITIES = Object.freeze([
    {
        id: "image_generation",
        declarationKey: "imageGeneration",
        outputKind: "image",
        taskTypes: Object.freeze(["image", "text2image", "image2image"]),
        deferredType: "image-generation",
        entryAliases: Object.freeze(["image", "image_generation", "imageGeneration"]),
    },
    {
        id: "video_generation",
        declarationKey: "videoGeneration",
        outputKind: "video",
        taskTypes: Object.freeze([
            "video",
            "text2video",
            "image2video",
            "frames2video",
            "multiframe2video",
            "multimodal2video",
        ]),
        deferredType: "video-generation",
        entryAliases: Object.freeze(["video", "video_generation", "videoGeneration"]),
    },
    {
        id: "speech_generation",
        declarationKey: "speechGeneration",
        outputKind: "audio",
        taskTypes: Object.freeze(["speech"]),
        deferredType: "audio-generation",
        entryAliases: Object.freeze(["speech", "speech_generation", "speechGeneration"]),
    },
    {
        id: "audio_generation",
        declarationKey: "audioGeneration",
        outputKind: "audio",
        taskTypes: Object.freeze(["text2audio", "audio2audio", "image2audio", "text2music", "lyrics2song"]),
        deferredType: "audio-generation",
        // 不含裸 `audio`：它是语音识别的兼容入口别名。
        entryAliases: Object.freeze(["audio_generation", "audioGeneration"]),
    },
    {
        id: "speech_recognition",
        declarationKey: "speechRecognition",
        outputKind: null,
        taskTypes: Object.freeze([]),
        deferredType: null,
        entryAliases: Object.freeze(["speech_recognition", "speechRecognition", "transcription", "asr", "audio"]),
    },
]);
const ENTRY_BY_TOKEN = new Map();
for (const entry of MEDIA_CAPABILITIES) {
    for (const token of [entry.id, entry.declarationKey, ...entry.entryAliases]) {
        const existing = ENTRY_BY_TOKEN.get(token);
        if (existing && existing !== entry) {
            throw new Error(`media capability token "${token}" is claimed by two capabilities`);
        }
        ENTRY_BY_TOKEN.set(token, entry);
    }
}
const ENTRY_BY_TASK_TYPE = new Map();
for (const entry of MEDIA_CAPABILITIES) {
    for (const type of entry.taskTypes) {
        if (ENTRY_BY_TASK_TYPE.has(type)) {
            throw new Error(`media task type "${type}" is claimed by two capabilities`);
        }
        ENTRY_BY_TASK_TYPE.set(type, entry);
    }
}
const IMAGE_ENTRY = requireEntry("image_generation");
const VIDEO_ENTRY = requireEntry("video_generation");
function requireEntry(id) {
    const entry = MEDIA_CAPABILITIES.find((item) => item.id === id);
    if (!entry)
        throw new Error(`media capability table is missing ${id}`);
    return entry;
}
/** 按 id、声明键或入口别名查能力；查不到返回 null。 */
export function resolveMediaCapability(value) {
    if (typeof value !== "string")
        return null;
    return ENTRY_BY_TOKEN.get(value.trim()) ?? null;
}
/** 同 resolveMediaCapability，但查不到时抛错，错误信息带原始值。 */
export function requireMediaCapability(value) {
    const entry = resolveMediaCapability(value);
    if (!entry)
        throw new Error(`unknown media capability: ${String(value)}`);
    return entry;
}
/**
 * 持久化任务 type → 能力。精确匹配任务类型表；查不到时保留既有的包含式推断
 * （含 "video" 归视频，含 "image" 归图片），以便读取旧任务。仍查不到返回 null。
 */
export function mediaCapabilityForTaskType(type) {
    const value = typeof type === "string" ? type.trim().toLowerCase() : "";
    if (!value)
        return null;
    const exact = ENTRY_BY_TASK_TYPE.get(value);
    if (exact)
        return exact;
    if (value.includes("video"))
        return VIDEO_ENTRY;
    if (value.includes("image"))
        return IMAGE_ENTRY;
    return null;
}
//# sourceMappingURL=media-capabilities.js.map