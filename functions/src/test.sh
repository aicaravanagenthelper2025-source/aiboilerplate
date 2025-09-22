PROJECT="aicaravanagenthelper2025"   # <- project ID, not 237018775060
LOCATION="us"
DATASTORE="presentataiondata_1757559137428_gcs_store"
SERVING="projects/${PROJECT}/locations/${LOCATION}/collections/default_collection/dataStores/${DATASTORE}/servingConfigs/default_search"
BASE="https://us-discoveryengine.googleapis.com"
TOKEN="$(gcloud auth print-access-token)"

curl -sS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "x-goog-user-project: ${PROJECT}" \
  -H "Content-Type: application/json" \
  "${BASE}/v1/${SERVING}:search" \
  -d '{
    "query": "Quien es Mario?",
    "pageSize": 5,
    "contentSearchSpec": {
      "snippetSpec": { "maxSnippetCount": 3 },
      "summarySpec": { "summaryResultCount": 1, "includeCitations": true }
    }
  }' | jq .