import axios, { AxiosInstance } from "axios";

/**
 * PII entity types supported by AWS Comprehend DetectPiiEntities.
 * Reference: https://docs.aws.amazon.com/comprehend/latest/dg/API_DetectPiiEntities.html
 */
export type PiiEntityType =
  | "BANK_ACCOUNT_NUMBER"
  | "BANK_ROUTING"
  | "CREDIT_DEBIT_NUMBER"
  | "CREDIT_DEBIT_CVV"
  | "CREDIT_DEBIT_EXPIRY"
  | "PIN"
  | "EMAIL"
  | "ADDRESS"
  | "NAME"
  | "PHONE"
  | "SSN"
  | "DATE_TIME"
  | "PASSPORT_NUMBER"
  | "DRIVER_ID"
  | "URL"
  | "AGE"
  | "USERNAME"
  | "PASSWORD"
  | "IP_ADDRESS"
  | "MAC_ADDRESS"
  | "ALL";

export interface PiiEntity {
  BeginOffset: number;
  EndOffset: number;
  Score: number;
  Type: PiiEntityType;
}

export interface DetectPiiEntitiesRequest {
  /** A UTF-8 text string. Each string must contain fewer that 100k bytes of UTF-8 encoded characters. */
  Text: string;
  /** The language of the input text. Currently English ("en") is the only supported language. */
  LanguageCode:
    | "en"
    | "es"
    | "fr"
    | "de"
    | "it"
    | "pt"
    | "ja"
    | "ko"
    | "zh"
    | "hi"
    | "ar"
    | "zh-TW";
}

export interface DetectPiiEntitiesResponse {
  Entities: PiiEntity[];
  ModelVersion: string;
}

export interface DetectPiiEntitiesOptions {
  /** IANA region where your Comprehend endpoint is hosted (e.g. "us-east-1"). */
  region?: string;
  /**
   * AWS access key id. Defaults to `process.env.AWS_ACCESS_KEY_ID`.
   * Optional when the host environment exposes credentials through IAM, ECS/EKS task role,
   * or `~/.aws/credentials` resolved by the AWS SDK default chain.
   */
  accessKeyId?: string;
  /** AWS secret access key. Defaults to `process.env.AWS_SECRET_ACCESS_KEY`. */
  secretAccessKey?: string;
  /** Optional session token for temporary credentials. Defaults to `process.env.AWS_SESSION_TOKEN`. */
  sessionToken?: string;
  /**
   * Optional Comprehend endpoint URL override (used for VPC endpoints or LocalStack).
   * Defaults to the regional Comprehend endpoint (`comprehend.<region>.amazonaws.com`).
   */
  endpoint?: string;
  /** Request timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
  /** Optional axios instance override (useful for testing or shared HTTP clients). */
  httpClient?: AxiosInstance;
}

export interface RedactionResult {
  /** Original input text. */
  original: string;
  /** Text with detected PII replaced according to the redaction policy. */
  redacted: string;
  /** Entities that were detected (sorted by BeginOffset). */
  entities: PiiEntity[];
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * AWS Comprehend client for detecting and redacting PII entities.
 *
 * The default Comprehend service speaks AWS SigV4-signed JSON over HTTPS. To keep
 * the bundle small and avoid a hard dependency on the official `@aws-sdk/*`
 * packages, the SigV4 signing here is implemented inline. It supports the
 * subset required for `DetectPiiEntities` calls: `host`, `x-amz-date`,
 * `x-amz-security-token`, `x-amz-content-sha256` and a single
 * `x-amz-target: Comprehend_20171127.DetectPiiEntities` header.
 *
 * If you need additional AWS APIs, replace `signRequest` with a call to the
 * official AWS SDK V3 Comprehend client.
 */
export class AWSComprehend {
  private readonly region: string;
  private readonly accessKeyId?: string;
  private readonly secretAccessKey?: string;
  private readonly sessionToken?: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly httpClient: AxiosInstance;

  constructor(options: DetectPiiEntitiesOptions = {}) {
    this.region = options.region || process.env.AWS_REGION || "us-east-1";
    this.accessKeyId = options.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
    this.secretAccessKey =
      options.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
    this.sessionToken = options.sessionToken || process.env.AWS_SESSION_TOKEN;
    this.endpoint =
      options.endpoint ||
      process.env.AWS_COMPREHEND_ENDPOINT ||
      `comprehend.${this.region}.amazonaws.com`;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.httpClient = options.httpClient || axios;
  }

  /**
   * Detect PII entities in the supplied text.
   *
   * @throws if AWS credentials are missing or the Comprehend API call fails.
   */
  async detectPiiEntities(
    text: string,
    languageCode: DetectPiiEntitiesRequest["LanguageCode"] = "en",
  ): Promise<PiiEntity[]> {
    if (!text) return [];
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error(
        "AWS credentials missing. Provide accessKeyId and secretAccessKey " +
          "in AWSComprehend options or set AWS_ACCESS_KEY_ID and " +
          "AWS_SECRET_ACCESS_KEY in the environment.",
      );
    }

