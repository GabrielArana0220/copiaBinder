export interface PublicAppConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  apiBaseUrl: string;
}

const LOCAL_API_BASE = "/observability-api";
const REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;
const USER_POOL_PATTERN = /^([a-z]{2}(?:-[a-z]+)+-\d+)_[A-Za-z0-9]+$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_+]{1,128}$/;

function requiredString(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid public configuration: ${key}.`);
  }
  return value.trim();
}

/** Validate a public API base without consulting browser or backend environment. */
export function normalizeApiBaseUrl(value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("VITE_API_BASE_URL must be a non-empty string.");
  }

  const baseUrl = value.trim();
  if (baseUrl === LOCAL_API_BASE || baseUrl === `${LOCAL_API_BASE}/`) {
    return LOCAL_API_BASE;
  }

  if (!/^https:\/\/[^/?#]+/i.test(baseUrl) || /[\s\\]/u.test(baseUrl)) {
    throw new Error(
      "VITE_API_BASE_URL must be an absolute HTTPS URL or /observability-api.",
    );
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("VITE_API_BASE_URL must be a valid absolute HTTPS URL.");
  }

  const authority = baseUrl.slice(baseUrl.indexOf("://") + 3).split("/", 1)[0] ?? "";
  // Check delimiters as well: URL.search/hash omit a bare trailing ? or #.
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    authority.includes("@") ||
    baseUrl.includes("?") ||
    baseUrl.includes("#")
  ) {
    throw new Error(
      "VITE_API_BASE_URL must use HTTPS without credentials, query or fragment.",
    );
  }

  return url.href.replace(/\/+$/, "");
}

export function parsePublicConfig(env: Record<string, unknown>): PublicAppConfig {
  const region = requiredString(env, "VITE_AWS_REGION");
  const userPoolId = requiredString(env, "VITE_COGNITO_USER_POOL_ID");
  const userPoolClientId = requiredString(env, "VITE_COGNITO_CLIENT_ID");
  const apiBaseUrl = requiredString(env, "VITE_API_BASE_URL");

  if (!REGION_PATTERN.test(region)) {
    throw new Error("VITE_AWS_REGION must be a valid AWS region identifier.");
  }

  const poolMatch = USER_POOL_PATTERN.exec(userPoolId);
  if (!poolMatch || userPoolId.length > 55) {
    throw new Error("VITE_COGNITO_USER_POOL_ID must be a valid Cognito User Pool ID.");
  }
  if (poolMatch[1] !== region) {
    throw new Error("VITE_COGNITO_USER_POOL_ID must belong to VITE_AWS_REGION.");
  }
  if (!CLIENT_ID_PATTERN.test(userPoolClientId)) {
    throw new Error("VITE_COGNITO_CLIENT_ID contains invalid characters or length.");
  }

  return {
    region,
    userPoolId,
    userPoolClientId,
    apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl),
  };
}
