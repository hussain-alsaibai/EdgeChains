// Loader shim for running TypeScript through the EdgeChains sync-rpc pipeline.
// Mirrors the pattern used by `chat-with-llm` so the example can be run with
// `arakoo-compiler dist/final.js` to produce a WASM-compatible bundle.
module.exports = require("./dist/lib/generateResponse.js");