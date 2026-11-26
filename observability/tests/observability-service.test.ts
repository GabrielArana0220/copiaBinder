import { describe, expect, it, vi } from "vitest";
import { createObservabilityReader } from "../src/features/observability/service";
import type { Catalog, Health } from "../src/features/observability/types";
import {
  ApiHttpError,
  ApiResponseError,
  apiErrorMessage,
  createApiClient,
} from "../src/services/api/client";

// Synthetic fixtures only; no network, Cognito or AWS resources are consulted.
const TEST_ACCESS_TOKEN = "unit-test-access-token";
const PRODUCTION_BASE = "https://api.binder.la/prod/observability";
const CATALOG: Catalog = {
  domains: [{
    id: "test-domain",
    name: "Test domain",
    applications: [{
      id: "test-application",
      name: "Test application",
      functions: [{
        name: "test-function",
        component: "test-component",
        log_group: "/aws/lambda/test-function",
      }],
    }],
  }],
};
const HEALTH: Health = {
  status: "ok",
  catalog_applications: 1,
  selected_log_groups: 1,
  logging: { detailed: false, version: 2 },
  checks: { ssm: "available", query_registry: "configured" },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function readerWithBody(body: unknown, baseUrl = PRODUCTION_BASE) {
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(body));
  const getAccessToken = vi.fn(() => TEST_ACCESS_TOKEN);
  const reader = createObservabilityReader(createApiClient({ baseUrl, getAccessToken, fetchFn }));
  return { reader, fetchFn, getAccessToken };
}

function catalogWithDomain(domain: unknown): unknown {
  return { domains: [domain] };
}

function catalogWithApplication(application: unknown): unknown {
  return catalogWithDomain({ id: "test-domain", applications: [application] });
}

function catalogWithFunction(fn: unknown): unknown {
  return catalogWithApplication({ id: "test-application", functions: [fn] });
}

