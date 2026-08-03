import Jsonnet from "@arakoodev/jsonnet";
import { OpenAiEndpoint } from "@arakoodev/edgechains.js";
import {
    PostgresClient,
    PostgresDistanceMetric as PgMetric,
    QdrantVectorDB,
    QdrantDistanceMetric as QdrantMetric,
    type ArkRequestLike,
} from "@arakoodev/edgechains.js";
import * as path from "path";

export enum VectorDBProvider {
    POSTGRES = "postgres",
    QDRANT = "qdrant",
}

export interface ArkRequest extends ArkRequestLike {
    topK?: number;
    metadataTable?: string;
    vectorDB?: VectorDBProvider;
    qdrantCollection?: string;
}

/**
 * Map a PostgresDistanceMetric to the string form used by both clients.
 */
function pgMetricFromString(metric: string): "COSINE" | "IP" | "L2" {
    switch (metric) {
        case "COSINE": return "COSINE";
        case "IP":     return "IP";
        case "L2":     return "L2";
        default:        return "COSINE";
    }
}

async function hydeSearchAdaEmbedding(
    arkRequest: ArkRequest,
    apiKey: string,
    orgId: string,
    qdrantUrl?: string
) {
    try {
        const gpt3endpoint = new OpenAiEndpoint(
            "https://api.openai.com/v1/chat/completions",
            apiKey,
            orgId,
            "gpt-3.5-turbo",
            "user",
            parseInt("0.7")
        );

        const table         = "ada_hyde_prod";
        const namespace     = "360_docs";
        const query         = arkRequest.query ?? "";
        const topK          = Number(arkRequest.topK ?? 5);
        const limit         = topK;
        const vectorDB      = arkRequest.vectorDB ?? VectorDBProvider.POSTGRES;

        const jsonnet = new Jsonnet();
        const promptPath = path.join(__dirname, "../src/jsonnet/prompts.jsonnet");
        const hydePath   = path.join(__dirname, "../src/jsonnet/hyde.jsonnet");

        const promptLoader    = JSON.parse(jsonnet.evaluateFile(promptPath));
        const promptTemplate  = promptLoader.summary;

        let hydeLoader = jsonnet
            .extString("promptTemplate", promptTemplate)
            .extString("time", "")
            .extString("query", query)
            .evaluateFile(hydePath);
        const prompt = JSON.parse(hydeLoader).prompt;

        // ── Chain 1 & 2: GPT-3 response → split → embeddings ──────────────────
        const gptResponse = await gpt3endpoint.gptFn(prompt);
        const gpt3Responses = gptResponse.split("\n");

        const embeddingsListChain: Promise<number[][]> = Promise.all(
            gpt3Responses.map((resp) => gpt3endpoint.embeddings(resp))
        );

        // ── Chain 5: Vector DB query ────────────────────────────────────────────
        const embeddings = await embeddingsListChain;

        let queryResult: Array<Record<string, unknown>>;

        if (vectorDB === VectorDBProvider.QDRANT) {
            const qdrantCollection = arkRequest.qdrantCollection ?? table;
            const qdrantClient = new QdrantVectorDB(
                embeddings,
                pgMetricFromString(PgMetric.IP),   // default to IP (inner product)
                topK,
                qdrantCollection,
                namespace,
                arkRequest,
                limit
            );
            if (qdrantUrl) qdrantClient.setUrl(qdrantUrl);
            queryResult = await qdrantClient.dbQuery();
        } else {
            const dbClient = new PostgresClient(
                embeddings,
                PgMetric.IP,
                topK,
                20,
                table,
                namespace,
                arkRequest,
                limit
            );
            queryResult = await dbClient.dbQuery();
        }

        // ── Chain 6: Build retrieval context ────────────────────────────────────
        const retrievedDocs: string[] = [];

        for (const embeddings2 of queryResult) {
            retrievedDocs.push(
                `${embeddings2.raw_text ?? embeddings2.metadata ?? ""}\n` +
                `score:${embeddings2.score ?? "N/A"}\n` +
                `filename:${embeddings2.filename ?? "N/A"}\n`
            );
        }

        if (retrievedDocs.join("").length > 4096) {
            retrievedDocs.length = 4096;
        }

        const currentTime    = new Date().toLocaleString();
        const ansPromptSystem = promptLoader.ans_prompt_system;
        const ansPromptUser   = promptLoader.ans_prompt_user;

        hydeLoader = await jsonnet
            .extString(promptTemplate, ansPromptSystem)
            .extString("time", currentTime)
            .extString("qeury", retrievedDocs.join(""))
            .evaluateFile(hydePath);
        const finalPromptSystem = JSON.parse(hydeLoader).prompt;

        hydeLoader = await jsonnet
            .extString(promptTemplate, ansPromptUser)
            .extString("qeury", query)
            .evaluateFile(hydePath);
        const finalPromptUser = JSON.parse(hydeLoader).prompt;

        const chatMessages = [
            { role: "system", content: finalPromptSystem },
            { role: "user",   content: finalPromptUser },
        ];

        const finalAnswer = await gpt3endpoint.gptFnChat(chatMessages);

        return {
            wordEmbeddings: queryResult,
            finalAnswer,
        };
    } catch (error) {
        console.error(error);
        throw error;
    }
}

export { hydeSearchAdaEmbedding };
