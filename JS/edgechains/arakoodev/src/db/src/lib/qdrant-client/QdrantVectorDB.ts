/**
 * QdrantVectorDB — a HydeSearch-compatible vector DB wrapper backed by Qdrant.
 *
 * Mirrors the `PostgresClient` interface: constructor accepts the same
 * inputs, and `dbQuery()` returns results in the same shape expected by
 * `HydeSearchService`.
 *
 * Usage:
 *   const db = new QdrantVectorDB(
 *     embeddings,       // number[][]
 *     metric,           // "COSINE" | "IP" | "L2"
 *     topK,             // number
 *     collectionName,   // string  (Qdrant collection name)
 *     namespace,        // string  (payload key to filter on)
 *     arkRequest,       // ArkRequest-like object
 *     limit             // number
 *   );
 *   const results = await db.dbQuery();
 */

import {
  QdrantClient,
  QdrantDistanceMetric,
  QdrantSearchResult,
} from "./QdrantClient.js";

export { QdrantDistanceMetric };

export interface ArkRequestLike {
  query?: string;
  textWeight?: { baseWeight?: number; fineTuneWeight?: number };
  similarityWeight?: { baseWeight?: number; fineTuneWeight?: number };
  dateWeight?: { baseWeight?: number; fineTuneWeight?: number };
  orderRRF?: string;
}

export interface HydeSearchResult {
  raw_text?: string;
  document_date?: string;
  metadata?: string;
  filename?: string;
  timestamp?: string;
  score?: number;
  [key: string]: unknown;
}

export class QdrantVectorDB {
  private embeddings: number[][];
  private metric: "COSINE" | "IP" | "L2";
  private topK: number;
  private collectionName: string;
  private namespace: string;
  private arkRequest: ArkRequestLike;
  private limit: number;

  /** The underlying Qdrant client (lazy-initialised on first call). */
  private _client?: QdrantClient;

  constructor(
    embeddings: number[][],
    metric: "COSINE" | "IP" | "L2",
    topK: number,
    collectionName: string,
    namespace: string,
    arkRequest: ArkRequestLike,
    limit: number
  ) {
    this.embeddings = embeddings;
    this.metric = metric;
    this.topK = topK;
    this.collectionName = collectionName;
    this.namespace = namespace;
    this.arkRequest = arkRequest;
    this.limit = limit;
  }

  /**
   * Set the base URL for the Qdrant server.
   * Must be called before `dbQuery()` if QDRANT_URL env is not set.
   */
  setUrl(url: string): void {
    this._client = new QdrantClient(url, this.collectionName);
  }

  private get client(): QdrantClient {
    if (!this._client) {
      const url =
        process.env["QDRANT_URL"] ??
        (() => {
          throw new Error(
            "[QdrantVectorDB] QDRANT_URL environment variable is not set. " +
              "Call setUrl() first or set the env var."
          );
        })();
      this._client = new QdrantClient(url, this.collectionName);
    }
    return this._client;
  }

  /** Map Postgres distance metric string → Qdrant Distance enum. */
  private toQdrantMetric(metric: "COSINE" | "IP" | "L2"): QdrantDistanceMetric {
    switch (metric) {
      case "COSINE":
        return QdrantDistanceMetric.COSINE;
      case "IP":
        return QdrantDistanceMetric.DOT; // inner product
      case "L2":
        return QdrantDistanceMetric.EUCLID;
    }
  }

  /**
   * Single-vector Qdrant search mapped to the Postgres result shape.
   * Returns results with raw_text, filename, score, etc.
   */
  private async searchOne(vector: number[]): Promise<QdrantSearchResult[]> {
    const filter = {
      must: [{ key: "namespace", match: { value: this.namespace } }],
    };

    const results = await this.client.search({
      vector,
      limit: this.topK,
      withPayload: true,
      withVector: false,
      scoreThreshold:
        this.metric === "COSINE" || this.metric === "IP" ? 0.0 : undefined,
      filter,
    });

    return results;
  }

