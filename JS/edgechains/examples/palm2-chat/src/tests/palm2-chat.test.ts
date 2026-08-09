/**
 * Palm2 Chat Example — Integration tests
 * Verifies the example setup uses jsonnet correctly (no hardcoded prompts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Palm2 Chat Example", () => {
    describe("jsonnet configuration", () => {
        it("secrets.jsonnet should have palm2_api_key field", async () => {
            // Verify the secrets file has the expected structure
            const fs = await import("fs");
            const path = await import("path");
            const jsonnetPath = path.join(__dirname, "../../jsonnet/secrets.jsonnet");
            const content = fs.readFileSync(jsonnetPath, "utf-8");

            // Should contain palm2_api_key
            expect(content).toContain("palm2_api_key");
        });

        it("main.jsonnet should use jsonnet variables (no hardcoded prompts)", async () => {
            const fs = await import("fs");
            const path = await import("path");
            const mainPath = path.join(__dirname, "../../jsonnet/main.jsonnet");
            const content = fs.readFileSync(mainPath, "utf-8");

            // Should use std.extVar for variables
            expect(content).toContain("std.extVar");
            // Should NOT hardcode API key or prompt
            expect(content).not.toMatch(/apiKey\s*:\s*"[^"]+"/);
            expect(content).not.toMatch(/prompt\s*:\s*"[^"]+"/);
            // Should use palm2Chat callback
            expect(content).toContain('arakoo.native("palm2Chat")');
        });

        it("main.jsonnet should use palm2 model constants", async () => {
            const fs = await import("fs");
            const path = await import("path");
            const mainPath = path.join(__dirname, "../../jsonnet/main.jsonnet");
            const content = fs.readFileSync(mainPath, "utf-8");

            // Should reference a known Palm2 model
            expect(content).toMatch(/chat-bison-001|text-bison-001|embedding-gecko-001/);
        });
    });

    describe("source files", () => {
        it("index.ts should register palm2Chat callback", async () => {
            const fs = await import("fs");
            const path = await import("path");
            const indexPath = path.join(__dirname, "../index.ts");
            const content = fs.readFileSync(indexPath, "utf-8");

            // Should register the callback
            expect(content).toContain('javascriptCallback("palm2Chat"');
            // Should load secrets from jsonnet
            expect(content).toContain("secrets.jsonnet");
            // Should set extString for topic and model
            expect(content).toContain('extString("topic"');
            expect(content).toContain('extString("model"');
        });

        it("palm2Chat.cjs should use Palm2 class from @arakoodev/edgechains.js/ai", async () => {
            const fs = await import("fs");
            const path = await import("path");
            const cjsPath = path.join(__dirname, "../lib/palm2Chat.cjs");
            const content = fs.readFileSync(cjsPath, "utf-8");

            // Should import Palm2 from the AI module
            expect(content).toContain("Palm2");
            expect(content).toContain("@arakoodev/edgechains.js/ai");
        });
    });
});
