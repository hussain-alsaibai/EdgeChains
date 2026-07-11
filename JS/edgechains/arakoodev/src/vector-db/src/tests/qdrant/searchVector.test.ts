import { Qdrant } from "../../../../../dist/vector-db/src/lib/qdrant/qdrant.js";

const MOCK_QDRANT_URL = "https://mock-qdrant.example.com";
const MOCK_QDRANT_API_KEY = "mock-api-key";

jest.mock("../../../../../dist/vector-db/src/lib/qdrant/qdrant.js", () => {
    return {
        Qdrant: jest.fn().mockImplementation(() => ({
            createClient: jest.fn(() => ({
                post: jest.fn().mockResolvedValue({ status: 200, data: { result: [] } }),
            })),
            searchVector: jest
                .fn()
                .mockImplementation(async ({ collectionName, vector, top }) => {
                    return [
                        {
                            id: 1,
                            score: 0.95,
                            payload: { content: "first match" },
                        },
                        {
                            id: 2,
                            score: 0.87,
                            payload: { content: "second match" },
                        },
                    ].slice(0, top ?? 10);
                }),
        })),
    };
});

it("should return nearest neighbours for a query vector", async () => {
    const qdrant = new Qdrant(MOCK_QDRANT_URL, MOCK_QDRANT_API_KEY);
    const client = qdrant.createClient();
    const collectionName = "test_collection";
    const vector = Array.from({ length: 1536 }, (_, i) => i);

    const result = await qdrant.searchVector({ client, collectionName, vector, top: 2 });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
        expect.objectContaining({ id: 1, score: 0.95 })
    );
}, 10000);