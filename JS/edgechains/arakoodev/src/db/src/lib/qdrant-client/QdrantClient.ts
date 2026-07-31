import axios, { AxiosInstance } from "axios";

// ─── Types ────────────────────────────────────────────────────────────────────

export enum QdrantDistanceMetric {
  COSINE = "Cosine",
  EUCLID = "Euclid",
  DOT = "Dot",
}

export interface QdrantPoint {
  id: string | number;
  vector: number[];
  payload?: Record<string, unknown>;
}

export interface QdrantSearchParams {
  vector: number[];
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
  minShouldMatch?: number;
}

export interface QdrantCondition {
  key: string;
  match?: { value: string | number | boolean };
  range?: { gt?: number; gte?: number; lt?: number; lte?: number };
  nested?: { key: string; filter: QdrantFilter };
}

export interface QdrantSearchResult {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
  vector?: number[];
}

export interface QdrantCollectionParams {
  vectors: {
    size: number;
    distance: QdrantDistanceMetric;
    hnswConfig?: {
      m?: number;
      efConstruct?: number;
      fullScanThreshold?: number;
    };
  };
  optimizersConfig?: {
    indexedThreshold?: number;
    memmapThreshold?: number;
    onDisk?: boolean;
  };
  onDiskPayload?: boolean;
}

export interface QdrantUpsertResult {
  operationId: number;
  status: "acknowledged" | "completed";
}

export interface QdrantDeleteResult {
  operationId: number;
  status: "acknowledged" | "completed";
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class QdrantClient {
  private client: AxiosInstance;
  readonly url: string;
  readonly collection: string;
  readonly timeout: number;

  /**
   * @param url - Qdrant server URL, e.g. "http://localhost:6333"
   * @param collection - Target collection name
   * @param timeout - Request timeout in ms (default 30000)
   */
  constructor(url: string, collection: string, timeout = 30000) {
    this.url = url;
    this.collection = collection;
    this.timeout = timeout;
    this.client = axios.create({ baseURL: url, timeout });
  }

  // ── Collections ─────────────────────────────────────────────────────────────

  async createCollection(
    name: string,
    params: QdrantCollectionParams
  ): Promise<void> {
    await this.client.put(`/collections/${name}`, {
      vectors: params.vectors,
      optimizers_config: params.optimizersConfig,
      on_disk_payload: params.onDiskPayload,
    });
  }

  async deleteCollection(name: string): Promise<void> {
    await this.client.delete(`/collections/${name}`);
  }

  async collectionExists(name: string): Promise<boolean> {
    const res = await this.client.get<{ result: { exists: boolean } }>(
      `/collections/${name}`
    );
    return res.data.result.exists;
  }

  async listCollections(): Promise<string[]> {
    const res = await this.client.get<{ result: { collections: { name: string }[] } }>(
      "/collections"
    );
    return res.data.result.collections.map((c) => c.name);
  }

  // ── Points ──────────────────────────────────────────────────────────────────

  async upsert(points: QdrantPoint[]): Promise<QdrantUpsertResult> {
    const res = await this.client.put<
      Record<string, unknown>,
      { data: { result: QdrantUpsertResult } }
    >(`/collections/${this.collection}/points`, {
      points: points.map((p) => ({
        id: typeof p.id === "string" ? p.id : p.id,
        vector: p.vector,
        payload: p.payload ?? {},
      })),
    });
    return res.data.result;
  }

  async delete(ids: (string | number)[]): Promise<QdrantDeleteResult> {
    const res = await this.client.post<
      Record<string, unknown>,
      { data: { result: QdrantDeleteResult } }
    >(`/collections/${this.collection}/points/delete`, {
      points: ids,
    });
    return res.data.result;
  }

  async deleteByFilter(filter: QdrantFilter): Promise<QdrantDeleteResult> {
    const res = await this.client.post<
      Record<string, unknown>,
      { data: { result: QdrantDeleteResult } }
    >(`/collections/${this.collection}/points/delete`, {
      filter: this._buildFilter(filter),
    });
    return res.data.result;
  }

  async search(params: QdrantSearchParams): Promise<QdrantSearchResult[]> {
    const res = await this.client.post<
      Record<string, unknown>,
      {
        data: {
          result: Array<{
            id: string | number;
            score: number;
            payload?: Record<string, unknown>;
            vector?: number[];
          }>;
        };
      }
    >(`/collections/${this.collection}/points/search`, {
      vector: params.vector,
      limit: params.limit ?? 5,
      offset: params.offset ?? 0,
      with_payload: params.withPayload ?? true,
      with_vector: params.withVector ?? false,
      score_threshold: params.scoreThreshold,
      filter: params.filter ? this._buildFilter(params.filter) : undefined,
    });

    return res.data.result.map((r) => ({
      id: r.id,
      score: r.score,
      payload: r.payload,
      vector: r.vector,
    }));
  }

  async retrieve(
    ids: (string | number)[],
    withPayload = true,
    withVector = false
  ): Promise<QdrantPoint[]> {
    const res = await this.client.post<
      Record<string, unknown>,
      { data: { result: QdrantPoint[] } }
    >(`/collections/${this.collection}/points/read`, {
      ids: ids.map((id) => (typeof id === "string" ? id : id)),
      with_payload: withPayload,
      with_vector: withVector,
    });
    return res.data.result;
  }

  async scroll(
    filter?: QdrantFilter,
    limit = 100,
    offset?: number,
    withPayload = true,
    withVector = false
  ): Promise<{ points: QdrantPoint[]; nextPageOffset?: number }> {
    const res = await this.client.post<
      Record<string, unknown>,
      {
        data: {
          result: {
            points: QdrantPoint[];
            next_page_offset?: string;
          };
        };
      }
    >(`/collections/${this.collection}/points/scroll`, {
      filter: filter ? this._buildFilter(filter) : undefined,
      limit,
      offset,
      with_payload: withPayload,
      with_vector: withVector,
    });

    return {
      points: res.data.result.points,
      nextPageOffset: res.data.result.next_page_offset
        ? parseInt(res.data.result.next_page_offset as string)
        : undefined,
    };
  }

  async count(filter?: QdrantFilter): Promise<number> {
    const res = await this.client.post<
      Record<string, unknown>,
      { data: { result: { count: number } } }
    >(`/collections/${this.collection}/points/count`, {
      filter: filter ? this._buildFilter(filter) : undefined,
      exact: true,
    });
    return res.data.result.count;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _buildFilter(f: QdrantFilter): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    if (f.must?.length) {
      out.must = f.must.map((c) => this._buildCondition(c));
    }
    if (f.should?.length) {
      out.should = f.should.map((c) => this._buildCondition(c));
    }
    if (f.mustNot?.length) {
      out.must_not = f.mustNot.map((c) => this._buildCondition(c));
    }
    if (f.minShouldMatch !== undefined) {
      out.min_should_match = f.minShouldMatch;
    }

    return out;
  }

  private _buildCondition(c: QdrantCondition): Record<string, unknown> {
    const base: Record<string, unknown> = { key: c.key };

    if (c.match) {
      return { ...base, match: { value: c.match.value } };
    }
    if (c.range) {
      return { ...base, range: c.range };
    }
    if (c.nested) {
      return {
        ...base,
        nested: {
          key: c.nested.key,
          filter: this._buildFilter(c.nested.filter),
        },
      };
    }

    return base;
  }
}
