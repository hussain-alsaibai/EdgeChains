import { ComprehendRedact, ComprehendRedactChainable } from "../lib/aws-comprehend/comprehend-redact";
import axios from "axios";

jest.mock("axios");

describe("ComprehendRedact", () => {
  let comprehendRedact: ComprehendRedact;

  beforeEach(() => {
    comprehendRedact = new ComprehendRedact({
      region: "us-east-1",
      accessKeyId: "test-key-id",
      secretAccessKey: "test-secret-key",
    });
  });

  describe("detectPIIRegex", () => {
    test("should detect email addresses", async () => {
      const text = "My email is john.doe@example.com please contact me";
      const entities = await comprehendRedact.detectPII(text);

      const emailEntity = entities.find((e) => e.Type === "EMAIL");
      expect(emailEntity).toBeDefined();
      expect(emailEntity?.Text).toBe("john.doe@example.com");
      expect(emailEntity?.Score).toBeGreaterThan(0.9);
    });

    test("should detect phone numbers", async () => {
      const text = "Call me at (555) 123-4567 or 555.987.6543";
      const entities = await comprehendRedact.detectPII(text);

      const phoneEntities = entities.filter((e) => e.Type === "PHONE");
      expect(phoneEntities.length).toBeGreaterThanOrEqual(1);
    });

    test("should detect SSN", async () => {
      const text = "My SSN is 123-45-6789";
      const entities = await comprehendRedact.detectPII(text);

      const ssnEntity = entities.find((e) => e.Type === "SSN");
      expect(ssnEntity).toBeDefined();
      expect(ssnEntity?.Text).toBe("123-45-6789");
    });

    test("should detect credit card numbers", async () => {
      const text = "Card number: 4532-0151-1234-5678";
      const entities = await comprehendRedact.detectPII(text);

      const ccEntity = entities.find((e) => e.Type === "CREDIT_DEBIT_NUMBER");
      expect(ccEntity).toBeDefined();
    });

    test("should detect IP addresses", async () => {
      const text = "Server IP: 192.168.1.100";
      const entities = await comprehendRedact.detectPII(text);

      const ipEntity = entities.find((e) => e.Type === "IP_ADDRESS");
      expect(ipEntity).toBeDefined();
      expect(ipEntity?.Text).toBe("192.168.1.100");
    });

    test("should detect URLs", async () => {
      const text = "Visit https://example.com/secret for more info";
      const entities = await comprehendRedact.detectPII(text);

      const urlEntity = entities.find((e) => e.Type === "URL");
      expect(urlEntity).toBeDefined();
      expect(urlEntity?.Text).toBe("https://example.com/secret");
    });

    test("should return empty array for text with no PII", async () => {
      const text = "Hello, how are you today?";
      const entities = await comprehendRedact.detectPII(text);

      // Should not detect false positives
      const falsePositives = entities.filter(
        (e) =>
          e.Type === "EMAIL" ||
          e.Type === "SSN" ||
          e.Type === "CREDIT_DEBIT_NUMBER"
      );
      expect(falsePositives.length).toBe(0);
    });
  });

  describe("redact", () => {
    test("should redact email from text", async () => {
      const result = await comprehendRedact.redact({
        text: "Contact me at john@example.com",
      });

      expect(result.redactedText).not.toContain("john@example.com");
      expect(result.redactedText).toContain("[REDACTED_EMAIL]");
      expect(result.detectedEntities).toHaveLength(1);
      expect(result.detectedEntities[0].Type).toBe("EMAIL");
      expect(result.originalText).toBe("Contact me at john@example.com");
    });

    test("should redact multiple PII types", async () => {
      const result = await comprehendRedact.redact({
        text: "Hi, I'm John. Email me at john@example.com, SSN: 123-45-6789, call 555-123-4567",
      });

      expect(result.redactedText).not.toContain("john@example.com");
      expect(result.redactedText).not.toContain("123-45-6789");
      expect(result.redactedText).not.toContain("555-123-4567");
      expect(result.detectedEntities.length).toBeGreaterThanOrEqual(3);
    });

    test("should redact only specified entity types", async () => {
      const result = await comprehendRedact.redact({
        text: "Email: john@example.com, SSN: 123-45-6789",
        piiEntityTypes: ["EMAIL"], // Only redact emails
      });

      expect(result.redactedText).not.toContain("john@example.com");
      expect(result.redactedText).toContain("123-45-6789"); // SSN should remain
      expect(result.detectedEntities.length).toBe(1);
      expect(result.detectedEntities[0].Type).toBe("EMAIL");
    });

    test("should handle empty text", async () => {
      const result = await comprehendRedact.redact({ text: "" });

      expect(result.redactedText).toBe("");
      expect(result.detectedEntities).toHaveLength(0);
      expect(result.originalText).toBe("");
    });

    test("should handle text with no PII", async () => {
      const text = "Hello world, this is a normal sentence with no sensitive data.";
      const result = await comprehendRedact.redact({ text });

      expect(result.redactedText).toBe(text);
      expect(result.originalText).toBe(text);
    });

    test("should handle overlapping entities correctly", async () => {
      // When entities overlap, sort by offset descending to avoid shifts
      const result = await comprehendRedact.redact({
        text: "Email: a@b.com and URL: https://x.com",
      });

      expect(result.redactedText).not.toContain("a@b.com");
      expect(result.redactedText).not.toContain("https://x.com");
      expect(result.redactedText).toContain("[REDACTED_");
    });
  });

  describe("pipe", () => {
    test("should pipe redacted text to a function", async () => {
      const mockFn = jest.fn().mockResolvedValue("response");
      const piped = comprehendRedact.pipe(mockFn);

      await piped("Contact me at secret@email.com");

      expect(mockFn).toHaveBeenCalledWith(
        "Contact me at [REDACTED_EMAIL]"
      );
    });
  });
});

