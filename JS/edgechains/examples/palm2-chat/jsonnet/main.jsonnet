/**
 * Palm2 Chat Example — Jsonnet template
 * 
 * Prompts are defined here (not hardcoded in TypeScript).
 * Runtime variables are injected from secrets.jsonnet and HTTP request params.
 * 
 * Run: POST /chat with JSON body { topic: string, model?: string }
 */

local secrets = import "../secrets.jsonnet";

local apiKey = std.extVar("palm2_api_key");
local topic = std.extVar("topic");
local model = std.extVar("model") || "chat-bison-001";

local promptTemplate = |||
  You are a helpful AI assistant. Provide a concise and informative response to the following topic:
  Topic: {topic}
|||;

local promptWithTopic = std.strReplace(promptTemplate, "{topic}", topic);

local main() =
  local palm2 = arakoo.native("palm2Chat")({
    apiKey: apiKey,
    model: model,
    prompt: promptWithTopic,
    temperature: 0.7,
    maxOutputTokens: 512,
    topP: 0.95,
    topK: 40,
    candidateCount: 1,
  });
  palm2;

main()
