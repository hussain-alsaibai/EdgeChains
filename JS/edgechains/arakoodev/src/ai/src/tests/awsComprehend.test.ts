/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AWSComprehend,
  applyRedactions,
  PiiEntity,
} from "../../../../dist/ai/src/lib/aws-comprehend/awsComprehend.js";
import { Redact } from "../../../../dist/ai/src/lib/aws-comprehend/redact.js";

function makeEntity(
  begin: number,
  end: number,
  type: PiiEntity["Type"] = "EMAIL",
  score = 0.99,
): PiiEntity {
  return { BeginOffset: begin, EndOffset: end, Score: score, Type: type };
}

function mockHttpClient(entities: PiiEntity[]) {
  return {
    post: vi.fn().mockResolvedValue({
      data: {
        Entities: entities,
        ModelVersion: "1.0",
      },
    }),
  };
}

describe("AWSComprehend", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("detects PII entities and sorts them by offset", async () => {
    const httpClient = mockHttpClient([
      makeEntity(20, 35, "PHONE"),
      makeEntity(6, 22, "EMAIL"),
    ]);

    const client = new AWSComprehend({
      accessKeyId: "AKIA-TEST",
      secretAccessKey: "secret",
      region: "us-east-1",
      httpClient,
    });

    const entities = await client.detectPiiEntities(
      "Email alice@example.com or call 555-1234.",
    );
    expect(entities).toHaveLength(2);
    expect(entities[0].Type).toBe("EMAIL");
    expect(entities[1].Type).toBe("PHONE");
    expect(httpClient.post).toHaveBeenCalledTimes(1);
  });

  it("redacts only the requested entity types", async () => {
    const httpClient = mockHttpClient([
      makeEntity(0, 3, "NAME"),
      makeEntity(4, 20, "EMAIL"),
    ]);

    const client = new AWSComprehend({
      accessKeyId: "AKIA-TEST",
      secretAccessKey: "secret",
      httpClient,
    });

    const result = await client.redact("Bob bob@example.com", ["EMAIL"]);
    expect(result.redacted).toBe("Bob [REDACTED]");
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].Type).toBe("EMAIL");
  });

  it("supports a custom replacement placeholder", async () => {
    const httpClient = mockHttpClient([makeEntity(0, 5, "SSN")]);

    const client = new AWSComprehend({
      accessKeyId: "AKIA-TEST",
      secretAccessKey: "secret",
      httpClient,
    });

    const result = await client.redact("12345", "ALL", "***");
    expect(result.redacted).toBe("***");
  });

  it("throws when credentials are missing", async () => {
    const prevKey = process.env.AWS_ACCESS_KEY_ID;
    const prevSecret = process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    try {
      const client = new AWSComprehend({ region: "us-east-1" });
      await expect(client.detectPiiEntities("hello")).rejects.toThrow(
        /AWS credentials missing/,
      );
    } finally {
      if (prevKey) process.env.AWS_ACCESS_KEY_ID = prevKey;
      if (prevSecret) process.env.AWS_SECRET_ACCESS_KEY = prevSecret;
    }
  });
});

describe("applyRedactions", () => {
  it("replaces each entity span with the placeholder", () => {
    const text = "Email alice@example.com today.";
    const out = applyRedactions(text, [makeEntity(6, 23, "EMAIL")]);
    expect(out).toBe("Email [REDACTED] today.");
  });

  it("handles overlapping entities by keeping the higher-confidence span", () => {
    const text = "Reach alice@example.com";
    const out = applyRedactions(text, [
      makeEntity(6, 23, "EMAIL", 0.7),
      makeEntity(6, 11, "NAME", 0.95),
    ]);
    expect(out).toBe("Reach [REDACTED]@example.com");
  });

  it("returns the original text when there are no entities", () => {
    expect(applyRedactions("hello world", [])).toBe("hello world");
  });
});

describe("Redact (chainable wrapper)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redacts the prompt before delegating to the wrapped endpoint", async () => {
    const httpClient = mockHttpClient([makeEntity(3, 20, "EMAIL")]);

    const fakeEndpoint = {
      chat: vi.fn(async (req: any) => ({
        content: `echo:${req.prompt}`,
      })),
    };

    const safe = new Redact(fakeEndpoint, {
      accessKeyId: "AKIA-TEST",
      secretAccessKey: "secret",
      httpClient,
    });

    const response = await safe.chat({
      prompt: "Hi alice@example.com, welcome.",
    });
    expect(fakeEndpoint.chat).toHaveBeenCalledTimes(1);
    const sentRequest = fakeEndpoint.chat.mock.calls[0][0];
    expect(sentRequest.prompt).toBe("Hi [REDACTED], welcome.");
    expect(response).toEqual({ content: "echo:Hi [REDACTED], welcome." });
  });

  it("redacts messages array when no prompt is provided", async () => {
    const httpClient = mockHttpClient([makeEntity(0, 5, "SSN")]);

    const fakeEndpoint = {
      chat: vi.fn(async () => ({ content: "ok" })),
    };

    const safe = new Redact(fakeEndpoint, {
      accessKeyId: "AKIA-TEST",
      secretAccessKey: "secret",
      httpClient,
    });

    await safe.chat({
      messages: [{ role: "user", content: "12345 is my SSN" }],
    });

    const sentRequest = fakeEndpoint.chat.mock.calls[0][0];
    expect(sentRequest.messages[0].content).toBe("[REDACTED] is my SSN");
  });

  it("bypass flag skips the network call entirely", async () => {
    const fakeEndpoint = {
      chat: vi.fn(async (req: any) => ({ content: req.prompt })),
    };

    const safe = new Redact(fakeEndpoint, { bypass: true });
    const response = await safe.chat({ prompt: "alice@example.com" });

    expect(fakeEndpoint.chat).toHaveBeenCalledWith({
      prompt: "alice@example.com",
    });
    expect(response).toEqual({ content: "alice@example.com" });
  });

  it("exposes a manual redactText helper", async () => {
    const httpClient = mockHttpClient([makeEntity(5, 13, "PHONE")]);

    const safe = new Redact(
      { chat: vi.fn() },
      { accessKeyId: "AKIA-TEST", secretAccessKey: "secret", httpClient },
    );

    const result = await safe.redactText("Call 555-1234 now");
    expect(result.redacted).toBe("Call [REDACTED] now");
  });

  it("emits exactly one next/complete pair on subscribe", async () => {
    const httpClient = mockHttpClient([makeEntity(6, 23, "EMAIL")]);

    const safe = new Redact(
      { chat: vi.fn() },
      { accessKeyId: "AKIA-TEST", secretAccessKey: "secret", httpClient },
    );
    (safe as any)._pendingText = "Email alice@example.com";

    const events: string[] = [];
    const sub = safe.subscribe({
      next: (r: any) => events.push(`next:${r.redacted}`),
      complete: () => events.push("complete"),
      error: () => events.push("error"),
    });

    // Wait for the inner async IIFE to finish the mock axios round-trip.
    await new Promise((r) => setTimeout(r, 10));

    expect(events).toEqual(["next:Email [REDACTED]", "complete"]);
    expect(typeof sub.unsubscribe).toBe("function");
  });
});
