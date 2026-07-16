/**
 * EdgeChains example: AWS Comprehend PII redaction before an LLM call.
 *
 * This server exposes two POST endpoints:
 *   POST /chat         — runs the user's question through OpenAI, redacting
 *                        PII (emails, phones, names, etc.) via AWS Comprehend
 *                        before sending.
 *   POST /redact-only  — runs text through the redaction chain and returns
 *                        the redacted string + detected entities (no LLM).
 *
 * The same `Redact` wrapper works with any EdgeChains Endpoint (OpenAI,
 * GeminiAI, LlamaAI, RetellAI). Swap the underlying endpoint in
 * `lib/generateResponse.cts` to demo the chain pattern with another provider.
 */
import { ArakooServer } from "@arakoodev/edgechains.js/arakooserver";
import Jsonnet from "@arakoodev/jsonnet";
import { createSyncRPC } from "@arakoodev/edgechains.js/sync-rpc";

import fileURLToPath from "file-uri-to-path";
import path from "path";

const server = new ArakooServer();
const app = server.createApp();

const jsonnet = new Jsonnet();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const chatRpc = createSyncRPC(path.join(__dirname, "./lib/generateResponse.cts"));
const redactRpc = createSyncRPC(path.join(__dirname, "./lib/redactOnly.cts"));

app.post("/chat", async (c: any) => {
    try {
        const { question } = await c.req.json();
        const secrets = JSON.parse(
            jsonnet.evaluateFile(path.join(__dirname, "../jsonnet/secrets.jsonnet"))
        );
        jsonnet.extString("openai_api_key", secrets.openai_api_key);
        jsonnet.extString("aws_region", secrets.aws_region);
        jsonnet.extString("aws_access_key_id", secrets.aws_access_key_id);
        jsonnet.extString("aws_secret_access_key", secrets.aws_secret_access_key);
        jsonnet.extString("question", question || "");
        jsonnet.javascriptCallback("openAICall", chatRpc);
        jsonnet.javascriptCallback("redactCall", redactRpc);
        const response = jsonnet.evaluateFile(path.join(__dirname, "../jsonnet/main.jsonnet"));
        return c.json(JSON.parse(response));
    } catch (error) {
        console.log("error occurred", error);
        return c.json({ error: String(error) }, 500);
    }
});

app.post("/redact-only", async (c: any) => {
    try {
        const { text } = await c.req.json();
        const secrets = JSON.parse(
            jsonnet.evaluateFile(path.join(__dirname, "../jsonnet/secrets.jsonnet"))
        );
        jsonnet.extString("aws_region", secrets.aws_region);
        jsonnet.extString("aws_access_key_id", secrets.aws_access_key_id);
        jsonnet.extString("aws_secret_access_key", secrets.aws_secret_access_key);
        jsonnet.extString("input_text", text || "");
        jsonnet.javascriptCallback("redactCall", redactRpc);
        const response = jsonnet.evaluateFile(
            path.join(__dirname, "../jsonnet/redact-only.jsonnet")
        );
        return c.json(JSON.parse(response));
    } catch (error) {
        console.log("error occurred", error);
        return c.json({ error: String(error) }, 500);
    }
});

server.listen(3000);
console.log("EdgeChains Comprehend example listening on http://localhost:3000");