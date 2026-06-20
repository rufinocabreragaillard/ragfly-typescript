/**
 * RAGfly TypeScript SDK — cliente oficial.
 *
 * Espejo en TypeScript del SDK Python (`ragfly/client.py`). Wrapper HTTP delgado
 * sobre la API REST + SSE de RAGfly. Sin dependencias: usa `fetch` nativo, por lo
 * que corre en Node 18+, navegador, Vercel Edge y Cloudflare Workers.
 */

import { RAGflyError } from "./errors.js";
import type {
  AskChunk,
  AskResponse,
  Chunk,
  Document,
  SearchResult,
} from "./models.js";

const DEFAULT_BASE_URL = "https://api.ragfly.ai";
const DEFAULT_TIMEOUT_MS = 60_000;

export interface RAGflyOptions {
  /** API key de RAGfly (formato `slm_live_...`). Generala en app.ragfly.ai → Settings → API Keys. */
  apiKey: string;
  /** URL base del backend. Default: `https://api.ragfly.ai`. */
  baseUrl?: string;
  /** Timeout en milisegundos por request. Default: 60000. */
  timeoutMs?: number;
  /** `fetch` a usar (para tests o runtimes sin fetch global). Default: `globalThis.fetch`. */
  fetch?: typeof fetch;
}

export interface SearchOptions {
  limit?: number;
  minSimilitud?: number;
  codigoEntidad?: string;
  idEspacio?: number;
}

export interface AskOptions {
  conversationId?: number;
  stream?: boolean;
}

export class RAGfly {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  /**
   * @example
   * const client = new RAGfly({ apiKey: "slm_live_..." });
   * const resp = await client.ask("¿Cuáles son las ventas de Q1?");
   * console.log(resp.answer);
   */
  constructor(options: RAGflyOptions) {
    if (!options?.apiKey) {
      throw new RAGflyError("apiKey es requerido");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new RAGflyError(
        "No hay `fetch` disponible. Usá Node 18+ o pasá `fetch` en las opciones.",
      );
    }
    this.fetchImpl = f.bind(globalThis);
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private url(path: string): string {
    return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * `fetch` con timeout. El timer se cancela en cuanto llegan los headers de
   * respuesta, de modo que la lectura del body en streaming no se aborta.
   */
  private async doFetch(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: { ...this.headers(), ...(init.headers ?? {}) },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new RAGflyError(`Timeout tras ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async raiseForStatus(resp: Response): Promise<void> {
    if (resp.status < 400) return;
    let detail: string;
    try {
      const data = (await resp.clone().json()) as { detail?: string };
      detail = data?.detail ?? JSON.stringify(data);
    } catch {
      detail = await resp.text().catch(() => resp.statusText);
    }
    throw new RAGflyError(detail, resp.status);
  }

  /** Crea una conversación temporal y devuelve su id. */
  private async getOrCreateConversation(): Promise<number> {
    const resp = await this.doFetch("/interfaz/conversaciones", {
      method: "POST",
      body: JSON.stringify({ titulo: "SDK", temporal: true }),
    });
    await this.raiseForStatus(resp);
    const data = (await resp.json()) as { id: number };
    return data.id;
  }

  // ── API pública ──────────────────────────────────────────────────────────

  /**
   * Búsqueda semántica híbrida (vector + léxico + rerank).
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const payload: Record<string, unknown> = {
      q: query,
      limit: options.limit ?? 10,
      min_similitud: options.minSimilitud ?? 0.0,
    };
    if (options.codigoEntidad) payload.codigo_entidad = options.codigoEntidad;
    if (options.idEspacio) payload.id_espacio = options.idEspacio;

    const resp = await this.doFetch("/documentos/buscar-semantico", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await this.raiseForStatus(resp);
    const data = (await resp.json()) as Record<string, any>;

    const documents: Document[] = (data.resultados ?? []).map((d: any) => {
      const chunks: Chunk[] = (d.chunks ?? []).map((c: any) => {
        const { texto, similitud, score_rerank, pagina, ...rest } = c;
        return {
          texto: texto ?? "",
          similitud: similitud ?? null,
          scoreRerank: score_rerank ?? null,
          pagina: pagina ?? null,
          extra: rest,
        };
      });
      return {
        codigo: d.codigo_documento,
        nombre: d.nombre_documento,
        resumen: d.resumen_documento ?? null,
        url: d.url ?? null,
        rrfScore: d.rrf_score ?? null,
        similitudMax: d.similitud_max ?? null,
        chunks,
      };
    });

    return {
      query: data.q,
      totalDocumentos: data.total_documentos,
      totalChunks: data.total_chunks,
      duracionMs: data.duracion_ms ?? null,
      documents,
    };
  }

  /**
   * Pregunta al RAG con respuesta completa.
   *
   * Para streaming token a token, usá {@link askStream} o `ask(q, { stream: true })`.
   */
  ask(question: string, options?: { conversationId?: number; stream?: false }): Promise<AskResponse>;
  ask(question: string, options: { conversationId?: number; stream: true }): AsyncGenerator<AskChunk>;
  ask(
    question: string,
    options: AskOptions = {},
  ): Promise<AskResponse> | AsyncGenerator<AskChunk> {
    if (options.stream) {
      return this.askStream(question, options.conversationId);
    }
    return this.askSync(question, options.conversationId);
  }

  /** Pregunta al RAG y emite los tokens de la respuesta a medida que llegan (SSE). */
  async *askStream(question: string, conversationId?: number): AsyncGenerator<AskChunk> {
    const convId = conversationId ?? (await this.getOrCreateConversation());
    const resp = await this.doFetch(
      `/interfaz/conversaciones/${convId}/mensajes/stream`,
      { method: "POST", body: JSON.stringify({ contenido: question }) },
    );
    await this.raiseForStatus(resp);
    if (!resp.body) {
      throw new RAGflyError("La respuesta de streaming no tiene body");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data: ")) continue;
          let payload: any;
          try {
            payload = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (payload.error) throw new RAGflyError(payload.error);
          if (payload.done) return;
          if (typeof payload.text === "string") {
            yield { delta: payload.text };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async askSync(question: string, conversationId?: number): Promise<AskResponse> {
    const convId = conversationId ?? (await this.getOrCreateConversation());
    const parts: string[] = [];
    for await (const chunk of this.askStream(question, convId)) {
      parts.push(chunk.delta);
    }
    return { answer: parts.join(""), conversationId: convId, messageId: null };
  }

  /** Lista documentos del corpus con paginación. */
  async listDocuments(
    options: { page?: number; pageSize?: number; estado?: string } = {},
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    params.set("pagina", String(options.page ?? 1));
    params.set("limite", String(options.pageSize ?? 20));
    if (options.estado) params.set("estado", options.estado);

    const resp = await this.doFetch(`/documentos/paginado?${params.toString()}`, {
      method: "GET",
    });
    await this.raiseForStatus(resp);
    return (await resp.json()) as Record<string, unknown>;
  }
}