describe("ComprehendRedactChainable", () => {
  let chainable: ComprehendRedactChainable;

  beforeEach(() => {
    chainable = new ComprehendRedactChainable({
      region: "us-east-1",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
    });
  });

  describe("redact", () => {
    test("should detect and redact PII", async () => {
      const result = await chainable.redact({
        text: "My SSN is 999-88-7777",
      });

      expect(result.redactedText).not.toContain("999-88-7777");
      expect(result.redactedText).toContain("[REDACTED_SSN]");
      expect(result.detectedEntities[0].Type).toBe("SSN");
    });
  });

  describe("chain with OpenAI", () => {
    test("should auto-redact prompt before sending to chat", async () => {
      const mockOpenAI = {
        chat: jest.fn().mockResolvedValue({ content: "Hello!" }),
        streamedChat: jest.fn(),
      };

      const redactedChat = chainable.chain(mockOpenAI);

      await redactedChat.chat({
        prompt: "My credit card is 4532-0000-0000-0000",
      });

      expect(mockOpenAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("[REDACTED_"),
        })
      );
      // Verify the original CC number was NOT sent
      expect(mockOpenAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.not.stringContaining("4532-0000-0000-0000"),
        })
      );
    });

    test("should auto-redact messages in conversation", async () => {
      const mockOpenAI = {
        chat: jest.fn().mockResolvedValue({ content: "Response" }),
      };

      const redactedChat = chainable.chain(mockOpenAI);

      await redactedChat.chat({
        messages: [
          { role: "user", content: "My email is test@test.com" },
          { role: "assistant", content: "I see." },
        ],
      });

      expect(mockOpenAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: expect.stringContaining("[REDACTED_EMAIL]"),
            }),
            expect.objectContaining({
              role: "assistant",
              content: "I see.", // assistant content should not be redacted
            }),
          ]),
        })
      );
    });
  });
});
