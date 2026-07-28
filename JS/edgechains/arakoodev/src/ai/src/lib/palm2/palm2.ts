import axios from "axios";
import { retry } from "@lifeomic/attempt";
import { z } from "zod";

const PALM2_BASE_URL = "https://generativelanguage.googleapis.com/v1beta2";

/**
 * Palm2 models available via the API.
 * See: https://developers.generativeai.google/guide
 */
export type Palm2Model = "chat-bison-001" | "text-bison-001" | "embedding-gecko-001";

export type Palm2Role = "user" | "bot";

export interface Palm2ConstructionOptions {
    apiKey?: string;
}

export interface Palm2Message {
    author: Palm2Role;
    content: string;
}

export interface Palm2ChatOptions {
    model?: Palm2Model;
    prompt?: string;
    messages?: Palm2Message[];
    temperature?: number;
    candidateCount?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    maxRetry?: number;
    safetySettings?: SafetySetting[];
}

export interface Palm2StreamOptions extends Palm2ChatOptions {
    examples?: Palm2Example[];
}

export interface Palm2Example {
    input: { author: Palm2Role; content: string };
    output: { author: Palm2Role; content: string };
}

export interface SafetySetting {
    category: SafetyCategory;
    threshold: SafetyThreshold;
}

export type SafetyCategory =
    | "HARM_CATEGORY_UNSPECIFIED"
    | "HARM_CATEGORY_DEROGATORY"
    | "HARM_CATEGORY_TOXICITY"
    | "HARM_CATEGORY_VIOLENCE"
    | "HARM_CATEGORY_SEXUAL"
    | "HARM_CATEGORY_MEDICAL"
    | "HARM_CATEGORY_DANGEROUS";

export type SafetyThreshold =
    | "HARM_BLOCK_THRESHOLD_UNSPECIFIED"
    | "HARM_BLOCK_THRESHOLD_UNSPECIFIED"
    | "BLOCK_LOW_AND_ABOVE"
    | "BLOCK_MEDIUM_AND_ABOVE"
    | "BLOCK_ONLY_HIGH"
    | "BLOCK_NONE";

export interface Palm2Candidate {
    author: string;
    content: string;
}

export interface Palm2ChatResponse {
    candidates: Palm2Candidate[];
    filters: Palm2Filter[];
}

export interface Palm2TextResponse {
    candidates: { output: string }[];
    filters: Palm2Filter[];
}

export interface Palm2Filter {
    reason: string;
    message: string;
}

export interface Palm2EmbeddingOptions {
    model?: "embedding-gecko-001";
    text: string;
}

export interface Palm2EmbeddingResponse {
    embedding: { value: number[] };
}

/**
 * Palm2 — Google's PaLM 2 language model integration.
 * Supports text chat, streaming chat, and text embedding.
 * API docs: https://developers.generativeai.google/rest/generativelanguage
 */
export class Palm2 {
    apiKey: string;

    constructor(options: Palm2ConstructionOptions) {
        this.apiKey = options.apiKey || process.env.PALM2_API_KEY || "";
        if (!this.apiKey) {
            console.warn(
                "Palm2: API key is missing. Set PALM2_API_KEY in your .env file or pass apiKey in constructor."
            );
        }
    }

    /**
     * Non-streaming chat — send a single prompt or a message history.
     */
    async chat(chatOptions: Palm2ChatOptions): Promise<Palm2ChatResponse> {
        const model = chatOptions.model || "chat-bison-001";
        const url = `${PALM2_BASE_URL}/models/${model}:generateMessage?key=${this.apiKey}`;

        const messages = chatOptions.messages || [];
        if (chatOptions.prompt) {
            messages.push({ author: "user", content: chatOptions.prompt });
        }

        const body: Record<string, unknown> = {
            prompt: {
                messages: messages.map((m) => ({
                    author: m.author,
                    content: m.content,
                })),
            },
            temperature: chatOptions.temperature ?? 0.7,
            candidateCount: chatOptions.candidateCount ?? 1,
            topP: chatOptions.topP ?? 0.95,
            topK: chatOptions.topK ?? 40,
            maxOutputTokens: chatOptions.maxOutputTokens ?? 1024,
        };

        if (chatOptions.safetySettings) {
            body.safetySettings = chatOptions.safetySettings;
        }

        return await retry(
            async () => {
                const response = await axios.post(url, body, {
                    headers: { "Content-Type": "application/json" },
                    timeout: 30000,
                });
                return this._normalizeResponse(response.data);
            },
            { maxAttempts: chatOptions.maxRetry ?? 3, delay: 300 }
        );
    }