function withoutKey(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

const INVALID_CATALOGS: [string, unknown][] = [
  ["null", null],
  ["an array instead of an object", []],
  ["missing domains", {}],
  ["non-array domains", { domains: {} }],
  ["null domain", catalogWithDomain(null)],
  ["missing domain id", catalogWithDomain({ applications: [] })],
  ["non-string domain id", catalogWithDomain({ id: 1, applications: [] })],
  ["missing applications", catalogWithDomain({ id: "test-domain" })],
  ["non-array applications", catalogWithDomain({ id: "test-domain", applications: {} })],
  ["null optional domain name", catalogWithDomain({ id: "test-domain", name: null, applications: [] })],
  ["null application", catalogWithApplication(null)],
  ["missing application id", catalogWithApplication({ functions: [] })],
  ["non-string application id", catalogWithApplication({ id: false, functions: [] })],
  ["missing functions", catalogWithApplication({ id: "test-application" })],
  ["non-array functions", catalogWithApplication({ id: "test-application", functions: {} })],
  ["non-string optional application name", catalogWithApplication({ id: "test-application", name: 1, functions: [] })],
  ["null function", catalogWithFunction(null)],
  ...["name", "component", "log_group"].flatMap((field): [string, unknown][] => {
    const fn = CATALOG.domains[0].applications[0].functions[0];
    return [
      [`missing function ${field}`, catalogWithFunction(withoutKey(fn, field))],
      [`non-string function ${field}`, catalogWithFunction({ ...fn, [field]: 1 })],
    ];
  }),
];

const INVALID_HEALTH: [string, unknown][] = [
  ["null", null],
  ["an array", []],
  ...Object.keys(HEALTH).map((field): [string, unknown] => [
    `missing ${field}`, withoutKey(HEALTH, field),
  ]),
  ["another status", { ...HEALTH, status: "unavailable" }],
  ["string application count", { ...HEALTH, catalog_applications: "1" }],
  ["fractional application count", { ...HEALTH, catalog_applications: 1.5 }],
  ["null application count", { ...HEALTH, catalog_applications: null }],
  ["string log group count", { ...HEALTH, selected_log_groups: "1" }],
  ["fractional log group count", { ...HEALTH, selected_log_groups: 1.5 }],
  ["null logging", { ...HEALTH, logging: null }],
  ["missing logging detailed", { ...HEALTH, logging: { version: 1 } }],
  ["non-boolean detailed", { ...HEALTH, logging: { detailed: "false", version: 1 } }],
  ["missing logging version", { ...HEALTH, logging: { detailed: false } }],
  ["non-integer logging version", { ...HEALTH, logging: { detailed: false, version: 1.5 } }],
  ["string logging version", { ...HEALTH, logging: { detailed: false, version: "1" } }],
  ["null checks", { ...HEALTH, checks: null }],
  ["missing ssm check", { ...HEALTH, checks: { query_registry: "configured" } }],
  ["another ssm check", { ...HEALTH, checks: { ...HEALTH.checks, ssm: "unavailable" } }],
  ["missing query registry check", { ...HEALTH, checks: { ssm: "available" } }],
  ["another query registry check", { ...HEALTH, checks: { ...HEALTH.checks, query_registry: "unknown" } }],
];

describe("createObservabilityReader", () => {
  it("does not authenticate or fetch when created", () => {
    const { fetchFn, getAccessToken } = readerWithBody(CATALOG);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it.each([PRODUCTION_BASE, `${PRODUCTION_BASE}/`, "/observability-api", "/observability-api/"])(
    "only calls GET catalog and health, preserving the base %s",
    async (baseUrl) => {
      const fetchFn = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(CATALOG))
        .mockResolvedValueOnce(jsonResponse(HEALTH));
      const getAccessToken = vi.fn(() => TEST_ACCESS_TOKEN);
      const reader = createObservabilityReader(createApiClient({ baseUrl, getAccessToken, fetchFn }));
      const controller = new AbortController();
      await expect(reader.getCatalog(controller.signal)).resolves.toEqual(CATALOG);
      await expect(reader.getHealth(controller.signal)).resolves.toEqual(HEALTH);
      const base = baseUrl.replace(/\/$/, "");
      const init = {
        method: "GET",
        headers: { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      };
      expect(fetchFn.mock.calls).toEqual([[`${base}/catalog`, init], [`${base}/health`, init]]);
      expect(getAccessToken).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    { domains: [] },
    { domains: [{ id: "test-domain", applications: [] }] },
    { domains: [{ id: "test-domain", applications: [{ id: "test-application", functions: [] }] }] },
  ])("accepts empty collections permitted by the schema: %j", async (catalog) => {
    const { reader } = readerWithBody(catalog);
    await expect(reader.getCatalog()).resolves.toEqual(catalog);
  });

  it("accepts absent optional names without inventing display names", async () => {
    const catalog = {
      domains: [{ id: "test-domain", applications: [{
        id: "test-application", functions: CATALOG.domains[0].applications[0].functions,
      }] }],
    };
    const { reader } = readerWithBody(catalog);
    const result = await reader.getCatalog();
    expect(result).toEqual(catalog);
    expect(result.domains[0]).not.toHaveProperty("name");
    expect(result.domains[0].applications[0]).not.toHaveProperty("name");
  });

  it("does not invent string constraints absent from the schema", async () => {
    const catalog = { domains: [{ id: "", name: "", applications: [{
      id: "", name: "", functions: [{ name: "", component: "", log_group: "" }],
    }] }] };
    const { reader } = readerWithBody(catalog);
    await expect(reader.getCatalog()).resolves.toEqual(catalog);
  });

  it("accepts both detailed logging states and zero counts", async () => {
    const health = {
      ...HEALTH,
      catalog_applications: 0,
      selected_log_groups: 0,
      logging: { detailed: true, version: 0 },
    };
    const { reader } = readerWithBody(health);
    await expect(reader.getHealth()).resolves.toEqual(health);
  });

  it("permits additional properties as the response schema does", async () => {
    const { reader } = readerWithBody({ ...HEALTH, future_field: "test" });
    await expect(reader.getHealth()).resolves.toMatchObject(HEALTH);
  });

  it.each(INVALID_CATALOGS)("rejects a malformed catalog: %s", async (_label, body) => {
    const { reader, fetchFn } = readerWithBody(body);
    const request = reader.getCatalog();
    await expect(request).rejects.toBeInstanceOf(ApiResponseError);
    await expect(request).rejects.toThrow("La API devolvió una respuesta no válida.");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each(INVALID_HEALTH)("rejects malformed health: %s", async (_label, body) => {
    const { reader, fetchFn } = readerWithBody(body);
    await expect(reader.getHealth()).rejects.toBeInstanceOf(ApiResponseError);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each(["getCatalog", "getHealth"] as const)("rejects malformed JSON from %s safely", async (method) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("unit-test-private-invalid-json"));
    const reader = createObservabilityReader(createApiClient({
      baseUrl: PRODUCTION_BASE, getAccessToken: () => TEST_ACCESS_TOKEN, fetchFn,
    }));
    const error = await reader[method]().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiResponseError);
    expect(apiErrorMessage(error)).toBe("La API devolvió una respuesta no válida.");
    expect(apiErrorMessage(error)).not.toContain("unit-test-private-invalid-json");
  });

  it.each([401, 403, 429, 503])("preserves HTTP %s without retrying or substituting data", async (status) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("unit-test-private-body", { status }));
    const reader = createObservabilityReader(createApiClient({
      baseUrl: PRODUCTION_BASE, getAccessToken: () => TEST_ACCESS_TOKEN, fetchFn,
    }));
    const request = reader.getCatalog();
    await expect(request).rejects.toBeInstanceOf(ApiHttpError);
    await expect(request).rejects.toMatchObject({ status });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each(["getCatalog", "getHealth"] as const)("preserves cancellation for %s", async (method) => {
    const controller = new AbortController();
    controller.abort();
    const { reader, fetchFn, getAccessToken } = readerWithBody(CATALOG);
    await expect(reader[method](controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});
