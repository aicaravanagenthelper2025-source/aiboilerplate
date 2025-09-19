import express, { Request, Response } from "express";
import cors from "cors";
import { VertexAI } from "@google-cloud/vertexai";
import { retrieveHybrid } from "./rag.js";
import { searchAll } from "./search.js";
import { systemPrompt } from "./prompts.js";
import { checkOrigin, rateLimit } from "./security.js";


const server = express(); // <- usa un nombre distinto a 'app' para evitar colisión
server.use(express.json({ limit: "1mb" }));

// CORS
const allowed = process.env.ALLOWED_ORIGIN || "*";
server.use(cors({ origin: allowed, credentials: false }));

server.get("/healthz", (_: Request, res: Response) => res.status(200).send("ok"));

server.post("/ask", checkOrigin, rateLimit, async (req: Request, res: Response) => {
  try {
    const query: string = (req.body?.query || "").trim();
    if (!query || query.length < 3) return res.status(400).json({ error: "Pregunta inválida" });

    const { references, extractiveAnswer } = await searchAll(query);

    const passages = await retrieveHybrid(query, 3, 3);

    const contextLines = passages.map(p => `- ${p.snippet} [${p.title}${p.url ? " | " + p.url : ""}]`).join("\n");
    const userPrompt = `Pregunta: ${query}\n\nContexto:\n${contextLines}`;

    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "aicaravanagenthelper2025";

    const location = process.env.VERTEX_LOCATION || "us-central1";

    const vertex = new VertexAI({ project, location });
    const model = vertex.getGenerativeModel({ model: process.env.VERTEX_MODEL || "gemini-1.5-flash" });

    const system = systemPrompt;
    const user = [
      `Pregunta: ${query}`,
      extractiveAnswer ? `Extractive hint: ${extractiveAnswer}` : "",
      references.length
        ? `Fuentes:\n${references
          .slice(0, 6)
          .map((r: { title: string; url?: string }, i: number) => `  ${i + 1}. ${r.title}${r.url ? ` — ${r.url}` : ""}`)
          .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.3 }
    });

    const text = result.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "(sin texto)";

    res.json({
      text,
      references: passages.map(p => ({ title: p.title, url: p.url, source: p.source, score: p.score }))
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Error interno", details: err?.message || String(err) });
  }
});

// <-- ESTE export debe coincidir con --entry-point=app
export const app = server;

// Si quieres correr local: descomenta
// const port = process.env.PORT || 8080;
// server.listen(port, () => console.log(`Dev server on :${port}`));

