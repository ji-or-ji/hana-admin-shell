/**
 * Transcribe a session file from the current tool call or an App-owned local
 * audio file. The host enforces the media grant and both file-ownership paths.
 */
export function transcribeAudio(ctx, payload) {
    return ctx.bus.request("media:transcribe-audio", payload);
}
/** Read speech-recognition providers and their public model metadata. */
export function listSpeechRecognitionProviders(ctx) {
    return ctx.bus.request("provider:media-providers", {
        capability: "speech_recognition",
    });
}
/**
 * Synthesize speech that reads the given text aloud. Returns asynchronously:
 * the result carries task handles and frozen per-segment metadata, and the
 * finished audio is delivered as a SessionFile (session scope) or read back
 * through `ctx.media` (app scope) — not returned inline. This is text-to-speech
 * only, never transcription. For music, sound effects, ambience or scenes, use
 * `generateAudio`.
 */
export function generateSpeech(ctx, payload) {
    return ctx.bus.request("media:generate-speech", payload);
}
/**
 * Generate audio from a description: sound effects, ambience, a scene with dialogue,
 * or background music. Asynchronous like `generateSpeech`: the result carries task
 * handles, and the finished audio is delivered as a SessionFile or read back through
 * `ctx.media`. This is not text-to-speech (use `generateSpeech` to read given text aloud)
 * and not transcription.
 */
export function generateAudio(ctx, payload) {
    return ctx.bus.request("media:generate-audio", payload);
}
export const APP_MEDIA_BULK_CLEANUP_PARTIAL = "APP_MEDIA_BULK_CLEANUP_PARTIAL";
//# sourceMappingURL=media.js.map