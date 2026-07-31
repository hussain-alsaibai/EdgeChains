import axios from "axios";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QdrantClient, QdrantPoint, QdrantSearchParams } from "../../lib/qdrant-client/QdrantClient";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

function mockResponse<T>(data: T) {
  return { data: { result: data } } as Awaited<ReturnType<typeof axios.create>>;
}

describe("QdrantClient", () => {
  let client: QdrantClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.create = vi.fn().mockReturnValue({
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    } as unknown as ReturnType<typeof axios.create>);
    client = new QdrantClient("http://localhost:6333", "test-collection");
  });

  // ── Collections ───────────────────────────────────────────────────────────

  describe("createCollection", () => {
    it("creates a collection with the correct payload", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.put as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({}));

      await client.createCollection("my-collection", {
        vectors: { size: 768, distance: "Cosine" as const },
      });

      expect(mockAxios.put).toHaveBeenCalledWith("/collections/my-collection", {
        vectors: { size: 768, distance: "Cosine" },
        optimizers_config: undefined,
        on_disk_payload: undefined,
      });
    });

    it("passes hnswConfig and onDiskPayload", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.put as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({}));

      await client.createCollection("my-collection", {
        vectors: { size: 1536, distance: "Dot" as const, hnswConfig: { m: 16, efConstruct: 200 } },
        onDiskPayload: true,
      });

      expect(mockAxios.put).toHaveBeenCalledWith("/collections/my-collection", {
        vectors: {
          size: 1536,
          distance: "Dot",
          hnswConfig: { m: 16, efConstruct: 200 },
        },
        optimizers_config: undefined,
        on_disk_payload: true,
      });
    });
  });

  describe("deleteCollection", () => {
    it("deletes the named collection", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.delete as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(true));

      await expect(client.deleteCollection("my-collection")).resolves.toBeUndefined();
      expect(mockAxios.delete).toHaveBeenCalledWith("/collections/my-collection");
    });
  });

  describe("collectionExists", () => {
    it("returns true when collection exists", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ exists: true })
      );

      const exists = await client.collectionExists("my-collection");
      expect(exists).toBe(true);
    });

    it("returns false when collection does not exist", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ exists: false })
      );

      const exists = await client.collectionExists("missing-collection");
      expect(exists).toBe(false);
    });
  });

  describe("listCollections", () => {
    it("returns an array of collection names", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ collections: [{ name: "a" }, { name: "b" }] })
      );

      const names = await client.listCollections();
      expect(names).toEqual(["a", "b"]);
    });
  });

  // ── Points ────────────────────────────────────────────────────────────────

  describe("upsert", () => {
    it("sends points with id, vector, and payload", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.put as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ operationId: 1, status: "completed" })
      );

      const points: QdrantPoint[] = [
        { id: "doc-1", vector: [0.1, 0.2], payload: { text: "hello" } },
        { id: 2, vector: [0.3, 0.4], payload: { text: "world" } },
      ];

      const result = await client.upsert(points);

      expect(mockAxios.put).toHaveBeenCalledWith("/collections/test-collection/points", {
        points: [
          { id: "doc-1", vector: [0.1, 0.2], payload: { text: "hello" } },
          { id: 2, vector: [0.3, 0.4], payload: { text: "world" } },
        ],
      });
      expect(result).toEqual({ operationId: 1, status: "completed" });
    });

    it("omits payload when undefined", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.put as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ operationId: 2, status: "acknowledged" })
      );

      await client.upsert([{ id: "doc-2", vector: [0.5, 0.6] }]);

      expect(mockAxios.put).toHaveBeenCalledWith("/collections/test-collection/points", {
        points: [{ id: "doc-2", vector: [0.5, 0.6], payload: {} }],
      });
    });
  });

  describe("delete", () => {
    it("deletes points by ids", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.post as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ operationId: 3, status: "acknowledged" })
      );

      const result = await client.delete(["doc-1", "doc-2"]);

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/collections/test-collection/points/delete",
        { points: ["doc-1", "doc-2"] }
      );
      expect(result.operationId).toBe(3);
    });

    it("handles numeric ids", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.post as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ operationId: 4, status: "acknowledged" })
      );

      await client.delete([1, 2, 3]);

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/collections/test-collection/points/delete",
        { points: [1, 2, 3] }
      );
    });
  });

  describe("search", () => {
    it("searches with defaults", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.post as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse([
          { id: "doc-1", score: 0.95, payload: { text: "hello" } },
          { id: "doc-2", score: 0.88, payload: { text: "world" } },
        ])
      );

      const results = await client.search({ vector: [0.1, 0.2] });

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/collections/test-collection/points/search",
        expect.objectContaining({
          vector: [0.1, 0.2],
          limit: 5,
          offset: 0,
          with_payload: true,
          with_vector: false,
        })
      );
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("doc-1");
      expect(results[0].score).toBe(0.95);
    });

    it("passes all search parameters", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse([]));

      const params: QdrantSearchParams = {
        vector: [0.1, 0.2],
        limit: 10,
        offset: 20,
        withPayload: ["text", "category"],
        withVector: true,
        scoreThreshold: 0.7,
        filter: {
          must: [{ key: "category", match: { value: "news" } }],
        },
      };

      await client.search(params);

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/collections/test-collection/points/search",
        expect.objectContaining({
          limit: 10,
          offset: 20,
          with_payload: ["text", "category"],
          with_vector: true,
          score_threshold: 0.7,
        })
      );
    });

    it("maps snake_case filter keys correctly", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse([]));

      await client.search({
        vector: [0.1],
        filter: {
          must: [{ key: "year", range: { gte: 2020, lt: 2025 } }],
          should: [{ key: "verified", match: { value: true } }],
          mustNot: [{ key: "deleted", match: { value: true } }],
        },
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/collections/test-collection/points/search",
        expect.objectContaining({
          filter: {
            must: [{ key: "year", range: { gte: 2020, lt: 2025 } }],
            should: [{ key: "verified", match: { value: true } }],
            must_not: [{ key: "deleted", match: { value: true } }],
          },
        })
      );
    });
  });

  describe("retrieve", () => {
    it("retrieves points by ids", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.post as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse([{ id: "doc-1", vector: [0.1, 0.2], payload: {} }])
      );

      const points = await client.retrieve(["doc-1", "doc-2"]);

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/collections/test-collection/points/read",
        { ids: ["doc-1", "doc-2"], with_payload: true, with_vector: false }
      );
      expect(points).toHaveLength(1);
    });
  });

  describe("scroll", () => {
    it("scrolls through all points", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.post as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({
          points: [{ id: "doc-1", vector: [0.1], payload: {} }],
          next_page_offset: "offset-token",
        })
      );

      const result = await client.scroll(undefined, 100);

      expect(result.points).toHaveLength(1);
      expect(result.nextPageOffset).toBeDefined();
    });

    it("passes filter and pagination params", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.post as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ points: [], next_page_offset: undefined })
      );

      await client.scroll(
        { must: [{ key: "namespace", match: { value: "dev" } }] },
        50,
        10
      );

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/collections/test-collection/points/scroll",
        expect.objectContaining({
          filter: { must: [{ key: "namespace", match: { value: "dev" } }] },
          limit: 50,
          offset: 10,
        })
      );
    });
  });

  describe("count", () => {
    it("returns the point count", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.post as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ count: 42 })
      );

      const count = await client.count();
      expect(count).toBe(42);
    });

    it("passes filter when provided", async () => {
      const mockAxios = mockedAxios.create();
      (mockAxios.post as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ count: 7 })
      );

      await client.count({ must: [{ key: "status", match: { value: "active" } }] });

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/collections/test-collection/points/count",
        {
          filter: { must: [{ key: "status", match: { value: "active" } }] },
          exact: true,
        }
      );
    });
  });
});
