local secrets = import "secrets.jsonnet";

// ─── 1. Create client ────────────────────────────────────────────────────────
local QdrantClient = import "../../../arakoodev/src/db/src/lib/qdrant-client/QdrantClient";

local client = QdrantClient(secrets.qdrantUrl, secrets.collectionName);

// ─── 2. Create collection (run once) ────────────────────────────────────────
local created = client.createCollection(secrets.collectionName, {
  vectors: {
    size: secrets.vectorSize,
    distance: "Cosine",
    hnswConfig: { m: 16, efConstruct: 100 },
  },
});

// ─── 3. Upsert documents ──────────────────────────────────────────────────────
// Each document has an id, a 768-dim embedding vector, and a JSON payload.
// In production the embedding comes from an AI endpoint (OpenAI / Gemini / etc).
local documents = [
  {
    id: "doc-001",
    vector: [0.01 * 1, 0.01 * 2, 0.01 * 3] + [0] * (secrets.vectorSize - 3),
    payload: {
      title: "Introduction to EdgeChains",
      text: "EdgeChains lets you build LLM-powered applications with JSONnet configuration.",
      namespace: "docs",
      tags: ["llm", "jsonnet", "typescript"],
    },
  },
  {
    id: "doc-002",
    vector: [0.02 * 1, 0.02 * 2, 0.02 * 3] + [0] * (secrets.vectorSize - 3),
    payload: {
      title: "Qdrant Vector Search",
      text: "Qdrant is a high-performance vector search engine with filtering support.",
      namespace: "docs",
      tags: ["vector-db", "search", "qdrant"],
    },
  },
];

local upsertResult = client.upsert(documents);

// ─── 4. Semantic search ───────────────────────────────────────────────────────
// Query embedding would normally come from an AI model's embed() call.
local queryVector = [0.015 * 1, 0.015 * 2, 0.015 * 3] + [0] * (secrets.vectorSize - 3);

local searchResults = client.search({
  vector: queryVector,
  limit: 5,
  scoreThreshold: 0.5,
  filter: {
    must: [{ key: "namespace", match: { value: "docs" } }],
  },
});

// ─── 5. Count ─────────────────────────────────────────────────────────────────
local totalDocs = client.count();

// ─── 6. Delete by filter ──────────────────────────────────────────────────────
local deleted = client.deleteByFilter({
  must: [{ key: "namespace", match: { value: "test" } }],
});

// ─── Output ───────────────────────────────────────────────────────────────────
{
  collectionCreated: created,
  upserted: upsertResult,
  searchResults: searchResults,
  totalDocs: totalDocs,
  deleted: deleted,
}
