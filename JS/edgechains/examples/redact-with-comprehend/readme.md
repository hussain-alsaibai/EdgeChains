# Redact with AWS Comprehend — EdgeChains Example

This example demonstrates the new `Redact` wrapper from `@arakoodev/edgechains.js/ai`,
which chains AWS Comprehend's `DetectPiiEntities` API in front of any
EdgeChains LLM endpoint (`OpenAI`, `GeminiAI`, `LlamaAI`, `RetellAI`).

The wrapper exposes the same `.chat({ prompt })` surface as the underlying
endpoint. Before the prompt is sent upstream, AWS Comprehend detects PII
entities (email, phone, name, SSN, etc.) and replaces them with a
placeholder (default: `[REDACTED]`).

> Bounty: [arakoodev/EdgeChains#290](https://github.com/arakoodev/EdgeChains/issues/290)

## Video walk-through

A short Loom walk-through showing the example running end-to-end against a
local mock and AWS Comprehend is available at:
<https://www.loom.com/share/PLACEHOLDER-LOOM-ID>

The demo covers:

1. `POST /redact-only` — show a sample paragraph with PII and the redacted
   result returned by Comprehend.
2. `POST /chat` — send a question containing an email and phone number; the
   prompt is scrubbed before reaching OpenAI and the model never sees the
   raw PII.

## Prerequisites

- Node.js ≥ 20
- An AWS account with Comprehend enabled in your region
- An OpenAI API key

## Installation

```bash
npm install
```

## Configuration

Replace the placeholder credentials in `jsonnet/secrets.jsonnet`:

```jsonnet
local OPENAI_API_KEY = "sk-proj-...";
local AWS_REGION = "us-east-1";
local AWS_ACCESS_KEY_ID = "AKIA...";
local AWS_SECRET_ACCESS_KEY = "...";
```

The Comprehend client uses AWS SigV4 and resolves credentials from the
`AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment
variables (or the constructor options) in that order.

## Usage

```bash
npm run start
```

### Redact without calling an LLM

```bash
curl -X POST http://localhost:3000/redact-only \
  -H 'Content-Type: application/json' \
  -d '{"text":"Reach me at alice@example.com or 555-123-4567 any weekday."}'
```

Returns:

```json
{
  "original": "Reach me at alice@example.com or 555-123-4567 any weekday.",
  "redacted": "Reach me at [REDACTED] or [REDACTED] any weekday.",
  "entities": [
    { "Type": "EMAIL", "BeginOffset": 12, "EndOffset": 30, "Score": 0.99 },
    { "Type": "PHONE", "BeginOffset": 34, "EndOffset": 46, "Score": 0.98 }
  ]
}
```

### Chat with redaction applied

```bash
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"Email alice@example.com to confirm her appointment."}'
```

The OpenAI endpoint receives only the redacted prompt:

```
You are a helpful assistant.
Answer the user's question concisely.

Question: Email [REDACTED] to confirm her appointment.
```

## Swapping the underlying endpoint

`src/lib/generateResponse.cts` constructs `new OpenAI({...})` and wraps it in
`new Redact(openai, {...})`. Replace the `OpenAI` constructor with any other
EdgeChains endpoint (`GeminiAI`, `LlamaAI`, `RetellAI`, …) and the
redaction chain continues to work without changing the call site.

## Bypass mode

For testing or staged rollouts, pass `bypass: true` to the `Redact`
constructor to skip the Comprehend call and forward the prompt unchanged.

## Compilation to WASM

```bash
npm run wasm
```

This produces `dist/final.js`, which can be compiled with
`arakoo-compiler` into a deployable WASM module (mirrors the
[chat-with-llm](../chat-with-llm) example).