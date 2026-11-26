import { describe, expect, it, vi } from "vitest";
import {
  ApiHttpError,
  ApiResponseError,
  apiErrorMessage,
  createApiClient,
  isApiAbortError,
} from "../src/services/api/client";

// Synthetic unit-test values only: never real credentials or application state.
const TEST_ACCESS_TOKEN = "unit-test-access-token";
const PRODUCTION_BASE = "https://api.binder.la/prod/observability";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createApiClient", () => {
  it("does not fetch or request a token when constructed", () => {
    const fetchFn = vi.fn<typeof fetch>();
    const getAccessToken = vi.fn(() => TEST_ACCESS_TOKEN);
    createApiClient({ baseUrl: PRODUCTION_BASE, getAccessToken, fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    [PRODUCTION_BASE, "/health", `${PRODUCTION_BASE}/health`],
    [`${PRODUCTION_BASE}/`, "health?detail=1", `${PRODUCTION_BASE}/health?detail=1`],
    ["/observability-api", "/health", "/observability-api/health"],
    ["/observability-api/", "health", "/observability-api/health"],
  ])("uses the configured base %s with route %s", async (baseUrl, path, expectedUrl) => {
    const fixture = { result: "unit-test-fixture" };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fixture));
    const client = createApiClient({
      baseUrl,
      getAccessToken: async () => TEST_ACCESS_TOKEN,
      fetchFn,
    });

    await expect(client.get<typeof fixture>(path)).resolves.toEqual(fixture);
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(expectedUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
      credentials: "omit",
      redirect: "error",
      signal: undefined,
    });
  });

  it("requests a fresh access token for every explicit call", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(null));
    const getAccessToken = vi
      .fn<() => string>()
      .mockReturnValueOnce("first-unit-test-token")
      .mockReturnValueOnce("second-unit-test-token");
    const client = createApiClient({ baseUrl: PRODUCTION_BASE, getAccessToken, fetchFn });

    await client.get("/first");
    await client.get("/second");
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.map(([, init]) => new Headers(init?.headers).get("Authorization")))
      .toEqual(["Bearer first-unit-test-token", "Bearer second-unit-test-token"]);
  });

  it.each([null, undefined, "", "   ", "token with spaces", "token\r\ninjection", "token\u0000"])(
    "does not fetch without a usable access token (%s)",
    async (token) => {
      const fetchFn = vi.fn<typeof fetch>();
      const client = createApiClient({
        baseUrl: PRODUCTION_BASE,
        getAccessToken: () => token,
        fetchFn,
      });
      await expect(client.get("/health")).rejects.toThrow("An access token is required");
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it("propagates token-provider errors without fetching", async () => {
    const failure = new Error("Unit-test session unavailable");
    const fetchFn = vi.fn<typeof fetch>();
    const client = createApiClient({
      baseUrl: PRODUCTION_BASE,
      getAccessToken: async () => { throw failure; },
      fetchFn,
    });
    await expect(client.get("/health")).rejects.toBe(failure);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [401, "Unauthorized"],
    [403, "Forbidden"],
    [500, "Internal Server Error"],
  ])("reports HTTP %s clearly without returning its body", async (status, statusText) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("Unit-test error body", { status, statusText }),
    );
    const client = createApiClient({
      baseUrl: PRODUCTION_BASE,
      getAccessToken: () => TEST_ACCESS_TOKEN,
      fetchFn,
    });
    const request = client.get("/health");
    await expect(request).rejects.toBeInstanceOf(ApiHttpError);
    await expect(request).rejects.toMatchObject({
      status,
      statusText,
      message: `API request failed: HTTP ${status} ${statusText}.`,
    });
  });

  it("propagates network failures without retrying", async () => {
    const failure = new TypeError("Unit-test network failure");
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const client = createApiClient({
      baseUrl: PRODUCTION_BASE,
      getAccessToken: () => TEST_ACCESS_TOKEN,
      fetchFn,
    });
    await expect(client.get("/health")).rejects.toBe(failure);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("forwards an AbortSignal and preserves cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new DOMException("Unit-test cancellation", "AbortError");
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const fetchFn = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Expected the caller's AbortSignal");
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        notifyStarted();
      });
    });
    const client = createApiClient({
      baseUrl: PRODUCTION_BASE,
      getAccessToken: () => TEST_ACCESS_TOKEN,
      fetchFn,
    });
    const request = client.get("/health", controller.signal);
    const rejected = expect(request).rejects.toBe(cancellation);
    await started;
    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    controller.abort(cancellation);
    await rejected;
  });

  it("does not request a token or fetch when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const getAccessToken = vi.fn(() => TEST_ACCESS_TOKEN);
    const fetchFn = vi.fn<typeof fetch>();
    const client = createApiClient({ baseUrl: PRODUCTION_BASE, getAccessToken, fetchFn });
    await expect(client.get("/health", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not fetch if cancelled while acquiring the token", async () => {
    const controller = new AbortController();
    let provideToken!: (token: string) => void;
    const getAccessToken = () => new Promise<string>((resolve) => { provideToken = resolve; });
    const fetchFn = vi.fn<typeof fetch>();
    const client = createApiClient({ baseUrl: PRODUCTION_BASE, getAccessToken, fetchFn });
    const request = client.get("/health", controller.signal);
    controller.abort();
    provideToken(TEST_ACCESS_TOKEN);
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    "https://other.example.com/health",
    "http://other.example.com/health",
    "//other.example.com/health",
    "///other.example.com/health",
    "data:text/plain,unit-test",
    "\\\\other.example.com/health",
    "/\\other.example.com/health",
    "../health",
    "/../health",
    "nested/../../health",
    "/./health",
    "/%2e%2e/health",
    "/%2E./health",
    "/%2f%2fother.example.com",
    "/%5c%5cother.example.com",
    "/%252e%252e/health",
    "/malformed%",
    "/health#fragment",
    "/line\nbreak",
    "/tab\tbreak",
    " /health",
    "/health ",
    "",
  ])("rejects an unsafe route %s before authentication or fetch", async (path) => {
    const getAccessToken = vi.fn(() => TEST_ACCESS_TOKEN);
    const fetchFn = vi.fn<typeof fetch>();
    const client = createApiClient({ baseUrl: PRODUCTION_BASE, getAccessToken, fetchFn });
    await expect(client.get(path)).rejects.toThrow("API path");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    "http://api.example.com",
    "https://user:password@api.example.com",
    "https://api.example.com?query=1",
    "https://api.example.com#fragment",
    "/another-proxy",
    "/observability-api/extra",
  ])("rejects an unsafe base %s without fetching", (baseUrl) => {
    const fetchFn = vi.fn<typeof fetch>();
    expect(() => createApiClient({
      baseUrl,
      getAccessToken: () => TEST_ACCESS_TOKEN,
      fetchFn,
    })).toThrow("VITE_API_BASE_URL");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 503])("never consumes HTTP %s error bodies or retries", async (status) => {
    const response = new Response("unit-test-private-response-body", { status });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);
    const getAccessToken = vi.fn(() => TEST_ACCESS_TOKEN);
    const client = createApiClient({ baseUrl: PRODUCTION_BASE, getAccessToken, fetchFn });
    const error = await client.get("/health").catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect(error).toMatchObject({ status, statusText: "" });
    expect(response.bodyUsed).toBe(false);
    expect(apiErrorMessage(error)).not.toContain("unit-test-private-response-body");
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it("rejects malformed JSON with a safe error rather than parser details", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("unit-test-private-invalid-json"));
    const client = createApiClient({
      baseUrl: PRODUCTION_BASE, getAccessToken: () => TEST_ACCESS_TOKEN, fetchFn,
    });
    const request = client.get("/health");
    await expect(request).rejects.toBeInstanceOf(ApiResponseError);
    await expect(request).rejects.toThrow("La API devolvió una respuesta no válida.");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("preserves cancellation while reading the JSON body", async () => {
    const cancellation = new DOMException("Unit-test body cancellation", "AbortError");
    const response = jsonResponse(null);
    vi.spyOn(response, "json").mockRejectedValue(cancellation);
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);
    const client = createApiClient({
      baseUrl: PRODUCTION_BASE, getAccessToken: () => TEST_ACCESS_TOKEN, fetchFn,
    });
    await expect(client.get("/health")).rejects.toBe(cancellation);
  });

  it("does not return parsed data if the caller cancels during body reading", async () => {
    const controller = new AbortController();
    const response = jsonResponse(null);
    vi.spyOn(response, "json").mockImplementation(async () => {
      controller.abort();
      return { status: "ok" };
    });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);
    const client = createApiClient({
      baseUrl: PRODUCTION_BASE, getAccessToken: () => TEST_ACCESS_TOKEN, fetchFn,
    });
    await expect(client.get("/health", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("apiErrorMessage", () => {
  it.each([
    [401, "Tu sesión ha caducado. Vuelve a iniciar sesión."],
    [403, "No tienes permisos para consultar observabilidad. Debes pertenecer al grupo autorizado."],
    [429, "Se han realizado demasiadas consultas. Espera un momento e inténtalo de nuevo."],
    [503, "El servicio de observabilidad no está disponible temporalmente. Inténtalo de nuevo más tarde."],
    [500, "No se pudo completar la consulta a la API. Inténtalo de nuevo."],
  ])("provides Spanish HTTP %s messages without reflecting status text", (status, message) => {
    const error = new ApiHttpError(status, `unit-test-private-status-text ${TEST_ACCESS_TOKEN}`);
    expect(apiErrorMessage(error)).toBe(message);
    expect(apiErrorMessage(error)).not.toContain(TEST_ACCESS_TOKEN);
  });

  it("reports invalid responses without echoing their content", () => {
    expect(apiErrorMessage(new ApiResponseError())).toBe("La API devolvió una respuesta no válida.");
  });

  it("reports network failures without echoing the original exception", () => {
    expect(apiErrorMessage(new TypeError(`Unit-test network detail ${TEST_ACCESS_TOKEN}`)))
      .toBe("No se pudo conectar con la API. Comprueba tu conexión e inténtalo de nuevo.");
  });

  it.each([new Error(TEST_ACCESS_TOKEN), TEST_ACCESS_TOKEN, { message: TEST_ACCESS_TOKEN }, null, undefined])(
    "does not expose unknown errors or token-provider details (%s)",
    (error) => {
      expect(apiErrorMessage(error)).toBe("No se pudo completar la consulta. Inténtalo de nuevo.");
      expect(apiErrorMessage(error)).not.toContain(TEST_ACCESS_TOKEN);
    },
  );

  it.each([
    new DOMException("Unit-test cancellation", "AbortError"),
    Object.assign(new Error("Unit-test cancellation"), { name: "AbortError" }),
    { name: "AbortError", message: TEST_ACCESS_TOKEN },
  ])("classifies cancellations so the UI can ignore them (%s)", (error) => {
    expect(isApiAbortError(error)).toBe(true);
    expect(apiErrorMessage(error)).toBe("La consulta se canceló.");
  });

  it.each([null, undefined, "AbortError", new Error("AbortError"), { name: "TypeError" }])(
    "does not classify other errors as cancellation (%s)",
    (error) => { expect(isApiAbortError(error)).toBe(false); },
  );
});
