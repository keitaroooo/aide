import { spawnSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const webDir = path.dirname(fileURLToPath(import.meta.url));

/** Local dev only. Add/complete writes task-list.md and syncs production D1. */
function localTasks(): Plugin {
  const repo =
    process.env.KEITARO_YAMAGUCHI ?? path.resolve(webDir, "../../keitaro-yamaguchi");
  const script = path.join(repo, ".agent/scripts/complete_task_from_aide.py");

  function runScript(
    req: IncomingMessage,
    res: ServerResponse,
    args: (body: Record<string, string>) => string[],
  ) {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: Record<string, string> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid json" }));
        return;
      }
      const run = spawnSync("python3", [script, ...args(body)], { encoding: "utf8" });
      res.setHeader("content-type", "application/json");
      if (run.status !== 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: (run.stderr || run.stdout || "failed").trim() }));
        return;
      }
      res.end(run.stdout || "{}");
    });
  }

  return {
    name: "aide-local-tasks",
    configureServer(server) {
      server.middlewares.use("/__local/complete", (req, res) => {
        runScript(req, res, (body) => [
          "--source-ref",
          body.source_ref ?? "",
          "--title",
          body.title ?? "",
          "--notes",
          body.notes ?? "",
        ]);
      });
      server.middlewares.use("/__local/add", (req, res) => {
        runScript(req, res, (body) => [
          "--add",
          "--domain",
          body.domain ?? "",
          "--section",
          body.section ?? "TODO",
          "--title",
          body.title ?? "",
        ]);
      });
      server.middlewares.use("/__local/move", (req, res) => {
        runScript(req, res, (body) => [
          "--move",
          "--source-ref",
          body.source_ref ?? "",
          "--title",
          body.title ?? "",
          "--notes",
          body.notes ?? "",
          "--section",
          body.section ?? "TODO",
          "--before-title",
          body.before_title ?? "",
        ]);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    localTasks(),
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Aide",
        short_name: "Aide",
        description: "話すだけで、やることを整える",
        theme_color: "#1a3a2f",
        background_color: "#f3efe6",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
      },
    },
  },
});