    /**
     * Streaming chat — returns an async generator for SSE-style streaming.
     */
    async *stream(chatOptions: Palm2StreamOptions): AsyncGenerator<string, void, unknown> {
        const model = chatOptions.model || "chat-bison-001";
        const url = `${PALM2_BASE_URL}/models/${model}:streamGenerateMessage?key=${this.apiKey}`;

        const messages = chatOptions.messages || [];
        if (chatOptions.prompt) {
            messages.push({ author: "user", content: chatOptions.prompt });
        }

        const promptObj: Record<string, unknown> = {
            messages: messages.map((m) => ({ author: m.author, content: m.content })),
        };

        if (chatOptions.examples) {
            promptObj.examples = chatOptions.examples.map((e) => ({
                input: { author: e.input.author, content: e.input.content },
                output: { author: e.output.author, content: e.output.content },
            }));
        }

        const body: Record<string, unknown> = {
            prompt: promptObj,
            temperature: chatOptions.temperature ?? 0.7,
            topP: chatOptions.topP ?? 0.95,
            topK: chatOptions.topK ?? 40,
            candidateCount: 1,
            maxOutputTokens: chatOptions.maxOutputTokens ?? 1024,
        };

        const response = await axios.post(url, body, {
            headers: { "Content-Type": "application/json" },
            responseType: "stream",
            timeout: 60000,
        });

        const stream = response.data as AsyncIterable<string>;
        for await (const chunk of stream) {
            const lines = chunk.toString().split("\n");
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.candidates?.[0]?.content) {
                            yield data.candidates[0].content;
                        }
                    } catch {
                        // skip malformed lines
                    }
                }
            }
        }
    }

    /**
     * Text completion (non-chat) using text-bison-001.
     */
    async complete(chatOptions: {
        model?: Palm2Model;
        prompt: string;
        temperature?: number;
        maxOutputTokens?: number;
        topP?: number;
        topK?: number;
        maxRetry?: number;
    }): Promise<Palm2TextResponse> {
        const model = chatOptions.model || "text-bison-001";
        const url = `${PALM2_BASE_URL}/models/${model}:predict?key=${this.apiKey}`;

        const body = {
            prompt: {
                text: chatOptions.prompt,
            },
            temperature: chatOptions.temperature ?? 0.7,
            topP: chatOptions.topP ?? 0.95,
            topK: chatOptions.topK ?? 40,
            candidateCount: 1,
            maxOutputTokens: chatOptions.maxOutputTokens ?? 1024,
        };

        return await retry(
            async () => {
                const response = await axios.post(url, body, {
                    headers: { "Content-Type": "application/json" },
                    timeout: 30000,
                });
                return response.data;
            },
            { maxAttempts: chatOptions.maxRetry ?? 3, delay: 300 }
        );
    }

    /**
     * Generate text embeddings using embedding-gecko-001.
     */
    async embed(options: Palm2EmbeddingOptions): Promise<Palm2EmbeddingResponse> {
        const model = options.model || "embedding-gecko-001";
        const url = `${PALM2_BASE_URL}/models/${model}:embedText?key=${this.apiKey}`;

        const response = await axios.post(
            url,
            { text: options.text },
            {
                headers: { "Content-Type": "application/json" },
                timeout: 15000,
            }
        );

        return response.data;
    }

    private _normalizeResponse(raw: {
        candidates?: Array<{ content: string; author?: string }>;
        filters?: Array<{ reason: string; message: string }>;
    }): Palm2ChatResponse {
        return {
            candidates: (raw.candidates || []).map((c) => ({
                author: c.author || "bot",
                content: c.content || "",
            })),
            filters: raw.filters || [],
        };
    }
}
