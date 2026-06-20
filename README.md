# RAGfly TypeScript SDK

Official TypeScript/JavaScript client for [RAGfly](https://ragfly.ai) — retrieval infrastructure for your AI agents.

Zero dependencies, native `fetch`. Runs on **Node 18+**, the **browser**, **Vercel Edge** and **Cloudflare Workers**.

## Install

```bash
npm install @ragfly/sdk
```

## Quick start

```ts
import { RAGfly } from "@ragfly/sdk";

const client = new RAGfly({ apiKey: "slm_live_..." });

// Ask a question (RAG end-to-end)
const resp = await client.ask("What are the Q1 sales figures?");
console.log(resp.answer);

// Streaming
for await (const chunk of client.ask("Summarize active contracts", { stream: true })) {
  process.stdout.write(chunk.delta);
}

// Semantic search (retrieval only)
const results = await client.search("maintenance contracts", { limit: 5 });
for (const doc of results.documents) {
  console.log(doc.nombre, doc.similitudMax);
}
```

## API Keys

Generate an API key from [app.ragfly.ai](https://app.ragfly.ai) → Settings → API Keys.
Pass it in the constructor, or load it from an env var:

```ts
const client = new RAGfly({ apiKey: process.env.RAGFLY_API_KEY! });
```

## Methods

| Method | Description |
|--------|-------------|
| `client.ask(question, { stream?, conversationId? })` | RAG end-to-end: retrieve + generate. `stream: true` → `AsyncGenerator<AskChunk>`, otherwise `Promise<AskResponse>` |
| `client.askStream(question, conversationId?)` | Same as `ask(q, { stream: true })`, explicit |
| `client.search(query, { limit?, minSimilitud?, codigoEntidad?, idEspacio? })` | Hybrid retrieval (vector + lexical + rerank) |
| `client.listDocuments({ page?, pageSize?, estado? })` | List corpus documents |

## Options

```ts
new RAGfly({
  apiKey: "slm_live_...",
  baseUrl: "https://api.ragfly.ai", // default
  timeoutMs: 60000,                 // default
  fetch: customFetch,               // optional, defaults to globalThis.fetch
});
```

## Errors

All non-2xx responses throw `RAGflyError` (with `.statusCode`):

```ts
import { RAGflyError } from "@ragfly/sdk";

try {
  await client.ask("…");
} catch (err) {
  if (err instanceof RAGflyError) console.error(err.statusCode, err.message);
}
```

## Field naming

The backend speaks `snake_case`; this SDK exposes `camelCase`. Mapping for reference:

| Backend (`snake_case`) | SDK (`camelCase`) |
|---|---|
| `score_rerank` | `scoreRerank` |
| `rrf_score` | `rrfScore` |
| `similitud_max` | `similitudMax` |
| `total_documentos` | `totalDocumentos` |
| `total_chunks` | `totalChunks` |
| `duracion_ms` | `duracionMs` |

> Mirror of the [Python SDK](https://github.com/rufinocabreragaillard/ragfly-python) (`pip install ragfly`). Same surface, same auth, same backend.

## Links

- Docs: https://api.ragfly.ai/docs
- Site: https://ragfly.ai
