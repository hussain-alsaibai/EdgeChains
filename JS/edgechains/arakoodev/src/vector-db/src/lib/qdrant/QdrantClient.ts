import retry from "retry";

export enum QdrantDistanceMetric {
  COSINE = "Cosine",
  EUCLID = "Euclid",
  DOT = "Dot",
}

interface QdrantVector {
  id: string | number;
  vector: number[];
  payload?: Record<string, any>;
}

interface QdrantSearchParams {
  limit: number;
  offset?: number;
  with_payload?: boolean;
  with_vector?: boolean;
  score_threshold?: number;
  filter?: Record<string, any>;
}

interface QdrantCollectionConfig {
  vectors: {
    size: number;
    distance: QdrantDistanceMetric;
  };
  optimizers_config?: Record<string, any>;
  shard_number?: number;
}

export class QdrantClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(baseUrl: string, apiKey?: string, timeout = 30000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.timeout = timeout;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any,
    signal?: AbortSignal
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["api-key"] = this.apiKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const fetchSignal = signal || controller.signal;

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: fetchSignal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Qdrant API error ${res.status}: ${errText}`);
      }

      return res.json() as Promise<T>;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new Error(`Qdrant request timed out after ${this.timeout}ms`);
      }
      throw err;
    }
  }

  // ─── Collection Management ────────────────────────────────────────────────

  async createCollection(
    collectionName: string,
    config: QdrantCollectionConfig
  ): Promise<any> {
    return this.request("PUT", `/collections/${collectionName}`, {
      vectors,
    });
  }

  async deleteCollection(collectionName: string): Promise<any> {
    return this.request("DELETE", `/collections/${collectionName}`);
  }

  async listCollections(): Promise<any> {
    return this.request("GET", "/collections");
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    const result = await this.request<any>("GET", `/collections/${collectionName}`);
    return result.result !== null;
  }

  // ─── Points (Vectors + Payload) ──────────────────────────────────────────

  async upsert(collectionName: string, points: QdrantVector[]): Promise<any> {
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
          const res = await this.request<any>("PUT", `/collections/${collectionName}/points`, {
            points,
          });
          if (res.status === "completed" || res.result) {
            resolve(res);
          } else if (operation.retry(new Error(JSON.stringify(res)))) {
            return;
          } else {
            reject(new Error(`Upsert failed: ${JSON.stringify(res)}`));
          }
        } catch (err: any) {
          if (operation.retry(err)) return;
          reject(err);
        }
      });
    });
  }

  async search(
    collectionName: string,
    vector: number[],
    params: QdrantSearchParams,
    metric: QdrantDistanceMetric = QdrantDistanceMetric.COSINE
  ): Promise<any[]> {
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
          const res = await this.request<any>("POST", `/collections/${collectionName}/points/search`, {
            vector,
            limit: params.limit,
            offset: params.offset,
            with_payload: params.with_payload !== false,
            with_vector: params.with_vector || false,
            score_threshold: params.score_threshold,
            filter: params.filter,
          });
          resolve(res.result || []);
        } catch (err: any) {
          if (operation.retry(err)) return;
          reject(err);
        }
      });
    });
  }

  async getById(collectionName: string, id: string | number): Promise<any> {
    const res = await this.request<any>(
      "GET",
      `/collections/${collectionName}/points/${id}`
    );
    return res.result;
  }

  async deleteById(collectionName: string, id: string | number): Promise<any> {
    return this.request("DELETE", `/collections/${collectionName}/points/${id}`);
  }

  async deleteByIds(collectionName: string, ids: (string | number)[]): Promise<any> {
    return this.request("POST", `/collections/${collectionName}/points/delete`, {
      points: ids,
    });
  }

  async scroll(
    collectionName: string,
    filter?: Record<string, any>,
    limit = 100,
    offset?: string
  ): Promise<any[]> {
    const res = await this.request<any>("POST", `/collections/${collectionName}/points/scroll`, {
      filter,
      limit,
      offset,
      with_payload: true,
      with_vector: false,
    });
    return res.result?.points || [];
  }
}
