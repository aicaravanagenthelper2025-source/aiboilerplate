import { SearchServiceClient } from "@google-cloud/discoveryengine";
export const discovery = new SearchServiceClient();
/**
* Convierte un dataStore resource name -> servingConfig resource name
* dataStore:  projects/.../locations/.../collections/default_collection/dataStores/XXX
* servingCfg: projects/.../locations/.../collections/default_collection/dataStores/XXX/servingConfigs/default_search
*/
function toServingConfig(dataStore: string): string {
    if (!dataStore?.includes("/dataStores/")) {
        throw new Error(`DATASTORE inválido: ${dataStore}`);
    }
    return `${dataStore}/servingConfigs/default_search`;
}
type SearchHit = {
    title?: string;
    url?: string;
    snippet?: string;
    source?: "internal" | "web";
};
type SearchResponse = {
    answer?: string;         // summary extractivo si aplica
    hits: SearchHit[];
};
function normalizeHit(raw: any, source: "internal" | "web"): SearchHit {
    const doc = raw?.document ?? {};
    const derived = raw?.derivedStructData ?? raw?.structData ?? {};
    const title =
        derived.title ||
        doc?.title ||
        doc?.name?.split("/").pop() ||
        undefined;
    // URI (si Discovery la tiene) o fallback a name
    const url = doc?.uri || derived.link || undefined;
    // snippet: usa extractivo si viene, si no el "snippet" básico
    const snippet =
        raw?.extractiveSegments?.map((s: any) => s.content).join(" … ") ||
        raw?.snippet ||
        undefined;
    return { title, url, snippet, source };
}
async function runSearchOnce(servingConfig: string, query: string): Promise<SearchResponse> {
    // Request enriquecida: multilenguaje + snippets + summary
    const request: any = {
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
    };
    const [resp]: any = await discovery.search(request);
    const answer =
        resp?.summary?.summaryText && !(resp?.summary?.summarySkippedReasons?.length)
            ? resp.summary.summaryText
            : undefined;
    const hits: SearchHit[] = (resp?.results ?? []).map((r: any) =>
        normalizeHit(r, "internal")
    );
    return { answer, hits };
}
/**
* Busca en INTERNAL y WEB, prioriza INTERNAL, deduplica por URL/título.
* Devuelve texto (si hay summary útil) y referencias normalizadas.
*/
export async function searchAll(query: string) {
    const dsInternal = process.env.DATASTORE_INTERNAL!;
    const dsWeb = process.env.DATASTORE_WEB!;
    if (!dsInternal) throw new Error("Falta DATASTORE_INTERNAL");
    if (!dsWeb) throw new Error("Falta DATASTORE_WEB");
    const scInternal = toServingConfig(dsInternal);
    const scWeb = toServingConfig(dsWeb);
    // Ejecuta en paralelo
    const [rInt, rWeb] = await Promise.allSettled([
        runSearchOnce(scInternal, query),
        runSearchOnce(scWeb, query),
    ]);
    const hits: SearchHit[] = [];
    let extractiveAnswer: string | undefined;
    // INTERNAL primero
    if (rInt.status === "fulfilled") {
        extractiveAnswer ||= rInt.value.answer;
        hits.push(...rInt.value.hits.map(h => ({ ...h, source: "internal" as "internal" })));
    }
    // Luego WEB
    if (rWeb.status === "fulfilled") {
        extractiveAnswer ||= rWeb.value.answer;
        hits.push(...rWeb.value.hits.map(h => ({ ...h, source: "web" as "web" })));
    }
    // Dedup por URL (o por título si no hay URL)
    const uniq = new Map<string, SearchHit>();
    for (const h of hits) {
        const key = (h.url || h.title || "").trim().toLowerCase();
        if (!key) continue;
        if (!uniq.has(key)) uniq.set(key, h);
    }
    // Construye referencias para la UI
    const references = Array.from(uniq.values()).map((h) => ({
        title: h.title || h.url || "Referencia",
        url: h.url,
        source: h.source,
        snippet: h.snippet,
    }));
    return {
        // Tip: el modelo generativo puede usar references/snippets como grounding
        references,
        // Si quieres forzar “respuesta directa” desde Search, devuelve extractiveAnswer aquí.
        // En la mayoría de los casos dejamos que el modelo redacte usando references.
        extractiveAnswer,
    };
}