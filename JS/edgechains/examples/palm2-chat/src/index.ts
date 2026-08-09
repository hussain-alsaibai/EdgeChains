import { ArakooServer } from "@arakoodev/edgechains.js/arakooserver";
import Jsonnet from "@arakoodev/jsonnet";
import { createSyncRPC } from "@arakoodev/edgechains.js/sync-rpc";
import fileURLToPath from "file-uri-to-path";
import path from "path";

const server = new ArakooServer();
const app = server.createApp();
const jsonnet = new Jsonnet();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create a synchronous RPC wrapper for the palm2 native function
// The JSONnet will call arakoo.native("palm2Chat", { ... })
const palm2ChatRPC = createSyncRPC(path.join(__dirname, "./lib/palm2Chat.cjs"));

app.post("/chat", async (c: any) => {
    try {
        const { topic, model } = await c.req.json();

        // Load secrets from jsonnet
        const secretsPath = path.join(__dirname, "../jsonnet/secrets.jsonnet");
        const secrets = JSON.parse(jsonnet.evaluateFile(secretsPath));

        // Set external variables and javascript callback for the jsonnet evaluation
        jsonnet.extString("topic", topic || "artificial intelligence");
        jsonnet.extString("model", model || "chat-bison-001");
        jsonnet.extString("palm2_api_key", secrets.palm2_api_key || "");

        // Register the palm2Chat native function as a javascript callback
        jsonnet.javascriptCallback("palm2Chat", palm2ChatRPC);

        const response = jsonnet.evaluateFile(
            path.join(__dirname, "../jsonnet/main.jsonnet")
        );

        return c.json(JSON.parse(response));
    } catch (error) {
        console.error("Error in /chat:", error);
        return c.json({ error: String(error) }, 500);
    }
});

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT);
console.log(`Palm2 Chat server running on port ${PORT}`);
