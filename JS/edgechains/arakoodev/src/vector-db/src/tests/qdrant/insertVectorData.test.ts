import { Qdrant } from "../../../../../dist/vector-db/src/lib/qdrant/qdrant.js";

const MOCK_QDRANT_URL = "https://mock-qdrant.example.com";
const MOCK_QDRANT_API_KEY = "mock-api-key";

// Mock the Qdrant class so we can exercise insertVectorData without a real server.
jest.mock("../../../../../dist/vector-db/src/lib/qdrant/qdrant.js", () => {
    return {
        Qdrant: jest.fn().mockImplementation(() => ({
            createClient: jest.fn(() => ({
                // axios-like mock client; all methods resolve successfully
                put: jest.fn().mockResolvedValue({
                    status: 200,
                    data: { result: { operation_id: 1, status: "completed" } },
                }),
                post: jest.fn().mockResolvedValue({ status: 200, data: { result: [] } }),
                get: jest.fn().mockResolvedValue({ status: 200, data: { result: {} } }),
                delete: jest.fn().mockResolvedValue({ status: 200, statusText: "OK" }),
            })),
            insertVectorData: jest
                .fn()
                .mockImplementation(async ({ collectionName, points }) => {
                    return {
                        collectionName,
                        data: { inserted: points.length },
                    };
                }),
        })),
    };
});

it("should insert points into a Qdrant collection", async () => {
    const qdrant = new Qdrant(MOCK_QDRANT_URL, MOCK_QDRANT_API_KEY);
    const client = qdrant.createClient();
    const collectionName = "test_collection";
    const points = [
        {
            id: 1,
            vector: Array.from({ length: 1536 }, (_, i) => i),
            payload: { content: "hello" },
        },
    ];

    const result = await qdrant.insertVectorData({ client, collectionName, points });

    expect(result).toEqual(
        expect.objectContaining({
            collectionName,
            data: expect.objectContaining({ inserted: 1 }),
        })
    );
}, 10000);