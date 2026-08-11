import axios, { AxiosInstance, AxiosError } from "axios";
import retry from "retry";
import { config } from "dotenv";

config();

// ─── Public Types ─────────────────────────────────────────────────────────────

export type QdrantPointId = string | number;

export interface QdrantPoint {
    id: QdrantPointId;
    vector: number[] | Record<string, number[]>;
    payload?: Record<string, unknown>;
}

export interface QdrantScoredPoint extends QdrantPoint {
    score: number;
}

export interface QdrantCollectionOptions {
    size: number;
    distance?: "Cosine" | "Euclid" | "Dot" | "Manhattan";
    hnswConfig?: {
        m?: number;
        efConstruct?: number;
        fullScanThreshold?: number;
    };
    onDiskPayload?: boolean;
}

export interface QdrantSearchOptions {
    limit?: number;
    offset?: number;
    withPayload?: boolean | string[];
    withVector?: boolean;
    scoreThreshold?: number;
    filter?: QdrantFilter;
}

export interface QdrantFilter {
    must?: QdrantCondition[];
    should?: QdrantCondition[];
    mustNot?: QdrantCondition[];
}

export interface QdrantCondition {
    key: string;
    match?: { value: string | number | boolean };
    range?: { gt?: number; gte?: number; lt?: number; lte?: number };
}

export interface QdrantRetrieveOptions {
    withPayload?: boolean | string[];
    withVector?: boolean;
}

export interface QdrantScrollOptions extends QdrantRetrieveOptions {
    limit?: number;
    offset?: string;
    filter?: QdrantFilter;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        out[snake] = v && typeof v === "object" && !Array.isArray(v)
            ? toSnake(v as Record<string, unknown>)
            : v;
    }
    return out;
}

function buildFilter(f: QdrantFilter): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (f.must?.length) {
        out.must = f.must.map((c) => buildCondition(c));
    }
    if (f.should?.length) {
        out.should = f.should.map((c) => buildCondition(c));
    }
    if (f.mustNot?.length) {
        out.must_not = f.mustNot.map((c) => buildCondition(c));
    }
    return out;
}

function buildCondition(c: QdrantCondition): Record<string, unknown> {
    if (c.match) return { key: c.key, match: { value: c.match.value } };
    if (c.range) return { key: c.key, range: c.range };
    return { key: c.key };
}

