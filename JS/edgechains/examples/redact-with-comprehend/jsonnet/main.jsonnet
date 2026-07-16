local promptTemplate = |||
  You are a helpful assistant.
  Answer the user's question concisely.

  Question: {question}
|||;

local openaiKey = std.extVar('openai_api_key');
local awsRegion = std.extVar('aws_region');
local awsAccessKeyId = std.extVar('aws_access_key_id');
local awsSecretAccessKey = std.extVar('aws_secret_access_key');
local userQuestion = std.extVar('question');

local promptWithQuestion = std.strReplace(promptTemplate, '{question}', userQuestion + '\n');

local main() =
  local rawResponse = arakoo.native('openAICall')({
    prompt: promptWithQuestion,
    openAIApiKey: openaiKey,
    awsRegion: awsRegion,
    awsAccessKeyId: awsAccessKeyId,
    awsSecretAccessKey: awsSecretAccessKey,
  });
  rawResponse;

main()