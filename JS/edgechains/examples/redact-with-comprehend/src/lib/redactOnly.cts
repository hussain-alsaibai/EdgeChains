/**
 * Sync-RPC handler that runs the redaction chain without invoking an LLM.
 * Useful for inspecting the redacted text + detected entities in isolation.
 */
const { Redact } = require("@arakoodev/edgechains.js/ai");

async function redactCall({ text, awsRegion, awsAccessKeyId, awsSecretAccessKey }: any) {
    try {
        // The Redact wrapper doesn't require an underlying endpoint to redact
        // text. We pass a no-op endpoint so `.chat()` is not invoked and the
        // redaction helper is used directly.
        const noop = { chat: async () => ({ content: "" }) };
        const redactor = new Redact(noop, {
            region: awsRegion,
            accessKeyId: awsAccessKeyId,
            secretAccessKey: awsSecretAccessKey,
        });

        const result = await redactor.redactText(text);
        return JSON.stringify({
            original: result.original,
            redacted: result.redacted,
            entities: result.entities,
        });
    } catch (error) {
        return JSON.stringify({ error: String(error) });
    }
}

module.exports = redactCall;