# AI Caravan Guide — Boilerplate (Vertex AI + Hybrid RAG)

Este boilerplate incluye:
- **Cloud Function (Node 20 + TypeScript)** con endpoint `/ask`
- Integración con **Vertex AI (Gemini 1.5 Flash)**
- Estructura para RAG **híbrido** (interno + docs oficiales) — actualmente con mocks listos para funcionar
- **Frontend** simple (HTML) para probar en local o Firebase Hosting
- Rate limit básico y passcode de evento

> ⚠️ Por defecto el retriever es **mock** para que funcione de inmediato. Luego, sustituye por Vertex AI Search con dos Data Stores: `DATASTORE_INTERNAL` (GCS) y `DATASTORE_WEB` (docs oficiales).

---

## 1) Pre-requisitos

- Proyecto GCP con facturación
- APIs: Vertex AI, Cloud Functions (Gen2)
- Node.js 20

Opcional (recomendado para producción): Firestore, Firebase Hosting/Auth, Vertex AI Search.

---

## 2) Despliegue rápido de la Function

```bash
cd functions
npm i
npm run build

# Despliegue (Gen2). Ajusta --entry-point si cambias el export.
gcloud functions deploy ai-caravan-ask   --gen2 --runtime=nodejs20 --region=us-central1   --entry-point=app --trigger-http --allow-unauthenticated   --set-env-vars=PASSCODE=tu-pass,ALLOWED_ORIGIN=*
```

> Para restringir CORS, cambia `ALLOWED_ORIGIN` a tu dominio de Hosting.

Variables útiles:
- `PASSCODE` — habilita auth simple por encabezado `x-passcode`.
- `VERTEX_LOCATION` — por defecto `us-central1`.
- `VERTEX_MODEL` — por defecto `gemini-1.5-flash`.

---

## 3) Activar RAG híbrido real (sustituir mocks)

1) Crea dos Data Stores en **Vertex AI Search**:
   - `DATASTORE_INTERNAL` (tipo: Cloud Storage) apuntando a tu bucket (slides, notes, faq).
   - `DATASTORE_WEB` (tipo: Web) con las semillas:
     - https://cloud.google.com/vertex-ai/docs
     - https://cloud.google.com/vertex-ai/generative-ai/docs

2) En `functions/src/rag.ts`, reemplaza `mockSearch(...)` por llamadas reales a Search (o a tu vector store).
   - Conserva la fusión por score o implementa RRF.

3) Despliega con:
```bash
gcloud functions deploy ai-caravan-ask   --gen2 --runtime=nodejs20 --region=us-central1   --entry-point=app --trigger-http --allow-unauthenticated   --set-env-vars=PASSCODE=tu-pass,ALLOWED_ORIGIN=https://TU-DOMINIO,DATASTORE_INTERNAL=projects/..../locations/..../collections/default_collection/dataStores/INTERNAL_ID,DATASTORE_WEB=projects/..../locations/..../collections/default_collection/dataStores/WEB_ID
```

> Nota: Si prefieres **vector store DIY**, cambia `retrieveHybrid` para usar embeddings (text-embedding-004) + Firestore/Supabase.

---

## 4) Probar el Frontend

Abre `web/index.html` en el navegador y coloca tu URL de function (`/ask`) y el passcode (si configurado).

Para Firebase Hosting:
```bash
# desde el root del repo
firebase init hosting
firebase deploy --only hosting
```

---

## 5) Seguridad y costos

- **Passcode** (rápido) o **Firebase Auth** (mejor) para acceso limitado.
- **Rate limit** incluido; ajusta `RATE_LIMIT` si lo haces más estricto.
- CORS restringido al dominio del evento.
- Tokens de salida a 512 y temperatura 0.3 para control de costos.
- Espera costos totales ~5–15 USD durante el evento.

---

## 6) Roadmap recomendado

- Sustituir retriever mock por **Vertex AI Search** (interno + web) con citas.
- Agregar **streaming** de tokens en respuestas.
- Persistir métricas (latencia, % con citas internas) en Firestore.
- Modo conversación con memoria por sesión.

¡Éxitos con el AI Caravan! 🚀
