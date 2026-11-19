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
import type { AudioFormat } from "./audio-contract.js";
export declare const AUDIO_GENERATION_INFO_VERSION = 1;
/** 展示用提示词的上限（字符数）。与适配器的输入上限一致；超出只用于防御异常数据。 */
export declare const AUDIO_GENERATION_PROMPT_DISPLAY_MAX_CHARS = 3000;
/** 模式、标识等短字符串的 UTF-8 字节上界。 */
export declare const AUDIO_GENERATION_IDENTIFIER_MAX_BYTES = 512;
export interface AudioGenerationInfo {
    readonly version: 1;
    /** 用户/Agent 写的原文（超长时截断用于显示）。 */
    readonly prompt: string;
    /** 模式 id，例如 text2audio。 */
    readonly mode: string;
    readonly format: AudioFormat;
    /** 生成音频的时长（秒）。仅在结果阶段写入。 */
    readonly durationSeconds?: number;
    /** 计费时长（秒，按原始时长计费）。仅在结果阶段写入。 */
    readonly billedDurationSeconds?: number;
}
/**
 * 把任意来源的值归一成 v1 白名单。缺字段、版本不符、字段非法返回 null。
 * 提示词为空或只有空白时视为非法；超长提示词按显示上限截断。
 */
export declare function normalizeAudioGenerationInfo(value: unknown): AudioGenerationInfo | null;
/**
 * 任务行上冻结的音频生成元数据（已归一），没有或不可信时为 null。
 * 只有音频生成任务（能力表解析为 audio_generation）才读取 `metadata.audio`。
 */
export declare function audioGenerationInfoFromTask(task: unknown): AudioGenerationInfo | null;
/**
 * 完成时写入结果的音频元数据：冻结信息加上适配器在 outputMetadata 里报告的时长。
 * 没有冻结信息时为 null；没有时长时只返回冻结信息本身。
 */
export declare function audioGenerationResultInfo(task: unknown): AudioGenerationInfo | null;
//# sourceMappingURL=audio-generation-info.d.ts.map