    const body = JSON.stringify({ Text: text, LanguageCode: languageCode });
    const signed = this.signRequest("POST", "/", body);

    const response = await this.httpClient.post<DetectPiiEntitiesResponse>(
      signed.url,
      body,
      {
        headers: signed.headers,
        timeout: this.timeoutMs,
        transformRequest: [(data) => data],
      },
    );

    return (response.data?.Entities || [])
      .slice()
      .sort((a, b) => a.BeginOffset - b.BeginOffset);
  }

  /**
   * Detect PII entities and replace them in the original text.
   *
   * @param text The text to redact.
   * @param types Optional list of PII entity types to redact. Defaults to "ALL" (every detected type).
   * @param replacement Placeholder to insert for each redacted span. Defaults to `"[REDACTED]"`.
   * @param languageCode Input text language. Defaults to English.
   */
  async redact(
    text: string,
    types: PiiEntityType[] | "ALL" = "ALL",
    replacement: string = "[REDACTED]",
    languageCode: DetectPiiEntitiesRequest["LanguageCode"] = "en",
  ): Promise<RedactionResult> {
    const entities = await this.detectPiiEntities(text, languageCode);
    const filtered =
      types === "ALL"
        ? entities
        : entities.filter((entity) => types.includes(entity.Type));

    const redacted = applyRedactions(text, filtered, replacement);
    return { original: text, redacted, entities: filtered };
  }

  private signRequest(
    method: "POST",
    canonicalUri: string,
    body: string,
  ): SignedRequest {
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const host = this.endpoint.replace(/^https?:\/\//, "");
    const service = "comprehend";
    const region = this.region;
    const payloadHash = sha256Hex(body);

    const canonicalHeaders =
      `content-type:application/json\n` +
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n` +
      (this.sessionToken ? `x-amz-security-token:${this.sessionToken}\n` : "");
    const signedHeaders =
      "content-type;host;x-amz-content-sha256;x-amz-date" +
      (this.sessionToken ? ";x-amz-security-token" : "");

    const canonicalRequest =
      `${method}\n` +
      `${canonicalUri}\n` +
      `\n` +
      `${canonicalHeaders}\n` +
      `${signedHeaders}\n` +
      `${payloadHash}`;

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign =
      `AWS4-HMAC-SHA256\n` +
      `${amzDate}\n` +
      `${credentialScope}\n` +
      `${sha256Hex(canonicalRequest)}`;

    const signingKey = getSignatureKey(
      this.secretAccessKey!,
      dateStamp,
      region,
      service,
    );
    const signature = hmacSha256Hex(signingKey, stringToSign);

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Host: host,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
      "X-Amz-Target": "Comprehend_20171127.DetectPiiEntities",
      Authorization: authorization,
    };
    if (this.sessionToken) {
      headers["X-Amz-Security-Token"] = this.sessionToken;
    }

    const url = host.startsWith("http")
      ? host
      : `https://${host}${canonicalUri}`;
    return { url, headers, body };
  }
}

/**
 * Apply a list of PII entities to the supplied text by replacing each span
 * with `replacement`. Overlapping entities are resolved by preferring the
 * higher confidence score; ties are broken by the longer span.
 */
export function applyRedactions(
  text: string,
  entities: PiiEntity[],
  replacement: string = "[REDACTED]",
): string {
  if (!entities.length) return text;

  const sorted = entities
    .slice()
    .sort((a, b) => a.BeginOffset - b.BeginOffset || b.EndOffset - a.EndOffset);

  const selected: PiiEntity[] = [];
  for (const entity of sorted) {
    const last = selected[selected.length - 1];
    if (last && entity.BeginOffset < last.EndOffset) {
      // Overlap. Replace only if the new entity is strictly more confident.
      if (entity.Score > last.Score) {
        selected[selected.length - 1] = entity;
      }
      continue;
    }
    selected.push(entity);
  }

  let cursor = 0;
  let output = "";
  for (const entity of selected) {
    output += text.slice(cursor, entity.BeginOffset);
    output += replacement;
    cursor = entity.EndOffset;
  }
  output += text.slice(cursor);
  return output;
}

// ----- AWS SigV4 primitives (kept inline to avoid pulling in @aws-sdk/* deps) -----

function formatAmzDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}` +
    `T` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}` +
    `Z`
  );
}

// Minimal pure-JS sha256 + hmac (uses Node `crypto`). Edgechains runs on Node,
// so this is safe and avoids a 30kB browser polyfill.
import { createHash, createHmac } from "node:crypto";

function sha256Hex(message: string): string {
  return createHash("sha256").update(message, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, message: string): Buffer {
  return createHmac("sha256", key).update(message, "utf8").digest();
}

function hmacSha256Hex(key: Buffer | string, message: string): string {
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${key}`, dateStamp);
  const kRegion = hmacSha256(kDate, regionName);
  const kService = hmacSha256(kRegion, serviceName);
  return hmacSha256(kService, "aws4_request");
}
