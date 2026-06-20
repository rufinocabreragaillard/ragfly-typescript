/** Error lanzado por el SDK ante una respuesta de error del backend. */
export class RAGflyError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "RAGflyError";
    this.statusCode = statusCode;
    // Restaura la cadena de prototipos al extender Error (target < ES2015 safety).
    Object.setPrototypeOf(this, RAGflyError.prototype);
  }
}
