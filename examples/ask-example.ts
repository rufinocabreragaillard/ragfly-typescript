import { RAGfly } from "@ragfly/sdk";

const client = new RAGfly({ apiKey: process.env.RAGFLY_API_KEY ?? "rfly_..." });

// Pregunta simple (RAG end-to-end)
const resp = await client.ask("¿Cuáles son las ventas de Q1?");
console.log(resp.answer);

// Streaming token a token
process.stdout.write("\n--- streaming ---\n");
for await (const chunk of client.ask("Resumí los contratos activos", { stream: true })) {
  process.stdout.write(chunk.delta);
}
process.stdout.write("\n");

// Búsqueda semántica (solo recuperación)
const results = await client.search("contratos de mantenimiento", { limit: 5 });
for (const doc of results.documents) {
  console.log(doc.nombre, doc.similitudMax);
}
