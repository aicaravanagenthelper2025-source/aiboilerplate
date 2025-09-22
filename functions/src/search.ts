import fetch from "node-fetch";
import { GoogleAuth } from "google-auth-library";
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
    // Loguear doc para ver estructura real
    console.log('[DEBUG] normalizeHit doc:', JSON.stringify(doc, null, 2));
    let title, snippet, url;
    // 1. SDK format: derivedStructData.fields
    const fields = doc?.derivedStructData?.fields;
    if (fields) {
        title = fields.title?.stringValue || doc?.title || doc?.name?.split("/").pop();
        if (fields.snippets?.listValue?.values?.length) {
            for (const val of fields.snippets.listValue.values) {
                const snip = val?.structValue?.fields?.snippet?.stringValue;
                if (snip) {
                    snippet = snip;
                    break;
                }
            }
        }
        url = fields.link?.stringValue || doc?.uri;
    }
    // 2. REST/curl format: derivedStructData.snippets (array)
    else if (Array.isArray(doc?.derivedStructData?.snippets)) {
        const derived = doc.derivedStructData;
        title = derived.title || doc?.title || doc?.name?.split("/").pop() || undefined;
        snippet = derived.snippets[0]?.snippet || undefined;
        url = derived.link || doc?.uri || undefined;
    }
    // 3. Fallback: try other locations
    else {
        const derived = doc?.derivedStructData ?? raw?.derivedStructData ?? raw?.structData ?? {};
        title = derived.title || doc?.title || doc?.name?.split("/").pop() || undefined;
        snippet =
            (Array.isArray(derived.snippets) && derived.snippets[0]?.snippet) ||
            raw?.extractiveSegments?.map((s: any) => s.content).join(" … ") ||
            raw?.snippet ||
            undefined;
        url = derived.link || doc?.uri || undefined;
    }
    // Log input y output para depuración
    console.log('[DEBUG] normalizeHit input:', JSON.stringify(raw, null, 2));
    console.log('[DEBUG] normalizeHit output:', { title, url, snippet, source });
    return { title, url, snippet, source };
}
async function runSearchOnce(servingConfig: string, query: string, source: "internal" | "web"): Promise<SearchResponse> {
    // Si USE_CURL_SEARCH está activo, usa fetch manual
    if (process.env.USE_CURL_SEARCH === "1") {
        const url = `https://${apiEndpoint}/v1/${servingConfig}:search`;
        const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
        const client = await auth.getClient();
        // Robustly extract the access token (string or {token: string})
        let tokenResp = await client.getAccessToken();
        let token: string | undefined;
        if (typeof tokenResp === "object" && tokenResp !== null && "token" in tokenResp) {
            token = (tokenResp as any).token;
        } else if (typeof tokenResp === "string") {
            token = tokenResp;
        }
        if (!token || typeof token !== "string") {
            throw new Error("Failed to obtain a valid access token for Vertex AI Search");
        }
        const headers: any = {
            "Authorization": `Bearer ${token}`,
            "x-goog-user-project": projectId,
            "Content-Type": "application/json"
        };
        // Make two requests: one for 'es', one for 'en'
        const languages = ["es", "en"];
        const resultsArr: { hits: SearchHit[]; answer?: string }[] = [];
        for (const lang of languages) {
            const body = {
                query,
                pageSize: 8,
                // queryLanguageCode is NOT supported in REST API, omit it
                contentSearchSpec: {
                    snippetSpec: { maxSnippetCount: 3 },
                    summarySpec: { summaryResultCount: 1, includeCitations: true },
                },
            };
            const resp = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body)
            });
            const json = await resp.json();
            console.log(`[DEBUG] Manual fetch Vertex AI Search response (lang=${lang}):`, JSON.stringify(json, null, 2));
            const hits: SearchHit[] = (json.results ?? []).map((r: any) => normalizeHit(r, source));
            const answer = json?.summary?.summaryText;
            resultsArr.push({ hits, answer });
        }
        // Merge and deduplicate hits by url+title
        const allHits = resultsArr.flatMap(r => r.hits);
        const seen = new Set();
        const dedupedHits = allHits.filter(h => {
            const key = (h.title || "") + (h.url || "");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        // Prefer extractive answer from 'es', fallback to 'en'
        const answer = resultsArr[0].answer || resultsArr[1].answer;
        return { answer, hits: dedupedHits };
    }
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
        // Set x-goog-user-project header for this request as well (redundant, but safe)
        ...(projectId ? { otherArgs: { headers: { "x-goog-user-project": projectId, "Content-Type": "application/json" } } } : { otherArgs: { headers: { "Content-Type": "application/json" } } }),
    };
    try {
        const [resp]: any = await discovery.search(request);
        console.log(`[DEBUG] Vertex AI Search raw response for source=${source}, query=\"${query}\":`, JSON.stringify(resp, null, 2));
        const answer =
            resp?.summary?.summaryText && !(resp?.summary?.summarySkippedReasons?.length)
                ? resp.summary.summaryText
                : undefined;
        const hits: SearchHit[] = (resp?.results ?? []).map((r: any) =>
            normalizeHit(r, source)
        );
        return { answer, hits };
    } catch (err: any) {
        console.error(`[Vertex AI Search] Error for source=${source}, servingConfig=${servingConfig}, query=\"${query}\"`, err);
        throw new Error(`Vertex AI Search failed for ${source}: ${err?.message || err}`);
    }
}
/**
* Busca en INTERNAL y WEB, prioriza INTERNAL, deduplica por URL/título.
* Devuelve texto (si hay summary útil) y referencias normalizadas.
*/
export async function searchAll(query: string) {
    const dsInternal = process.env.DATASTORE_INTERNAL!;
    const dsWeb = process.env.DATASTORE_WEB;
    console.log(`[DEBUG] DATASTORE_INTERNAL: ${dsInternal}`);
    console.log(`[DEBUG] Vertex AI Search apiEndpoint: ${apiEndpoint}`);
    if (!dsInternal) throw new Error("Falta DATASTORE_INTERNAL");
    const scInternal = toServingConfig(dsInternal);
    console.log(`[DEBUG] Vertex AI Search servingConfig: ${scInternal}`);
    // Loguea el request que se enviará a Vertex AI Search
    const debugRequest = {
        servingConfig: scInternal,
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
        ...(projectId ? { otherArgs: { headers: { "x-goog-user-project": projectId } } } : {}),
    };
    console.log(`[DEBUG] Vertex AI Search request (internal):`, JSON.stringify(debugRequest, null, 2));
    const searches: Promise<PromiseSettledResult<any>>[] = [runSearchOnce(scInternal, query, "internal").then(
        v => ({ status: "fulfilled", value: v }),
        r => ({ status: "rejected", reason: r })
    )];
    let webConfigured = false;
    if (dsWeb && dsWeb.includes("/dataStores/")) {
        const scWeb = toServingConfig(dsWeb);
        searches.push(
            runSearchOnce(scWeb, query, "web").then(
                v => ({ status: "fulfilled", value: v }),
                r => ({ status: "rejected", reason: r })
            )
        );
        webConfigured = true;
    }
    const results = await Promise.all(searches);
    const rInt = results[0];
    const webResult = webConfigured ? results[1] : undefined;
    const hits: SearchHit[] = [];
    let extractiveAnswer: string | undefined;
    // INTERNAL primero
    if (rInt.status === "fulfilled") {
        extractiveAnswer ||= rInt.value.answer;
        hits.push(...rInt.value.hits);
        console.log(`[Vertex AI Search] INTERNAL returned ${rInt.value.hits.length} hits for query: '${query}'`);
    } else if (rInt.status === "rejected") {
        console.error("[Vertex AI Search] INTERNAL search failed:", rInt.reason);
    }
    // Luego WEB (solo si se ejecutó)
    if (webResult && webResult.status === "fulfilled") {
        extractiveAnswer ||= webResult.value.answer;
        hits.push(...webResult.value.hits);
        console.log(`[Vertex AI Search] WEB returned ${webResult.value.hits.length} hits for query: '${query}'`);
    } else if (webResult && webResult.status === "rejected") {
        console.error("[Vertex AI Search] WEB search failed:", webResult.reason);
    }
    // Log raw hits before deduplication
    console.log(`[DEBUG] Total raw hits before deduplication: ${hits.length}`);
    // Permitir múltiples resultados aunque tengan el mismo título o URL (agregando un sufijo único)
    const references = hits.map((h, idx) => ({
        title: h.title || h.url || `Referencia ${idx+1}`,
        url: h.url,
        source: h.source,
        snippet: h.snippet,
    }));
    // Log de references para depuración
    console.log('[DEBUG] references construidas en searchAll:', JSON.stringify(references, null, 2));

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