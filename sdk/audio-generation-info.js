/**
 * audio-generation-info.ts — generated from shared/audio-generation-info.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/audio-generation-info.ts — 音频生成（按描述生成声音）任务冻结元数据的唯一定义。
 *
 * 音效、环境音、带对白的场景与配乐都属于这一类。它与 `SpeechGenerationInfo`（逐字朗读，
 * 必须有音色）是两个形状：这里没有音色，多了模式、格式与计费时长。
 *
 * 挂在任务上的位置：提交时写入 `task.metadata.audio`（冻结，不含凭据、原始响应或 base64）；
 * 完成后，宿主把 API 返回的时长合并进结果的 `audio` 字段（见 `audioGenerationResultInfo`）。
 * 本文件只用纯 TypeScript（不引入 Node 专有 API），浏览器侧同样可用。
 *
 * 白名单是刻意的：缺字段、版本不符或字段非法一律返回 null，调用方走"没有可显示元数据"的
 * 既有路径，不补猜测值。
 */
import { mediaCapabilityForTaskType } from "./media-capabilities.js";
export const AUDIO_GENERATION_INFO_VERSION = 1;
/**
 * Formats a generated clip can be delivered as. Mirrors core/audio/audio-file-format.ts; kept
 * here because shared/ may not import core/ (the App SDK copies this file's import closure).
 * pcm is a raw stream with no file form, so it is not a generation output.
 */
const DELIVERABLE_AUDIO_FORMATS = Object.freeze(["mp3", "wav", "ogg_opus"]);
/** 展示用提示词的上限（字符数）。与适配器的输入上限一致；超出只用于防御异常数据。 */
export const AUDIO_GENERATION_PROMPT_DISPLAY_MAX_CHARS = 3000;
/** 模式、标识等短字符串的 UTF-8 字节上界。 */
export const AUDIO_GENERATION_IDENTIFIER_MAX_BYTES = 512;
const encoder = new TextEncoder();
function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function boundedBytes(value, maxBytes) {
    if (typeof value !== "string" || !value.trim())
        return null;
    if (encoder.encode(value).length > maxBytes)
        return null;
    return value;
}
function nonBlankString(value) {
    return typeof value === "string" && value.trim() ? value : null;
}
function nonNegativeSeconds(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        return null;
    return value;
}
/** 超过显示上限的提示词截断到上限长度（按码位计数），并以省略号结尾。 */
function displayPrompt(value) {
    const chars = Array.from(value);
    if (chars.length <= AUDIO_GENERATION_PROMPT_DISPLAY_MAX_CHARS)
        return value;
    return `${chars.slice(0, AUDIO_GENERATION_PROMPT_DISPLAY_MAX_CHARS - 1).join("")}…`;
}
/**
 * 把任意来源的值归一成 v1 白名单。缺字段、版本不符、字段非法返回 null。
 * 提示词为空或只有空白时视为非法；超长提示词按显示上限截断。
 */
export function normalizeAudioGenerationInfo(value) {
    const raw = asRecord(value);
    if (!raw)
        return null;
    if (raw.version !== AUDIO_GENERATION_INFO_VERSION)
        return null;
    const prompt = nonBlankString(raw.prompt);
    if (prompt === null)
        return null;
    const mode = boundedBytes(raw.mode, AUDIO_GENERATION_IDENTIFIER_MAX_BYTES);
    if (mode === null)
        return null;
    const format = raw.format;
    if (typeof format !== "string" || !DELIVERABLE_AUDIO_FORMATS.includes(format))
        return null;
    const durationSeconds = nonNegativeSeconds(raw.durationSeconds);
    const billedDurationSeconds = nonNegativeSeconds(raw.billedDurationSeconds);
    return {
        version: AUDIO_GENERATION_INFO_VERSION,
        prompt: displayPrompt(prompt),
        mode,
        format: format,
        ...(durationSeconds !== null ? { durationSeconds } : {}),
        ...(billedDurationSeconds !== null ? { billedDurationSeconds } : {}),
    };
}
/**
 * 任务行上冻结的音频生成元数据（已归一），没有或不可信时为 null。
 * 只有音频生成任务（能力表解析为 audio_generation）才读取 `metadata.audio`。
 */
export function audioGenerationInfoFromTask(task) {
    const record = asRecord(task);
    if (mediaCapabilityForTaskType(record?.type)?.id !== "audio_generation")
        return null;
    const metadata = asRecord(record?.metadata);
    return normalizeAudioGenerationInfo(metadata?.audio);
}
/**
 * 完成时写入结果的音频元数据：冻结信息加上适配器在 outputMetadata 里报告的时长。
 * 没有冻结信息时为 null；没有时长时只返回冻结信息本身。
 */
export function audioGenerationResultInfo(task) {
    const frozen = audioGenerationInfoFromTask(task);
    if (!frozen)
        return null;
    const output = asRecord(asRecord(task)?.outputMetadata);
    const durationSeconds = nonNegativeSeconds(output?.durationSeconds);
    const billedDurationSeconds = nonNegativeSeconds(output?.billedDurationSeconds);
    return normalizeAudioGenerationInfo({
        ...frozen,
        ...(durationSeconds !== null ? { durationSeconds } : {}),
        ...(billedDurationSeconds !== null ? { billedDurationSeconds } : {}),
    });
}
//# sourceMappingURL=audio-generation-info.js.map