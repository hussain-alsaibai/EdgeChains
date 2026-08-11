import axios from "axios";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Qdrant } from "../../lib/qdrant/qdrant.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

function mockSuccess<T>(data: T) {
    return { data: { result: data } } as unknown as ReturnType<ReturnType<typeof axios.create>["post"]>;
}
function mockGet<T>(data: T) {
    return { data: { result: data } } as unknown as ReturnType<ReturnType<typeof axios.create>["get"]>;
}

describe("Qdrant", () => {
    let client: Qdrant;
    let mockAxiosInstance: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockAxiosInstance = vi.fn() as unknown as ReturnType<typeof axios.create>;
        mockAxiosInstance.get = vi.fn();
        mockAxiosInstance.put = vi.fn();
        mockAxiosInstance.post = vi.fn();
        mockAxiosInstance.delete = vi.fn();
        mockedAxios.create = vi.fn().mockReturnValue(mockAxiosInstance);
        client = new Qdrant("http://localhost:6333", "test-api-key");
    });

    // ── createCollection ──────────────────────────────────────────────────────

    describe("createCollection", () => {
        it("creates collection with required fields", async () => {
            (mockAxiosInstance.put as ReturnType<typeof vi.fn>).mockResolvedValue(mockSuccess({}));

            await client.createCollection("my-collection", { size: 768 });

            expect(mockAxiosInstance.put).toHaveBeenCalledWith(
                "/collections/my-collection",
                {
                    vectors: { size: 768, distance: "Cosine" },
                }
            );
        });

        it("uses provided distance metric", async () => {
            (mockAxiosInstance.put as ReturnType<typeof vi.fn>).mockResolvedValue(mockSuccess({}));

            await client.createCollection("my-collection", { size: 1536, distance: "Dot" });

            expect(mockAxiosInstance.put).toHaveBeenCalledWith(
                "/collections/my-collection",
                {
                    vectors: { size: 1536, distance: "Dot" },
                }
            );
        });

        it("includes hnswConfig when provided", async () => {
            (mockAxiosInstance.put as ReturnType<typeof vi.fn>).mockResolvedValue(mockSuccess({}));

            await client.createCollection("my-collection", {
                size: 768,
                hnswConfig: { m: 16, efConstruct: 200, fullScanThreshold: 10000 },
            });

            expect(mockAxiosInstance.put).toHaveBeenCalledWith(
                "/collections/my-collection",
                {
                    vectors: { size: 768, distance: "Cosine" },
                    hnsw_config: { m: 16, ef_construct: 200, full_scan_threshold: 10000 },
                }
            );
        });

        it("throws on invalid size", async () => {
            await expect(
                client.createCollection("my-collection", { size: 0 })
            ).rejects.toThrow("positive integer");
            await expect(
                client.createCollection("my-collection", { size: -1 })
            ).rejects.toThrow("positive integer");
            await expect(
                client.createCollection("my-collection", { size: 1.5 } as unknown as { size: number })
            ).rejects.toThrow("positive integer");
        });

        it("throws on empty collection name", async () => {
            await expect(
                client.createCollection("", { size: 768 })
            ).rejects.toThrow("Collection name is required");
        });
    });

    // ── deleteCollection ──────────────────────────────────────────────────────

    describe("deleteCollection", () => {
        it("deletes the named collection", async () => {
            (mockAxiosInstance.delete as ReturnType<typeof vi.fn>).mockResolvedValue(mockSuccess(true));

            await client.deleteCollection("my-collection");

            expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/collections/my-collection");
        });

        it("throws on empty collection name", async () => {
            await expect(client.deleteCollection("")).rejects.toThrow("Collection name is required");
        });
    });

    // ── collectionExists ─────────────────────────────────────────────────────

    describe("collectionExists", () => {
        it("returns true when collection exists", async () => {
            (mockAxiosInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockGet({ status: "green", exists: true })
            );

            const exists = await client.collectionExists("my-collection");
            expect(exists).toBe(true);
        });

        it("returns true when status is green (legacy)", async () => {
            (mockAxiosInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockGet({ status: "green" })
            );

            const exists = await client.collectionExists("my-collection");
            expect(exists).toBe(true);
        });

        it("returns false when collection does not exist", async () => {
            (mockAxiosInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockGet({ status: "red", exists: false })
            );

            const exists = await client.collectionExists("my-collection");
            expect(exists).toBe(false);
        });
    });

    // ── listCollections ───────────────────────────────────────────────────────

    describe("listCollections", () => {
        it("returns collection names", async () => {
            (mockAxiosInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockGet({ collections: [{ name: "a" }, { name: "b" }] })
            );

            const names = await client.listCollections();
            expect(names).toEqual(["a", "b"]);
        });

        it("returns empty array when no collections", async () => {
            (mockAxiosInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockGet({ collections: [] })
            );

            const names = await client.listCollections();
            expect(names).toEqual([]);
        });
    });

    // ── upsert ───────────────────────────────────────────────────────────────

    describe("upsert", () => {
        it("upserts points with vector and payload", async () => {
            (mockAxiosInstance.put as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockSuccess({ operationId: 1, status: "acknowledged" })
            );

            await client.upsert("my-collection", [
                { id: "doc-1", vector: [0.1, 0.2], payload: { text: "hello" } },
                { id: 2, vector: [0.3, 0.4] },
            ]);

            expect(mockAxiosInstance.put).toHaveBeenCalledWith(
                "/collections/my-collection/points",
                {
                    points: [
                        { id: "doc-1", vector: [0.1, 0.2], payload: { text: "hello" } },
                        { id: 2, vector: [0.3, 0.4], payload: {} },
                    ],
                }
            );
        });

        it("throws on empty points array", async () => {
            await expect(
                client.upsert("my-collection", [])
            ).rejects.toThrow("At least one point is required");
        });

        it("throws on point with no vector", async () => {
            await expect(
                client.upsert("my-collection", [{ id: "doc-1" } as unknown as { id: string; vector: number[] }])
            ).rejects.toThrow("no vector");
        });

        it("throws on empty collection name", async () => {
            await expect(
                client.upsert("", [{ id: "doc-1", vector: [0.1] }])
            ).rejects.toThrow("Collection name is required");
        });
    });

    // ── search ───────────────────────────────────────────────────────────────

    describe("search", () => {
        it("searches with defaults", async () => {
            (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockSuccess([
                    { id: "doc-1", score: 0.95, payload: { text: "hello" } },
                    { id: "doc-2", score: 0.88, payload: { text: "world" } },
                ])
            );

            const results = await client.search("my-collection", [0.1, 0.2]);

            expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                "/collections/my-collection/points/search",
                expect.objectContaining({ vector: [0.1, 0.2], limit: 5 })
            );
            expect(results).toHaveLength(2);
            expect(results[0].id).toBe("doc-1");
            expect(results[0].score).toBe(0.95);
        });

        it("passes all search options", async () => {
            (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockSuccess([]));

            await client.search("my-collection", [0.1, 0.2], {
                limit: 10,
                offset: 5,
                withPayload: ["text", "category"],
                withVector: true,
                scoreThreshold: 0.7,
                filter: {
                    must: [{ key: "category", match: { value: "news" } }],
                },
            });

            expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                "/collections/my-collection/points/search",
                expect.objectContaining({
                    vector: [0.1, 0.2],
                    limit: 10,
                    offset: 5,
                    with_payload: ["text", "category"],
                    with_vector: true,
                    score_threshold: 0.7,
                })
            );
            // filter must be built correctly (key + match nested)
            const call = (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(call[1].filter.must[0]).toEqual({
                key: "category",
                match: { value: "news" },
            });
        });

        it("throws on empty query vector", async () => {
            await expect(
                client.search("my-collection", [])
            ).rejects.toThrow("Query vector is required");
        });

        it("throws on empty collection name", async () => {
            await expect(
                client.search("", [0.1])
            ).rejects.toThrow("Collection name is required");
        });
    });

    // ── retrieve ─────────────────────────────────────────────────────────────

    describe("retrieve", () => {
        it("retrieves points by ids", async () => {
            (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockSuccess([{ id: "doc-1", vector: [0.1], payload: {} }])
            );

            const points = await client.retrieve("my-collection", ["doc-1", "doc-2"]);

            expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                "/collections/my-collection/points/read",
                { ids: ["doc-1", "doc-2"], with_payload: undefined, with_vector: undefined }
            );
            expect(points).toHaveLength(1);
        });

        it("returns empty array for empty ids", async () => {
            const points = await client.retrieve("my-collection", []);
            expect(points).toEqual([]);
            expect(mockAxiosInstance.post).not.toHaveBeenCalled();
        });
    });

    // ── scroll ───────────────────────────────────────────────────────────────

    describe("scroll", () => {
        it("scrolls with defaults", async () => {
            (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockSuccess({
                    points: [{ id: "doc-1", vector: [0.1], payload: {} }],
                    next_page_offset: "offset-token",
                })
            );

            const result = await client.scroll("my-collection");

            expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                "/collections/my-collection/points/scroll",
                expect.objectContaining({ limit: 100 })
            );
            expect(result.points).toHaveLength(1);
            expect(result.nextPageOffset).toBe("offset-token");
        });

        it("passes filter when provided", async () => {
            (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockSuccess({ points: [] })
            );

            await client.scroll("my-collection", {
                limit: 50,
                offset: "10",
                filter: {
                    must: [{ key: "namespace", match: { value: "dev" } }],
                    mustNot: [{ key: "deleted", match: { value: true } }],
                },
            });

            const call = (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(call[1].filter).toEqual({
                must: [{ key: "namespace", match: { value: "dev" } }],
                must_not: [{ key: "deleted", match: { value: true } }],
            });
        });
    });

    // ── delete ───────────────────────────────────────────────────────────────

    describe("delete", () => {
        it("deletes points by ids", async () => {
            (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockSuccess({ operationId: 3, status: "acknowledged" })
            );

            await client.delete("my-collection", ["doc-1", "doc-2"]);

            expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                "/collections/my-collection/points/delete",
                { points: ["doc-1", "doc-2"] }
            );
        });

        it("returns early for empty ids", async () => {
            await client.delete("my-collection", []);
            expect(mockAxiosInstance.post).not.toHaveBeenCalled();
        });
    });

    // ── deleteByFilter ───────────────────────────────────────────────────────

    describe("deleteByFilter", () => {
        it("deletes by filter", async () => {
            (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockSuccess({ operationId: 4, status: "acknowledged" })
            );

            await client.deleteByFilter("my-collection", {
                must: [{ key: "namespace", match: { value: "temp" } }],
            });

            expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                "/collections/my-collection/points/delete",
                { filter: { must: [{ key: "namespace", match: { value: "temp" } }] } }
            );
        });
    });

    // ── count ────────────────────────────────────────────────────────────────

    describe("count", () => {
        it("returns point count", async () => {
            (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockSuccess({ count: 42 })
            );

            const count = await client.count("my-collection");
            expect(count).toBe(42);
        });

        it("passes filter when provided", async () => {
            (mockAxiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockSuccess({ count: 7 })
            );

            await client.count("my-collection", {
                must: [{ key: "status", match: { value: "active" } }],
            });

            expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                "/collections/my-collection/points/count",
                {
                    exact: true,
                    filter: { must: [{ key: "status", match: { value: "active" } }] },
                }
            );
        });
    });

    // ── createClient ─────────────────────────────────────────────────────────

    describe("createClient", () => {
        it("returns the instance itself", () => {
            expect(client.createClient()).toBe(client);
        });
    });
});
