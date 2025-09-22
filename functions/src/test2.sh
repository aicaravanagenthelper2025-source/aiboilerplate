
PROJECT=aicaravanagenthelper2025
LOCATION=us
DATASTORE=presentataiondata_1757559137428_gcs_store
BRANCH="$DATASTORE/branches/default_branch"
TOKEN="$(gcloud auth print-access-token)"

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT" \
  "https://us-discoveryengine.googleapis.com/v1/projects/aicaravanagenthelper2025/locations/$LOCATION/collections/default_collection/dataStores/$BRANCH/documents?pageSize=50" | jq .