local awsRegion = std.extVar('aws_region');
local awsAccessKeyId = std.extVar('aws_access_key_id');
local awsSecretAccessKey = std.extVar('aws_secret_access_key');
local inputText = std.extVar('input_text');

local main() =
  local response = arakoo.native('redactCall')({
    text: inputText,
    awsRegion: awsRegion,
    awsAccessKeyId: awsAccessKeyId,
    awsSecretAccessKey: awsSecretAccessKey,
  });
  response;

main()