async function withRetry<T>(
    fn: () => Promise<T>,
    operationName: string
): Promise<T> {
    return new Promise((resolve, reject) => {
        const operation = retry.operation({
            retries: 5,
            factor: 3,
            minTimeout: 1 * 1000,
            maxTimeout: 60 * 1000,
            randomize: true,
        });

        operation.attempt(async () => {
            try {
                resolve(await fn());
            } catch (err: unknown) {
                const axiosErr = err as AxiosError;
                const isRetryable =
                    !axiosErr.response ||
                    axiosErr.response.status >= 500 ||
                    axiosErr.code === "ECONNRESET" ||
                    axiosErr.code === "ETIMEDOUT";

                if (isRetryable && operation.retry(err as Error)) return;
                reject(err);
            }
        });
    });
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class Qdrant {
    QDRANT_URL: string;
    QDRANT_API_KEY?: string;

    private readonly _client: AxiosInstance;

    /**
     * @param QDRANT_URL  - Qdrant server URL, e.g. "http://localhost:6333"
     * @param QDRANT_API_KEY - Optional API key for authenticated Qdrant instances
     */
    constructor(QDRANT_URL?: string, QDRANT_API_KEY?: string) {
        const baseURL =
            (QDRANT_URL || process.env.QDRANT_URL || "").replace(/\/$/, "") ||
            "http://localhost:6333";
        const apiKey = QDRANT_API_KEY || process.env.QDRANT_API_KEY;

        this.QDRANT_URL = baseURL;
        this.QDRANT_API_KEY = apiKey;

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (apiKey) headers["api-key"] = apiKey;

        this._client = axios.create({
            baseURL,
            headers,
            timeout: 30_000,
        });
    }

    createClient() {
        return this;
    }

    // ── Collections ────────────────────────────────────────────────────────────

    /**
     * Create a new Qdrant collection.
     * @param collectionName - Unique name for the collection
     * @param options - Vector size and distance metric
     */
    async createCollection(
        collectionName: string,
        options: QdrantCollectionOptions
    ): Promise<void> {
        if (!collectionName) throw new Error("Collection name is required");
        if (!Number.isSafeInteger(options.size) || options.size < 1)
            throw new Error("Vector size must be a positive integer");

        const body: Record<string, unknown> = {
            vectors: {
                size: options.size,
                distance: options.distance ?? "Cosine",
            },
        };
        if (options.hnswConfig) {
            (body as Record<string, unknown>).hnsw_config = {
                m: options.hnswConfig.m,
                ef_construct: options.hnswConfig.efConstruct,
                full_scan_threshold: options.hnswConfig.fullScanThreshold,
            };
        }
        if (options.onDiskPayload !== undefined) {
            body.on_disk_payload = options.onDiskPayload;
        }

        await withRetry(
            () => this._client.put(`/collections/${collectionName}`, body),
            "createCollection"
        );
    }

    /**
     * Delete a collection by name.
     */
    async deleteCollection(collectionName: string): Promise<void> {
        if (!collectionName) throw new Error("Collection name is required");
        await withRetry(
            () => this._client.delete(`/collections/${collectionName}`),
            "deleteCollection"
        );
    }

    /**
     * Check if a collection exists.
     */
    async collectionExists(collectionName: string): Promise<boolean> {
        if (!collectionName) throw new Error("Collection name is required");
        const res = await withRetry(
            () =>
                this._client.get<{
                    result: { status: string; exists: boolean };
                }>(`/collections/${collectionName}`),
            "collectionExists"
        );
        return res.data.result.exists ?? res.data.result.status === "green";
    }

    /**
     * List all collection names.
     */
    async listCollections(): Promise<string[]> {
        const res = await withRetry(
            () =>
                this._client.get<{
                    result: { collections: { name: string }[] };
                }>("/collections"),
            "listCollections"
        );
        return res.data.result.collections.map((c) => c.name);
    }

    /**
     * Get collection info.
     */
    async getCollection(
        collectionName: string
    ): Promise<Record<string, unknown>> {
        if (!collectionName) throw new Error("Collection name is required");
        const res = await withRetry(
            () => this._client.get<{ result: Record<string, unknown> }>(`/collections/${collectionName}`),
            "getCollection"
        );
        return res.data.result;
    }

    // ── Points ────────────────────────────────────────────────────────────────

    /**
     * Upsert points into a collection.
     * Retries on transient failures.
     */
    async upsert(collectionName: string, points: QdrantPoint[]): Promise<void> {
        if (!collectionName) throw new Error("Collection name is required");
        if (!points.length) throw new Error("At least one point is required");
        for (const p of points) {
            if (!p.vector || !p.vector.length)
                throw new Error(`Point ${p.id} has no vector`);
        }

        await withRetry(
            () =>
                this._client.put(`/collections/${collectionName}/points`, {
                    points: points.map((p) => ({
                        id: p.id,
                        vector: p.vector,
                        payload: p.payload ?? {},
                    })),
                }),
            "upsert"
        );
    }

    /**
     * Search for nearest points in a collection.
     */
    async search(
        collectionName: string,
        vector: number[],
        options: QdrantSearchOptions = {}
    ): Promise<QdrantScoredPoint[]> {
        if (!collectionName) throw new Error("Collection name is required");
        if (!vector?.length) throw new Error("Query vector is required");

        const payload: Record<string, unknown> = {
            vector,
            limit: options.limit ?? 5,
        };
        if (options.offset !== undefined) payload.offset = options.offset;
        if (options.withPayload !== undefined) payload.with_payload = options.withPayload;
        if (options.withVector !== undefined) payload.with_vector = options.withVector;
        if (options.scoreThreshold !== undefined)
            payload.score_threshold = options.scoreThreshold;
        if (options.filter) payload.filter = buildFilter(options.filter);

        const res = await withRetry(
            () =>
                this._client.post<{ result: QdrantScoredPoint[] }>(
                    `/collections/${collectionName}/points/search`,
                    toSnake(payload as Record<string, unknown>)
                ),
            "search"
        );
        return res.data.result;
    }

    /**
     * Retrieve specific points by IDs.
     */
    async retrieve(
        collectionName: string,
        ids: QdrantPointId[],
        options: QdrantRetrieveOptions = {}
    ): Promise<QdrantPoint[]> {
        if (!collectionName) throw new Error("Collection name is required");
        if (!ids.length) return [];

        const payload: Record<string, unknown> = { ids };
        if (options.withPayload !== undefined) payload.with_payload = options.withPayload;
        if (options.withVector !== undefined) payload.with_vector = options.withVector;

        const res = await withRetry(
            () =>
                this._client.post<{ result: QdrantPoint[] }>(
                    `/collections/${collectionName}/points/read`,
                    payload
                ),
            "retrieve"
        );
        return res.data.result;
    }

    /**
     * Scroll through all points in a collection (with optional filtering).
     */
    async scroll(
        collectionName: string,
        options: QdrantScrollOptions = {}
    ): Promise<{ points: QdrantPoint[]; nextPageOffset?: string }> {
        if (!collectionName) throw new Error("Collection name is required");

        const payload: Record<string, unknown> = {
            limit: options.limit ?? 100,
        };
        if (options.offset !== undefined) payload.offset = options.offset;
        if (options.withPayload !== undefined) payload.with_payload = options.withPayload;
        if (options.withVector !== undefined) payload.with_vector = options.withVector;
        if (options.filter) payload.filter = buildFilter(options.filter);

        const res = await withRetry(
            () =>
                this._client.post<{
                    result: { points: QdrantPoint[]; next_page_offset?: string };
                }>(`/collections/${collectionName}/points/scroll`, payload),
            "scroll"
        );
        return {
            points: res.data.result.points,
            nextPageOffset: res.data.result.next_page_offset,
        };
    }

    /**
     * Delete points by IDs.
     */
    async delete(
        collectionName: string,
        ids: QdrantPointId[]
    ): Promise<void> {
        if (!collectionName) throw new Error("Collection name is required");
        if (!ids.length) return;

        await withRetry(
            () =>
                this._client.post(`/collections/${collectionName}/points/delete`, {
                    points: ids,
                }),
            "delete"
        );
    }

    /**
     * Delete points matching a filter condition.
     */
    async deleteByFilter(
        collectionName: string,
        filter: QdrantFilter
    ): Promise<void> {
        if (!collectionName) throw new Error("Collection name is required");

        await withRetry(
            () =>
                this._client.post(`/collections/${collectionName}/points/delete`, {
                    filter: buildFilter(filter),
                }),
            "deleteByFilter"
        );
    }

    /**
     * Count points in a collection (optionally filtered).
     */
    async count(
        collectionName: string,
        filter?: QdrantFilter
    ): Promise<number> {
        if (!collectionName) throw new Error("Collection name is required");

        const payload: Record<string, unknown> = { exact: true };
        if (filter) payload.filter = buildFilter(filter);

        const res = await withRetry(
            () =>
                this._client.post<{ result: { count: number } }>(
                    `/collections/${collectionName}/points/count`,
                    payload
                ),
            "count"
        );
        return res.data.result.count;
    }
}
