/**
 * Sync-RPC handler that chains AWS Comprehend redaction with an LLM call.
 *
 * The handler is invoked from Jsonnet via `createSyncRPC`, so it must run
 * in CommonJS (the `.cts` extension) and export a single async function.
 */
const { OpenAI, Redact } = require("@arakoodev/edgechains.js/ai");

async function openAICall({ prompt, openAIApiKey, awsRegion, awsAccessKeyId, awsSecretAccessKey }: any) {
    try {
        const openai = new OpenAI({ apiKey: openAIApiKey });

        // Chain AWS Comprehend in front of the OpenAI endpoint. The wrapper
        // exposes the same `.chat()` surface as the underlying endpoint, so
        // any existing call site works unchanged — the prompt is transparently
        // scrubbed of PII before it reaches the model.
        const safeOpenAI = new Redact(openai, {
            region: awsRegion,
            accessKeyId: awsAccessKeyId,
            secretAccessKey: awsSecretAccessKey,
        });

        const response = await safeOpenAI.chat({
            prompt: [
                "You are a helpful assistant.",
                "Answer the user's question concisely.",
                "",
                `Question: ${prompt}`,
            ].join("\n"),
        });

        return JSON.stringify({
            content: response.content,
            redactedPrompt: typeof response._redacted === "string" ? response._redacted : undefined,
        });
    } catch (error) {
        return JSON.stringify({ error: String(error) });
    }
}

module.exports = openAICall;