"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * palm2Chat.cjs — Synchronous wrapper for Palm2 chat.
 * Exposed via createSyncRPC so the JSONnet template can call
 * `arakoo.native("palm2Chat", { ... })`.
 *
 * The JSONnet `main.jsonnet` passes the apiKey, model, prompt,
 * temperature, and maxOutputTokens — all sourced from jsonnet files
 * (not hardcoded).
 */
const edgechains_1 = require("@arakoodev/edgechains.js/ai");
function palm2Chat(args) {
    const { apiKey, model, prompt, temperature, maxOutputTokens } = args;
    const palm2 = new edgechains_1.Palm2({ apiKey });
    // Synchronous RPC: we call .chat() and block on the Promise
    let result;
    palm2
        .chat({
        model: model || "chat-bison-001",
        prompt: prompt || "",
        temperature: temperature ?? 0.7,
        maxOutputTokens: maxOutputTokens ?? 512,
        topP: 0.95,
        topK: 40,
        candidateCount: 1,
    })
        .then((res) => {
        result = JSON.stringify(res);
    })
        .catch((err) => {
        result = JSON.stringify({ error: err.message || String(err) });
    });
    // Block until the promise resolves
    const { SyncPromise } = require("@arakoodev/edgechains.js/sync-rpc");
    if (!result) {
        new SyncPromise((resolve) => {
            const check = () => {
                if (result !== undefined)
                    return resolve(result);
                setTimeout(check, 5);
            };
            check();
        }).wait();
    }
    return result;
}
module.exports = palm2Chat;
