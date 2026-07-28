/**
 * Palm2 Chat Example
 * Run: arakoo run palm2-chat
 * Requires PALM2_API_KEY in secrets.jsonnet or environment variable.
 */

local secrets = import "../secrets.jsonnet";
local apiKey = secrets.palm2_api_key;

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
  });
  palm2;

main()
