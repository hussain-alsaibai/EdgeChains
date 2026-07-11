import axios, { AxiosInstance } from "axios";
import retry from "retry";
import { config } from "dotenv";
config();

/**
 * Lightweight interface mirroring the parts of the Qdrant HTTP API used by
 * EdgeChains. We intentionally avoid pulling in the official `qdrant` JS
 * package per the bounty requirements — only `axios` is used for HTTP.
 *
 * Spec: https://qdrant.github.io/qdrant/redoc/index.html
 */
export interface QdrantPoint {
    id: string | number;
    vector: number[];
    payload?: Record<string, any>;
}

export interface QdrantSearchRequest {
    vector: number[];
    top?: number;
    filter?: Record<string, any>;
    with_payload?: boolean;
    with_vector?: boolean;
}

export interface QdrantSearchResponse {
    result: Array<{
        id: string | number;
        score: number;
        payload?: Record<string, any>;
        vector?: number[];
    }>;
}

interface InsertVectorDataArgs {
    client: AxiosInstance;
    collectionName: string;
    [key: string]: any;
}

interface GetDataFromQueryArgs {
    client: AxiosInstance;
    functionNameToCall: string;
    [key: string]: any;
}

export class Qdrant {
    QDRANT_URL: string;
    QDRANT_API_KEY: string;

    constructor(QDRANT_URL: string, QDRANT_API_KEY: string) {
        this.QDRANT_URL =
            QDRANT_URL || process.env.QDRANT_URL || "http://localhost:6333";
        this.QDRANT_API_KEY =
            QDRANT_API_KEY || process.env.QDRANT_API_KEY || "";
    }

    /**
     * Create an axios client wired against the Qdrant REST API.
     * Auth header is only attached when an API key is provided (Qdrant Cloud).
     */
    createClient(): AxiosInstance {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (this.QDRANT_API_KEY) {
            headers["api-key"] = this.QDRANT_API_KEY;
        }
        return axios.create({
            baseURL: this.QDRANT_URL,
            headers,
            timeout: 30_000,
        });
    }

