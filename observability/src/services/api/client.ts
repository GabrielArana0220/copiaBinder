import { normalizeApiBaseUrl } from "../../config/env";

type AccessTokenProvider = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: AccessTokenProvider;
  fetchFn?: typeof fetch;
}

export interface ApiClient {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
}

export class ApiHttpError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string) {
    super(`API request failed: HTTP ${status}${statusText ? ` ${statusText}` : ""}.`);
    this.name = "ApiHttpError";
    this.status = status;
    this.statusText = statusText;
  }
}

/** Invalid JSON or a response that does not match the read endpoint's contract. */
export class ApiResponseError extends Error {
  constructor() {
    super("La API devolvió una respuesta no válida.");
    this.name = "ApiResponseError";
  }
}

/** Also recognizes AbortError values from another browser realm. */
export function isApiAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/** Safe UI text: never reflect response bodies, status text or provider errors. */
export function apiErrorMessage(error: unknown): string {
  if (isApiAbortError(error)) return "La consulta se canceló.";
  if (error instanceof ApiHttpError) {
    switch (error.status) {
      case 401:
        return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
      case 403:
        return "No tienes permisos para consultar observabilidad. Debes pertenecer al grupo autorizado.";
      case 429:
        return "Se han realizado demasiadas consultas. Espera un momento e inténtalo de nuevo.";
      case 503:
        return "El servicio de observabilidad no está disponible temporalmente. Inténtalo de nuevo más tarde.";
      default:
        return "No se pudo completar la consulta a la API. Inténtalo de nuevo.";
    }
  }
  if (error instanceof ApiResponseError) return "La API devolvió una respuesta no válida.";
  if (error instanceof TypeError) {
    return "No se pudo conectar con la API. Comprueba tu conexión e inténtalo de nuevo.";
  }
  return "No se pudo completar la consulta. Inténtalo de nuevo.";
}

function apiUrl(baseUrl: string, path: string): string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path !== path.trim() ||
    /[\u0000-\u0020\u007f\\#]/u.test(path) ||
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    path.startsWith("//")
  ) {
    throw new Error("API path must be relative to the configured API base.");
  }

  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  const pathname = relativePath.split("?", 1)[0] ?? "";
  for (const segment of pathname.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("API path contains invalid URL encoding.");
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      /[\u0000-\u0020\u007f/\\%]/u.test(decoded)
    ) {
      throw new Error("API path must not contain traversal or encoded separators.");
    }
  }

  // Append instead of resolving a leading slash, preserving the API base prefix.
  return `${baseUrl}/${relativePath}`;
}

/** No network or authentication work occurs until a consumer calls get(). */
export function createApiClient({
  baseUrl,
  getAccessToken,
  fetchFn = globalThis.fetch,
}: ApiClientOptions): ApiClient {
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);

  return {
    async get<T>(path: string, signal?: AbortSignal): Promise<T> {
      const url = apiUrl(normalizedBaseUrl, path);
      signal?.throwIfAborted();

      const token = await getAccessToken();
      if (
        typeof token !== "string" ||
        token.trim() === "" ||
        /[\s\u0000-\u001f\u007f]/u.test(token)
      ) {
        throw new Error("An access token is required for API requests.");
      }
      signal?.throwIfAborted();

      const response = await fetchFn(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        throw new ApiHttpError(response.status, response.statusText);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) throw new ApiResponseError();
        throw error;
      }
      signal?.throwIfAborted();
      return body as T;
    },
  };
}
