/**
 * AWS Comprehend PII Redaction Example
 *
 * Demonstrates how to use ComprehendRedact and ComprehendRedactChainable
 * to detect and redact PII from prompts before sending to LLMs.
 *
 * Setup:
 *   npm install
 *   export AWS_ACCESS_KEY_ID=your_key
 *   export AWS_SECRET_ACCESS_KEY=your_secret
 *   export AWS_REGION=us-east-1
 *   # OR set in code below
 *
 * Run: npx ts-node index.ts
 */

import { ComprehendRedact, ComprehendRedactChainable } from "@arakoodev/edgechains";

// ============================================================
// Example 1: Direct PII Detection and Redaction
// ============================================================
async function directRedactionExample() {
  console.log("=== Example 1: Direct PII Detection & Redaction ===\n");

  const comprehend = new ComprehendRedact({
    region: process.env["AWS_REGION"] || "us-east-1",
    accessKeyId: process.env["AWS_ACCESS_KEY_ID"] || "demo-key",
    secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] || "demo-secret",
  });

  const sensitiveText = `
    Customer Name: John Doe
    Email: john.doe@company.com
    Phone: (555) 123-4567
    SSN: 123-45-6789
    Credit Card: 4532-1234-5678-9010
    IP Address: 192.168.1.100
    URL: https://intranet.company.com/employees/johndoe
  `;

  console.log("Original text:");
  console.log(sensitiveText);

  // Detect all PII entities
  const entities = await comprehend.detectPII(sensitiveText);
  console.log("\nDetected PII entities:");
  entities.forEach((e) => {
    console.log(`  - ${e.Type}: "${e.Text}" (confidence: ${(e.Score! * 100).toFixed(1)}%)`);
  });

  // Redact all PII
  const result = await comprehend.redact({ text: sensitiveText });
  console.log("\nRedacted text:");
  console.log(result.redactedText);

  // Redact only specific types
  const emailOnly = await comprehend.redact({
    text: sensitiveText,
    piiEntityTypes: ["EMAIL", "PHONE"],
  });
  console.log("\nRedacted (email + phone only):");
  console.log(emailOnly.redactedText);
}

// ============================================================
// Example 2: Chainable with OpenAI
// ============================================================
async function chainableOpenAIExample() {
  console.log("\n=== Example 2: Chainable with OpenAI ===\n");

  // Simulated OpenAI class (replace with real one)
  const openAI = {
    chat: async (options: { prompt?: string; messages?: any[] }) => {
      console.log("LLM received prompt:");
      console.log(options.prompt || options.messages?.map((m: any) => m.content).join("\n"));
      return { content: "Response from LLM (PII was redacted before sending)" };
    },
  };

  const comprehend = new ComprehendRedactChainable({
    region: process.env["AWS_REGION"] || "us-east-1",
  });

  // Chain: all chat calls auto-redact PII
  const redactedChat = comprehend.chain(openAI);

  const prompt = `
    Please update the user profile for customer john@example.com.
    Their phone number is +1-555-987-6543.
    SSN for verification: 987-65-4321.
    Handle with care.
  `;

  console.log("Sending prompt to LLM (PII will be redacted automatically):\n");
  await redactedChat.chat({ prompt });

  console.log("\nResponse: Response from LLM (PII was redacted before sending)");
}

// ============================================================
// Example 3: Chaining Multiple Operations
// ============================================================
async function chainedOperationsExample() {
  console.log("\n=== Example 3: Chaining Multiple Operations ===\n");

  const comprehend = new ComprehendRedact();

  const text = "Hi, I'm Jane. Email me at jane@example.com, SSN: 111-22-3333.";

  // Step 1: Redact PII
  const result = await comprehend.redact({ text });

  // Step 2: Use redacted text in a prompt template
  const prompt = `
    Summarize the following user request (PII has been redacted for privacy):
    ${result.redactedText}

    Detected sensitive data types: ${result.detectedEntities.map((e) => e.Type).join(", ")}
  `;

  console.log("Chained prompt:");
  console.log(prompt);

  // Step 3: Send to LLM (would be: await openAI.chat({ prompt }))
  console.log("\n✅ PII was redacted before constructing the prompt!");
}

// ============================================================
// Example 4: Conversation with Auto-Redaction
// ============================================================
async function conversationExample() {
  console.log("\n=== Example 4: Conversation Auto-Redaction ===\n");

  const messages: any[] = [];

  const openAI = {
    chat: async (options: { messages?: any[] }) => {
      console.log("LLM received conversation:");
      options.messages?.forEach((m) => {
        const label = m.role === "user" ? "USER" : "ASST";
        console.log(`  [${label}]: ${m.content}`);
      });
      return { content: "Acknowledged and processed securely." };
    },
  };

  const comprehend = new ComprehendRedactChainable();
  const redactedChat = comprehend.chain(openAI);

  // Simulate a conversation with PII
  const conversation = [
    { role: "user", content: "My name is Alice Smith and my SSN is 555-66-7777." },
    { role: "assistant", content: "Hello Alice, how can I help you?" },
    {
      role: "user",
      content: "I need to update my billing email to alice.smith@newcompany.com",
    },
    {
      role: "assistant",
      content: "Done! Your billing email has been updated.",
    },
  ];

  // All user messages auto-redacted
  await redactedChat.chat({ messages: conversation });
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log("AWS Comprehend PII Redaction Example\n");
  console.log("Note: Without AWS credentials, regex-based fallback detection is used.\n");
  console.log("With real AWS credentials, Amazon Comprehend's ML models detect PII with higher accuracy.\n");

  await directRedactionExample();
  await chainableOpenAIExample();
  await chainedOperationsExample();
  await conversationExample();

  console.log("\n✅ All examples completed!");
}

main().catch(console.error);