    /**
     * Insert one or more points into a Qdrant collection.
     * @param client - The Qdrant axios client instance.
     * @param collectionName - Target collection (a.k.a. table).
     * @param points - Array of points to upsert. Each point must include id, vector, and optional payload.
     */
    async insertVectorData({
        client,
        collectionName,
        points,
    }: InsertVectorDataArgs): Promise<any> {
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
                    // POST /collections/{collection_name}/points?wait=true
                    const res = await client.put(
                        `/collections/${encodeURIComponent(collectionName)}/points?wait=true`,
                        { points }
                    );
                    if (res.status >= 200 && res.status < 300) {
                        resolve(res.data);
                    } else {
                        if (operation.retry(new Error()))
                            return;
                        reject(
                            new Error(
                                `Failed to insert points with status ${res.status}: ${JSON.stringify(
                                    res.data
                                )}`
                            )
                        );
                    }
                } catch (error: any) {
                    if (operation.retry(error)) return;
                    reject(error);
                }
            });
        });
    }

    /**
     * Search a Qdrant collection using vector similarity.
     * @param client - The Qdrant axios client instance.
     * @param collectionName - Collection to search.
     * @param vector - Query embedding vector.
     * @param top - Number of nearest neighbours to return (default 10).
     * @param filter - Optional Qdrant filter expression.
     * @param with_payload - Whether to return stored payload (default true).
     */
    async searchVector({
        client,
        collectionName,
        vector,
        top = 10,
        filter,
        with_payload = true,
        with_vector = false,
    }: {
        client: AxiosInstance;
        collectionName: string;
        vector: number[];
        top?: number;
        filter?: Record<string, any>;
        with_payload?: boolean;
        with_vector?: boolean;
    }): Promise<QdrantSearchResponse["result"]> {
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
                    const body: QdrantSearchRequest = {
                        vector,
                        top,
                        with_payload,
                        with_vector,
                    };
                    if (filter) body.filter = filter;

                    // POST /collections/{collection_name}/points/search
                    const res = await client.post(
                        `/collections/${encodeURIComponent(collectionName)}/points/search`,
                        body
                    );
                    if (res.status >= 200 && res.status < 300) {
                        resolve(res.data?.result ?? []);
                    } else {
                        if (operation.retry(new Error())) return;
                        reject(
                            new Error(
                                `Search failed with status ${res.status}: ${JSON.stringify(
                                    res.data
                                )}`
                            )
                        );
                    }
                } catch (error: any) {
                    if (operation.retry(error)) return;
                    reject(error);
                }
            });
        });
    }

    /**
     * Generic "run a named query" helper. Mirrors the Supabase helper of the
     * same name so the two implementations stay interchangeable from the
     * caller's perspective. For Qdrant this maps to the recommended search
     * endpoint with the supplied args as the search body.
     *
     * @param client - The Qdrant axios client instance.
     * @param functionNameToCall - Qdrant search endpoint segment, e.g. "search".
     * @param args - Request body for the endpoint.
     */
    async getDataFromQuery({
        client,
        functionNameToCall,
        ...args
    }: GetDataFromQueryArgs): Promise<any> {
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
                    const res = await client.post(
                        `/collections/${encodeURIComponent(
                            args.collectionName ?? args.collection_name ?? ""
                        )}/points/${functionNameToCall}`,
                        args
                    );
                    if (res.status === 200) {
                        resolve(res.data);
                    } else {
                        if (operation.retry(new Error())) return;
                        reject(
                            new Error(
                                `Failed with ErrorCode:${res.statusText} and ErrorMessage:${JSON.stringify(
                                    res.data
                                )}`
                            )
                        );
                    }
                } catch (error: any) {
                    if (operation.retry(error)) return;
                    reject(error);
                }
            });
        });
    }

    /**
     * Scroll through all points in a collection. Maps to the Qdrant
     * `/points/scroll` endpoint, which is the closest analogue to
     * "fetch all rows from a table".
     *
     * @param client - The Qdrant axios client instance.
     * @param collectionName - Source collection.
     * @param limit - Maximum number of points to return (default 1000).
     */
    async getData({
        client,
        collectionName,
        limit = 1000,
    }: {
        client: AxiosInstance;
        collectionName: string;
        limit?: number;
    }): Promise<any> {
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
                    const res = await client.post(
                        `/collections/${encodeURIComponent(collectionName)}/points/scroll`,
                        { limit, with_payload: true, with_vector: false }
                    );
                    if (res.data) {
                        resolve(res.data?.result?.points ?? res.data);
                    }
                    if (operation.retry(new Error())) return;
                    reject(new Error(`Failed to scroll points: ${res.statusText}`));
                } catch (error) {
                    if (operation.retry(new Error())) return;
                    reject(error);
                }
            });
        });
    }

    /**
     * Fetch a single point by id.
     * @param client - The Qdrant axios client instance.
     * @param collectionName - Source collection.
     * @param id - Point id.
     */
    async getDataById({
        client,
        collectionName,
        id,
    }: {
        client: AxiosInstance;
        collectionName: string;
        id: string | number;
    }): Promise<any> {
        try {
            const res = await client.get(
                `/collections/${encodeURIComponent(collectionName)}/points/${encodeURIComponent(
                    String(id)
                )}`
            );
            return res.data?.result ?? res.data;
        } catch (error) {
            console.error("Error fetching point from Qdrant:", error);
            throw error;
        }
    }

    /**
     * Update payload fields on an existing point.
     * @param client - The Qdrant axios client instance.
     * @param collectionName - Target collection.
     * @param id - Point id to update.
     * @param updatedContent - Payload fields to merge into the point.
     */
    async updateById({
        client,
        collectionName,
        id,
        updatedContent,
    }: {
        client: AxiosInstance;
        collectionName: string;
        id: string | number;
        updatedContent: Record<string, any>;
    }): Promise<any> {
        try {
            // POST /collections/{collection}/points/payload — merge payload fields
            const res = await client.post(
                `/collections/${encodeURIComponent(collectionName)}/points/payload`,
                {
                    payload: updatedContent,
                    points: [id],
                }
            );
            return res.data;
        } catch (error) {
            console.error("Error updating point in Qdrant:", error);
            throw error;
        }
    }

    /**
     * Delete a point by id.
     * @param client - The Qdrant axios client instance.
     * @param collectionName - Target collection.
     * @param id - Point id to delete.
     */
    async deleteById({
        client,
        collectionName,
        id,
    }: {
        client: AxiosInstance;
        collectionName: string;
        id: string | number;
    }): Promise<any> {
        try {
            const res = await client.delete(
                `/collections/${encodeURIComponent(collectionName)}/points/delete`,
                {
                    data: { points: [id] },
                }
            );
            return { status: res.status, messages: res.statusText };
        } catch (error) {
            console.error("Error deleting point from Qdrant:", error);
            throw error;
        }
    }
}