  /**
   * Run reciprocal rank fusion (RRF) across multiple embedding searches,
   * then return the top `limit` results shaped like Postgres output.
   */
  async dbQuery(): Promise<HydeSearchResult[]> {
    const { topK, limit, arkRequest } = this;
    const tw = arkRequest.textWeight ?? { baseWeight: 1, fineTuneWeight: 1 };
    const sw = arkRequest.similarityWeight ?? { baseWeight: 1, fineTuneWeight: 1 };
    const dw = arkRequest.dateWeight ?? { baseWeight: 1, fineTuneWeight: 1 };
    const twbw = tw.baseWeight ?? 1, twfw = tw.fineTuneWeight ?? 1;
    const swbw = sw.baseWeight ?? 1, swfw = sw.fineTuneWeight ?? 1;
    const dwbw = dw.baseWeight ?? 1, dwfw = dw.fineTuneWeight ?? 1;

    // 1. Search with each embedding
    const perEmbedding = await Promise.all(
      this.embeddings.map((vec) => this.searchOne(vec))
    );

    // 2. Build a flat list with per-embedding ranks
    const scored: Array<{ doc: HydeSearchResult; rrf: number; sim: number }> = [];

    for (let ei = 0; ei < perEmbedding.length; ei++) {
      const ranked = perEmbedding[ei];
      for (let ri = 0; ri < ranked.length; ri++) {
        const hit = ranked[ri];
        // Uniqueness key: id + embedding index
        const key = `${hit.id}-e${ei}`;
        const sim = hit.score ?? 0;

        // RRF formula matching PostgresClient's additive scoring
        const rrf =
          twbw / (ri + twfw) +
          swbw / (sim + swfw) +
          dwbw / (ri + dwfw);

        const existing = scored.findIndex(
          (s) =>
            (s.doc as Record<string, unknown>)["id"] === hit.id &&
            (s.doc as Record<string, unknown>)["_ei"] === ei
        );

        if (existing >= 0) {
          // Accumulate RRF if same doc appears in multiple embedding searches
          scored[existing].rrf += rrf;
        } else {
          scored.push({
            doc: {
              id: hit.id,
              raw_text:
                typeof hit.payload?.raw_text === "string"
                  ? hit.payload.raw_text
                  : typeof hit.payload?.text === "string"
                  ? hit.payload.text
                  : JSON.stringify(hit.payload ?? {}),
              filename:
                typeof hit.payload?.filename === "string"
                  ? hit.payload.filename
                  : undefined,
              document_date:
                typeof hit.payload?.document_date === "string"
                  ? hit.payload.document_date
                  : typeof hit.payload?.documentDate === "string"
                  ? hit.payload.documentDate
                  : undefined,
              metadata:
                typeof hit.payload?.metadata === "string"
                  ? hit.payload.metadata
                  : typeof hit.payload?.metadata === "object"
                  ? JSON.stringify(hit.payload.metadata)
                  : undefined,
              timestamp:
                typeof hit.payload?.timestamp === "string"
                  ? hit.payload.timestamp
                  : undefined,
              score: hit.score,
              _ei: ei,
            },
            rrf,
            sim,
          });
        }
      }
    }

    // 3. Sort by orderRRF preference
    const orderRRF = arkRequest.orderRRF ?? "default";
    const sorted = [...scored].sort((a, b) => {
      switch (orderRRF) {
        case "text_rank":
          // approximate with rank within first embedding
          return (
            scored.indexOf(a) % topK - (scored.indexOf(b) % topK)
          );
        case "similarity":
          return b.sim - a.sim;
        case "date_rank":
          return (
            new Date(b.doc.document_date ?? 0).getTime() -
            new Date(a.doc.document_date ?? 0).getTime()
          );
        default:
          return b.rrf - a.rrf;
      }
    });

    // 4. De-duplicate by id (keep highest RRF), then limit
    const seen = new Set<unknown>();
    const deduped: HydeSearchResult[] = [];
    for (const s of sorted) {
      const id = (s.doc as Record<string, unknown>)["id"];
      if (!seen.has(id)) {
        seen.add(id);
        // Strip internal _ei field
        const { _ei, ...rest } = s.doc;
        deduped.push(rest as HydeSearchResult);
        if (deduped.length >= limit) break;
      }
    }

    return deduped;
  }
}
