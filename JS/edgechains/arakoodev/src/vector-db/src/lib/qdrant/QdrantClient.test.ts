import { QdrantClient, QdrantDistanceMetric } from "./QdrantClient";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const BASE_URL = "http://localhost:6333";
const COLLECTION = "test_collection";

function mockResponse(status: number, body: any) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe("QdrantClient", () => {
  let client: QdrantClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new QdrantClient(BASE_URL);
  });

  // ─── Collection Management ─────────────────────────────────────────────────

  describe("createCollection", () => {
    it("should create a collection with vector config", async () => {
      mockResponse(200, { result: true });
      const result = await client.createCollection(COLLECTION, {
        vectors: { size: 1536, distance: QdrantDistanceMetric.COSINE },
      });
      expect(result.result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/collections/${COLLECTION}`,
        expect.objectContaining({ method: "PUT" })
      );
    });
  });

  describe("deleteCollection", () => {
    it("should delete a collection", async () => {
      mockResponse(200, { result: true });
      const result = await client.deleteCollection(COLLECTION);
      expect(result.result).toBe(true);
    });
  });

  describe("listCollections", () => {
    it("should return list of collections", async () => {
      mockResponse(200, { result: { collections: [{ name: "test" }] } });
      const result = await client.listCollections();
      expect(result.result.collections).toHaveLength(1);
    });
  });

  describe("collectionExists", () => {
    it("should return true when collection exists", async () => {
      mockResponse(200, { result: { name: COLLECTION } });
      const exists = await client.collectionExists(COLLECTION);
      expect(exists).toBe(true);
    });

    it("should return false when collection does not exist", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Not found"));
      const exists = await client.collectionExists("nonexistent");
      expect(exists).toBe(false);
    });
  });

  // ─── Points ────────────────────────────────────────────────────────────────

  describe("upsert", () => {
    it("should upsert points to collection", async () => {
      mockResponse(200, { result: { operation_id: 1 }, status: "completed" });
      const points = [
        { id: "1", vector: [0.1, 0.2, 0.3], payload: { text: "hello" } },
        { id: "2", vector: [0.4, 0.5, 0.6], payload: { text: "world" } },
      ];
      const result = await client.upsert(COLLECTION, points);
      expect(result.status).toBe("completed");
    });
  });

  describe("search", () => {
    it("should search for similar vectors", async () => {
      mockResponse(200, {
        result: [
          { id: "1", score: 0.95, payload: { text: "hello" } },
          { id: "2", score: 0.87, payload: { text: "world" } },
        ],
      });
      const results = await client.search(
        COLLECTION,
        [0.1, 0.2, 0.3],
        { limit: 10 },
        QdrantDistanceMetric.COSINE
      );
      expect(results).toHaveLength(2);
      expect(results[0].score).toBe(0.95);
    });

    it("should apply score threshold filter", async () => {
      mockResponse(200, { result: [{ id: "1", score: 0.95 }] });
      const results = await client.search(
        COLLECTION,
        [0.1, 0.2, 0.3],
        { limit: 10, score_threshold: 0.9 }
      );
      expect(results[0].score).toBe(0.95);
    });
  });

  describe("getById", () => {
    it("should retrieve a point by id", async () => {
      mockResponse(200, {
        result: { id: "1", vector: [0.1, 0.2], payload: { text: "hello" } },
      });
      const result = await client.getById(COLLECTION, "1");
      expect(result.id).toBe("1");
    });
  });

  describe("deleteById", () => {
    it("should delete a point by id", async () => {
      mockResponse(200, { result: true });
      const result = await client.deleteById(COLLECTION, "1");
      expect(result.result).toBe(true);
    });
  });

  describe("deleteByIds", () => {
    it("should delete multiple points", async () => {
      mockResponse(200, { result: true });
      const result = await client.deleteByIds(COLLECTION, ["1", "2", "3"]);
      expect(result.result).toBe(true);
    });
  });

  describe("scroll", () => {
    it("should scroll through collection points", async () => {
      mockResponse(200, {
        result: {
          points: [
            { id: "1", payload: { text: "a" } },
            { id: "2", payload: { text: "b" } },
          ],
          next_page_offset: null,
        },
      });
      const points = await client.scroll(COLLECTION, undefined, 100);
      expect(points).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    it("should throw on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not found"),
      });
      await expect(client.getById(COLLECTION, "nonexistent")).rejects.toThrow(
        "Qdrant API error 404"
      );
    });

    it("should throw on timeout", async () => {
      mockFetch.mockImplementation(
        () => new Promise((r) => setTimeout(() => r({ ok: true, json: () => {} }), 5000))
      );
      const shortClient = new QdrantClient(BASE_URL, undefined, 100);
      await expect(shortClient.listCollections()).rejects.toThrow("timed out");
    });
  });
});
