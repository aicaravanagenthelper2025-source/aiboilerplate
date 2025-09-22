import { SearchServiceClient } from "@google-cloud/discoveryengine";
// Allow API endpoint override via env var, fallback to us-discoveryengine.googleapis.com
const apiEndpoint = process.env.DISCOVERY_API_ENDPOINT || "us-discoveryengine.googleapis.com";
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
export const discovery = new SearchServiceClient({
    apiEndpoint,
    libName: "ai-caravan-guide",
    libVersion: "1.0.0",
    // Set x-goog-user-project header for all requests
    headers: projectId ? { "x-goog-user-project": projectId } : undefined,
});
/**
* Convierte un dataStore resource name -> servingConfig resource name
* dataStore:  projects/.../locations/.../collections/default_collection/dataStores/XXX
* servingCfg: projects/.../locations/.../collections/default_collection/dataStores/XXX/servingConfigs/default_search
*/
function toServingConfig(dataStore) {
    if (!dataStore?.includes("/dataStores/")) {
        throw new Error(`DATASTORE inválido: ${dataStore}`);
    }
    return `${dataStore}/servingConfigs/default_search`;
}
function normalizeHit(raw, source) {
    const doc = raw?.document ?? {};
    const derived = doc?.derivedStructData ?? raw?.derivedStructData ?? raw?.structData ?? {};
    const title = derived.title ||
        doc?.title ||
        doc?.name?.split("/").pop() ||
        undefined;
    // Mejor extracción de snippet
    const snippet = (Array.isArray(derived.snippets) && derived.snippets[0]?.snippet) ||
        raw?.extractiveSegments?.map((s) => s.content).join(" … ") ||
        raw?.snippet ||
        undefined;
    // Mejor extracción de link
    const url = derived.link || doc?.uri || undefined;
    return { title, url, snippet, source };
}
async function runSearchOnce(servingConfig, query, source) {
    // Request enriquecida: multilenguaje + snippets + summary
    const request = {
        servingConfig,
        query,
        pageSize: 8,
        queryLanguageCode: ["es", "en"],
        contentSearchSpec: {
            snippetSpec: {
                maxSnippetCount: 3,
            },
            summarySpec: {
                summaryResultCount: 1,
                includeCitations: true,
            },
        },
        // Set x-goog-user-project header for this request as well (redundant, but safe)
        ...(projectId ? { otherArgs: { headers: { "x-goog-user-project": projectId } } } : {}),
    };
    try {
        const [resp] = await discovery.search(request);
        const answer = resp?.summary?.summaryText && !(resp?.summary?.summarySkippedReasons?.length)
            ? resp.summary.summaryText
            : undefined;
        const hits = (resp?.results ?? []).map((r) => normalizeHit(r, source));
        return { answer, hits };
    }
    catch (err) {
        console.error(`[Vertex AI Search] Error for source=${source}, servingConfig=${servingConfig}, query=\"${query}\"`, err);
        throw new Error(`Vertex AI Search failed for ${source}: ${err?.message || err}`);
    }
}
/**
* Busca en INTERNAL y WEB, prioriza INTERNAL, deduplica por URL/título.
* Devuelve texto (si hay summary útil) y referencias normalizadas.
*/
export async function searchAll(query) {
    const dsInternal = process.env.DATASTORE_INTERNAL;
    const dsWeb = process.env.DATASTORE_WEB;
    if (!dsInternal)
        throw new Error("Falta DATASTORE_INTERNAL");
    const scInternal = toServingConfig(dsInternal);
    const searches = [runSearchOnce(scInternal, query, "internal").then(v => ({ status: "fulfilled", value: v }), r => ({ status: "rejected", reason: r }))];
    let webConfigured = false;
    if (dsWeb && dsWeb.includes("/dataStores/")) {
        const scWeb = toServingConfig(dsWeb);
        searches.push(runSearchOnce(scWeb, query, "web").then(v => ({ status: "fulfilled", value: v }), r => ({ status: "rejected", reason: r })));
        webConfigured = true;
    }
    const results = await Promise.all(searches);
    const rInt = results[0];
    const webResult = webConfigured ? results[1] : undefined;
    const hits = [];
    let extractiveAnswer;
    // INTERNAL primero
    if (rInt.status === "fulfilled") {
        extractiveAnswer ||= rInt.value.answer;
        hits.push(...rInt.value.hits);
        console.log(`[Vertex AI Search] INTERNAL returned ${rInt.value.hits.length} hits for query: '${query}'`);
    }
    else if (rInt.status === "rejected") {
        console.error("[Vertex AI Search] INTERNAL search failed:", rInt.reason);
    }
    // Luego WEB (solo si se ejecutó)
    if (webResult && webResult.status === "fulfilled") {
        extractiveAnswer ||= webResult.value.answer;
        hits.push(...webResult.value.hits);
        console.log(`[Vertex AI Search] WEB returned ${webResult.value.hits.length} hits for query: '${query}'`);
    }
    else if (webResult && webResult.status === "rejected") {
        console.error("[Vertex AI Search] WEB search failed:", webResult.reason);
    }
    // Dedup por URL (o por título si no hay URL)
    const uniq = new Map();
    for (const h of hits) {
        const key = (h.url || h.title || "").trim().toLowerCase();
        if (!key)
            continue;
        if (!uniq.has(key))
            uniq.set(key, h);
    }
    // Construye referencias para la UI
    const references = Array.from(uniq.values()).map((h) => ({
        title: h.title || h.url || "Referencia",
        url: h.url,
        source: h.source,
        snippet: h.snippet,
    }));
    // Si no hay resultados, fuerza un mensaje especial
    if (references.length === 0) {
        return {
            references: [],
            extractiveAnswer: "No logro encontrar información, ¿podrías explicarme más detalladamente?"
        };
    }
    return {
        // Tip: el modelo generativo puede usar references/snippets como grounding
        references,
        // Si quieres forzar “respuesta directa” desde Search, devuelve extractiveAnswer aquí.
        // En la mayoría de los casos dejamos que el modelo redacte usando references.
        extractiveAnswer,
    };
}
