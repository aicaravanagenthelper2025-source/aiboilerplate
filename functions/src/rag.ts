// Retrieve passages from two sources: internal Data Store and Vertex AI Docs Web Data Store.
// This is a boilerplate; replace `searchVertexAI` with a real call to Vertex AI Search or your vector store.
type Passage = { snippet: string; title: string; url?: string|null; score: number; source: string };

function mockSearch(kind: "internal"|"web", query: string, k: number): Passage[] {
  // Minimal placeholders to make the app work out-of-the-box.
  const base: Passage[] = [
    { snippet: "Los agentes en Vertex AI combinan modelos generativos con herramientas y memoria.", title: "Slides: Agents in Vertex AI", score: 0.72, source: "INT:slides/ai-caravan.pdf#agents" },
    { snippet: "Gemini 1.5 Flash ofrece baja latencia y buen costo para Q&A y grounding.", title: "Slides: Model Choices", score: 0.68, source: "INT:notes/modeles.md" },
    { snippet: "Vertex AI Search permite indexar GCS y fuentes web para grounding híbrido.", title: "Docs: Vertex AI Search Overview", url: "https://cloud.google.com/vertex-ai/docs/search-overview", score: 0.66, source: "WEB:https://cloud.google.com/vertex-ai/docs/search-overview" }
  ];
  return base
    .filter((_, i) => i < k)
    .map(p => (kind === "internal" ? p : { ...p, score: p.score - 0.05 }));
}

export async function retrieveHybrid(query: string, kInternal=3, kWeb=3): Promise<Passage[]> {
  // If env variables exist, you'd call the real search here.
  const dsInternal = process.env.DATASTORE_INTERNAL;
  const dsWeb = process.env.DATASTORE_WEB;

  // TODO: Replace mock with real calls to Vertex AI Search:
  // const internal = await searchVertexAI({ dataStoreId: dsInternal!, query, k: kInternal });
  // const web = await searchVertexAI({ dataStoreId: dsWeb!, query, k: kWeb });

  const internal = mockSearch("internal", query, kInternal);
  const web = mockSearch("web", query, kWeb);

  // Simple fusion by score (RRf or weighted average can be implemented later)
  const strongInternal = internal.filter(x => x.score >= 0.55);
  if (strongInternal.length >= 3) return strongInternal.slice(0, 3);

  const fused = [...internal, ...web]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return fused;
}
