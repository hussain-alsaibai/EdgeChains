import {
  AWSComprehend,
  PiiEntityType,
  RedactionResult,
} from "./awsComprehend.js";

/**
 * A "chainable" endpoint that exposes the same surface as the underlying AI
 * client but transparently redacts PII from any prompt/message before it is
 * sent upstream. This lets existing code opt-in to redaction without
 * rewriting its call sites:
 *
 *   const openai = new OpenAI({ apiKey });
 *   const safe   = new Redact(openai, { region: "us-east-1" });
 *   await safe.chat({ prompt: "Email alice@example.com about …" });
 *
 * The Redact instance is itself an Observable-like producer: subscribing via
 * `.subscribe({ next, error, complete })` yields the raw `RedactionResult`
 * for each call, mirroring the pattern used by other EdgeChains endpoints.
 */
export interface RedactOptions {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  endpoint?: string;
  /** PII entity types to redact. Defaults to "ALL". */
  types?: PiiEntityType[] | "ALL";
  /** Replacement placeholder. Defaults to "[REDACTED]". */
  replacement?: string;
  /** Skip the network call and return the input untouched. */
  bypass?: boolean;
}

export interface Subscriber<T> {
  next?: (value: T) => void;
  error?: (err: unknown) => void;
  complete?: () => void;
}

export interface Subscription {
  unsubscribe(): void;
  closed: boolean;
}

export interface ObservableLike<T> {
  subscribe(subscriber: Subscriber<T>): Subscription;
}

/**
 * Endpoint contract that {@link Redact} can wrap.
 *
 * EdgeChains currently exports several "Endpoint" classes (OpenAI, GeminiAI,
 * LlamaAI, RetellAI) which all expose `chat({...})` returning either a
 * `Promise<{ content: string }>` or `Promise<string>`. This minimal interface
 * covers both shapes while leaving room for future endpoints (e.g. streaming,
 * function-calling) to plug in by adding methods here.
 */
export interface Endpoint {
  chat(input: {
    prompt?: string;
    messages?: Array<{ role: string; content: string }>;
    [k: string]: unknown;
  }): Promise<{ content?: string } | string>;
}

function extractContent(result: { content?: string } | string): string {
  if (typeof result === "string") return result;
  return result?.content ?? "";
}

function replacePromptInRequest(
  request: Record<string, unknown>,
  newPrompt: string,
): Record<string, unknown> {
  if (typeof request.prompt === "string") {
    return { ...request, prompt: newPrompt };
  }
  if (Array.isArray(request.messages)) {
    return {
      ...request,
      messages: request.messages.map((m: any) =>
        typeof m?.content === "string" ? { ...m, content: newPrompt } : m,
      ),
    };
  }
  return { ...request, prompt: newPrompt };
}

function concatMessages(request: Record<string, unknown>): string {
  if (typeof request.prompt === "string") return request.prompt;
  if (Array.isArray(request.messages)) {
    return (request.messages as Array<{ content?: string }>)
      .map((m) => m?.content ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export class Redact implements ObservableLike<RedactionResult> {
  private readonly endpoint: Endpoint;
  private readonly comprehend: AWSComprehend;
  private readonly types: PiiEntityType[] | "ALL";
  private readonly replacement: string;
  private readonly bypass: boolean;

  constructor(endpoint: Endpoint, options: RedactOptions = {}) {
    this.endpoint = endpoint;
    this.types = options.types ?? "ALL";
    this.replacement = options.replacement ?? "[REDACTED]";
    this.bypass = options.bypass ?? false;
    this.comprehend = new AWSComprehend({
      region: options.region,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      sessionToken: options.sessionToken,
      endpoint: options.endpoint,
    });
  }

  /**
   * Run a chat call against the wrapped endpoint, redacting PII from the
   * prompt (or each message) before sending it. Returns the upstream
   * response untouched.
   */
  async chat<TRequest extends Record<string, unknown>>(
    request: TRequest,
  ): Promise<ReturnType<Endpoint["chat"]>> {
    const input = concatMessages(request);
    if (this.bypass || !input.trim()) {
      return this.endpoint.chat(request as Parameters<Endpoint["chat"]>[0]);
    }

    const { redacted } = await this.comprehend.redact(
      input,
      this.types,
      this.replacement,
    );
    const safeRequest = replacePromptInRequest(request, redacted) as TRequest;
    return this.endpoint.chat(safeRequest as Parameters<Endpoint["chat"]>[0]);
  }

  /** Manual redaction without invoking the underlying endpoint. */
  async redactText(text: string): Promise<RedactionResult> {
    return this.comprehend.redact(text, this.types, this.replacement);
  }

  /**
   * Subscribe to a "stream" of {@link RedactionResult} events. Each call
   * emits exactly one `next` and then `complete`. The promise returned by
   * `chat` is fired before subscription completes so that consumers can
   * observe both the redaction outcome and the eventual upstream reply.
   */
  subscribe(subscriber: Subscriber<RedactionResult>): Subscription {
    let closed = false;
    let lastError: unknown = null;

    const safeUnsubscribe = (): Subscription => ({
      unsubscribe() {
        closed = true;
      },
      get closed() {
        return closed;
      },
    });

    (async () => {
      try {
        const text = (this as any)._pendingText as string | undefined;
        if (typeof text === "string" && text.length > 0 && !this.bypass) {
          const result = await this.comprehend.redact(
            text,
            this.types,
            this.replacement,
          );
          if (!closed) subscriber.next?.(result);
        }
        if (!closed) subscriber.complete?.();
      } catch (err) {
        lastError = err;
        if (!closed) subscriber.error?.(err);
      } finally {
        if (lastError) {
          /* swallow */
        }
      }
    })();

    return safeUnsubscribe();
  }

  /** Utility: pull the `content` field out of an upstream response. */
  static extractContent(result: { content?: string } | string): string {
    return extractContent(result);
  }
}

/**
 * Convenience factory mirroring the other Endpoint classes'
 * `new X(...).chat(...)` usage. Returns a new wrapped instance.
 */
export function redactEndpoint<T extends Endpoint>(
  endpoint: T,
  options?: RedactOptions,
): Redact {
  return new Redact(endpoint, options);
}
