import { ApiResponseError, type ApiClient } from "../../services/api/client";
import type {
  Catalog,
  CatalogApplication,
  CatalogDomain,
  CatalogFunction,
  Health,
} from "./types";

export interface ObservabilityReader {
  getCatalog(signal?: AbortSignal): Promise<Catalog>;
  getHealth(signal?: AbortSignal): Promise<Health>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOptionalName(value: Record<string, unknown>): boolean {
  return !("name" in value) || typeof value.name === "string";
}

function isCatalogFunction(value: unknown): value is CatalogFunction {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.component === "string" &&
    typeof value.log_group === "string"
  );
}

function isCatalogApplication(value: unknown): value is CatalogApplication {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    hasOptionalName(value) &&
    Array.isArray(value.functions) &&
    value.functions.every(isCatalogFunction)
  );
}

function isCatalogDomain(value: unknown): value is CatalogDomain {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    hasOptionalName(value) &&
    Array.isArray(value.applications) &&
    value.applications.every(isCatalogApplication)
  );
}

function isCatalog(value: unknown): value is Catalog {
  return (
    isRecord(value) &&
    Array.isArray(value.domains) &&
    value.domains.every(isCatalogDomain)
  );
}

function isHealth(value: unknown): value is Health {
  return (
    isRecord(value) &&
    value.status === "ok" &&
    Number.isInteger(value.catalog_applications) &&
    Number.isInteger(value.selected_log_groups) &&
    isRecord(value.logging) &&
    typeof value.logging.detailed === "boolean" &&
    Number.isInteger(value.logging.version) &&
    isRecord(value.checks) &&
    value.checks.ssm === "available" &&
    value.checks.query_registry === "configured"
  );
}

/** Read-only and lazy: creating a reader neither authenticates nor fetches. */
export function createObservabilityReader(client: ApiClient): ObservabilityReader {
  return {
    async getCatalog(signal?: AbortSignal): Promise<Catalog> {
      const response = await client.get<unknown>("/catalog", signal);
      if (!isCatalog(response)) throw new ApiResponseError();
      return response;
    },
    async getHealth(signal?: AbortSignal): Promise<Health> {
      const response = await client.get<unknown>("/health", signal);
      if (!isHealth(response)) throw new ApiResponseError();
      return response;
    },
  };
}
