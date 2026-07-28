import axios from "axios";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Palm2 } = require("../../lib/palm2/palm2");

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Palm2", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let palm2: typeof Palm2.prototype & Record<string, any>;

    beforeEach(() => {
        jest.clearAllMocks();
        palm2 = new Palm2({ apiKey: "test_api_key" });
    });

    describe("chat", () => {
        it("should return a chat response for a single prompt", async () => {
            mockedAxios.post = jest.fn().mockResolvedValueOnce({
                data: {
                    candidates: [
                        {
                            author: "bot",
                            content: "Hello! How can I help you today?",
                        },
                    ],
                    filters: [],
                },
            });

            const result = await palm2.chat({
                prompt: "Hello",
            });

            expect(result.candidates).toHaveLength(1);
            expect(result.candidates[0].content).toBe(
                "Hello! How can I help you today?"
            );
            expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        });

        it("should send message history when provided", async () => {
            mockedAxios.post = jest.fn().mockResolvedValueOnce({
                data: {
                    candidates: [
                        {
                            author: "bot",
                            content: "That's an interesting question.",
                        },
                    ],
                    filters: [],
                },
            });

            const result = await palm2.chat({
                messages: [
                    { author: "user", content: "What is the capital of France?" },
                    { author: "bot", content: "Paris." },
                    { author: "user", content: "What about Germany?" },
                ],
            });

            expect(result.candidates[0].content).toBe(
                "That's an interesting question."
            );
        });

        it("should apply temperature and token limits", async () => {
            mockedAxios.post = jest.fn().mockResolvedValueOnce({
                data: { candidates: [{ author: "bot", content: "Response" }], filters: [] },
            });

            await palm2.chat({
                prompt: "Tell me a joke",
                temperature: 0.9,
                maxOutputTokens: 256,
                topP: 0.8,
                topK: 20,
            });

            const call = mockedAxios.post.mock.calls[0];
            const body = call[1] as Record<string, unknown>;
            expect(body.temperature).toBe(0.9);
            expect(body.maxOutputTokens).toBe(256);
            expect(body.topP).toBe(0.8);
            expect(body.topK).toBe(20);
        });

        it("should include safety settings when provided", async () => {
            mockedAxios.post = jest.fn().mockResolvedValueOnce({
                data: { candidates: [{ author: "bot", content: "OK" }], filters: [] },
            });

            await palm2.chat({
                prompt: "Hello",
                safetySettings: [
                    {
                        category: "HARM_CATEGORY_TOXICITY",
                        threshold: "BLOCK_LOW_AND_ABOVE",
                    },
                ],
            });

            const call = mockedAxios.post.mock.calls[0];
            const body = call[1] as Record<string, unknown>;
            expect((body.safetySettings as unknown[])).toHaveLength(1);
            expect(((body.safetySettings as unknown[]) as Record<string,string>[])[0].category).toBe("HARM_CATEGORY_TOXICITY");
            expect(((body.safetySettings as unknown[]) as Record<string,string>[])[0].threshold).toBe("BLOCK_LOW_AND_ABOVE");
        });

        it("should handle multiple candidates", async () => {
            mockedAxios.post = jest.fn().mockResolvedValueOnce({
                data: {
                    candidates: [
                        { author: "bot", content: "Answer A" },
                        { author: "bot", content: "Answer B" },
                    ],
                    filters: [],
                },
            });

            const result = await palm2.chat({ prompt: "Give me two answers", candidateCount: 2 });
            expect(result.candidates).toHaveLength(2);
        });

        it("should return filters when content is blocked", async () => {
            mockedAxios.post = jest.fn().mockResolvedValueOnce({
                data: {
                    candidates: [],
                    filters: [
                        {
                            reason: "SAFETY",
                            message: "Content blocked due to safety settings.",
                        },
                    ],
                },
            });

            const result = await palm2.chat({ prompt: "Harmful request" });
            expect(result.candidates).toHaveLength(0);
            expect(result.filters).toHaveLength(1);
            expect(result.filters[0].reason).toBe("SAFETY");
        });
    });

    describe("complete", () => {
        it("should return text completion using text-bison-001", async () => {
            mockedAxios.post = jest.fn().mockResolvedValueOnce({
                data: {
                    predictions: [
                        {
                            candidates: [{ output: "The capital of France is Paris." }],
                        },
                    ],
                },
            });

            const result = await palm2.complete({
                prompt: "What is the capital of France?",
            });

            const call = mockedAxios.post.mock.calls[0];
            expect((call[0] as string).includes("text-bison-001")).toBe(true);
            expect((result as any).predictions[0].candidates[0].output).toBe(
                "The capital of France is Paris."
            );
        });

        it("should apply completion parameters", async () => {
            mockedAxios.post = jest.fn().mockResolvedValueOnce({
                data: { predictions: [{ candidates: [{ output: "Result" }] }] },
            });

            await palm2.complete({
                prompt: "Translate to French: Hello",
                temperature: 0.5,
                maxOutputTokens: 64,
            });

            const call = mockedAxios.post.mock.calls[0];
            const body = call[1] as Record<string, unknown>;
            expect(body.temperature).toBe(0.5);
            expect(body.maxOutputTokens).toBe(64);
        });
    });

    describe("embed", () => {
        it("should return embedding vector for input text", async () => {
            mockedAxios.post = jest.fn().mockResolvedValueOnce({
                data: {
                    embedding: {
                        value: [0.1, -0.2, 0.3, 0.4],
                    },
                },
            });

            const result = await palm2.embed({ text: "Hello world" });
            expect(result.embedding.value).toHaveLength(4);
            expect(result.embedding.value[0]).toBeCloseTo(0.1);
        });

        it("should use embedding-gecko-001 model", async () => {
            mockedAxios.post = jest.fn().mockResolvedValueOnce({
                data: { embedding: { value: [0.0] } },
            });

            await palm2.embed({ text: "Test" });

            const call = mockedAxios.post.mock.calls[0];
            expect((call[0] as string).includes("embedding-gecko-001")).toBe(true);
        });
    });

    describe("constructor", () => {
        it("should use apiKey from options", () => {
            const p = new Palm2({ apiKey: "my-key" });
            expect((p as any).apiKey).toBe("my-key");
        });

        it("should fall back to PALM2_API_KEY env var", () => {
            const original = process.env.PALM2_API_KEY;
            process.env.PALM2_API_KEY = "env-key";
            const p = new Palm2({});
            expect((p as any).apiKey).toBe("env-key");
            if (original !== undefined) {
                process.env.PALM2_API_KEY = original;
            } else {
                delete process.env.PALM2_API_KEY;
            }
        });

        it("should warn if no API key provided", () => {
            const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
            const p = new Palm2({});
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });
});
