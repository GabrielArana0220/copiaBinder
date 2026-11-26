import { describe, expect, it } from "vitest";
import { parsePublicConfig } from "../src/config/env";

const validEnv = {
  VITE_AWS_REGION: "us-east-1",
  VITE_COGNITO_USER_POOL_ID: "us-east-1_EhRxu4W91",
  VITE_COGNITO_CLIENT_ID: "1jgm878n71qoe4s2gsurqkrik3",
  VITE_API_BASE_URL: "https://api.binder.la/prod/observability",
};

const publicKeys = Object.keys(validEnv);

describe("parsePublicConfig", () => {
  it("parses the explicit production configuration", () => {
    expect(parsePublicConfig(validEnv)).toEqual({
      region: "us-east-1",
      userPoolId: "us-east-1_EhRxu4W91",
      userPoolClientId: "1jgm878n71qoe4s2gsurqkrik3",
      apiBaseUrl: "https://api.binder.la/prod/observability",
    });
  });

  it("trims public values without mutating the input", () => {
    const env = Object.fromEntries(
      Object.entries(validEnv).map(([key, value]) => [key, ` ${value} `]),
    );
    expect(parsePublicConfig(env)).toEqual(parsePublicConfig(validEnv));
    expect(env.VITE_AWS_REGION).toBe(" us-east-1 ");
  });

  it.each(publicKeys)("rejects a missing %s", (key) => {
    const env: Record<string, unknown> = { ...validEnv };
    delete env[key];
    expect(() => parsePublicConfig(env)).toThrow(key);
  });

  it.each(publicKeys)("rejects empty or non-string %s", (key) => {
    for (const value of ["", " \t\n", null, undefined, 123, true, {}]) {
      expect(() => parsePublicConfig({ ...validEnv, [key]: value })).toThrow(key);
    }
  });

  it("does not fall back to backend environment names", () => {
    expect(() =>
      parsePublicConfig({
        AWS_REGION: validEnv.VITE_AWS_REGION,
        COGNITO_USER_POOL_ID: validEnv.VITE_COGNITO_USER_POOL_ID,
        COGNITO_CLIENT_ID: validEnv.VITE_COGNITO_CLIENT_ID,
        API_BASE_URL: validEnv.VITE_API_BASE_URL,
      }),
    ).toThrow("VITE_AWS_REGION");
  });

  it.each(["us-east", "US-EAST-1", "us east 1", "us-east-1_extra"])(
    "rejects malformed region %s",
    (region) => {
      expect(() => parsePublicConfig({ ...validEnv, VITE_AWS_REGION: region })).toThrow(
        "VITE_AWS_REGION",
      );
    },
  );

  it("requires the User Pool region to match", () => {
    expect(() =>
      parsePublicConfig({ ...validEnv, VITE_COGNITO_USER_POOL_ID: "eu-west-1_Abc123" }),
    ).toThrow("must belong to VITE_AWS_REGION");
  });

  it.each(["us-east-1", "us-east-1_", "us-east-1_bad-id", "us-east-1_ab_cd", `us-east-1_${"a".repeat(50)}`])(
    "rejects malformed User Pool %s",
    (userPoolId) => {
      expect(() =>
        parsePublicConfig({ ...validEnv, VITE_COGNITO_USER_POOL_ID: userPoolId }),
      ).toThrow("VITE_COGNITO_USER_POOL_ID");
    },
  );

  it("accepts Cognito client ID characters without requiring a secret", () => {
    expect(
      parsePublicConfig({ ...validEnv, VITE_COGNITO_CLIENT_ID: "Client_123+ABC" })
        .userPoolClientId,
    ).toBe("Client_123+ABC");
  });

  it.each(["client id", "client-id", "client.id", "client/id", "client!", "a".repeat(129)])(
    "rejects invalid client ID %s",
    (userPoolClientId) => {
      expect(() =>
        parsePublicConfig({ ...validEnv, VITE_COGNITO_CLIENT_ID: userPoolClientId }),
      ).toThrow("VITE_COGNITO_CLIENT_ID");
    },
  );

  it.each([
    ["/observability-api", "/observability-api"],
    ["/observability-api/", "/observability-api"],
    ["https://api.binder.la/prod/observability/", "https://api.binder.la/prod/observability"],
    ["https://api.example.com/", "https://api.example.com"],
    ["https://api.example.com:8443/v1///", "https://api.example.com:8443/v1"],
    ["https://api.example.com/@v1", "https://api.example.com/@v1"],
  ])("accepts and normalizes API base %s", (value, expected) => {
    expect(parsePublicConfig({ ...validEnv, VITE_API_BASE_URL: value }).apiBaseUrl).toBe(
      expected,
    );
  });

  it.each([
    "http://api.binder.la/prod/observability",
    "http://localhost:3000",
    "ftp://api.example.com",
    "https:api.example.com",
    "https:///api.example.com",
    "https://",
    "https://user:password@api.example.com",
    "https://user@api.example.com",
    "https://@api.example.com",
    "https://api.example.com/path?key=value",
    "https://api.example.com/path?",
    "https://api.example.com/path#fragment",
    "https://api.example.com/path#",
    "https://api.example.com/path\\other",
    "https://api.example.com/line\nbreak",
    "//api.example.com",
    "/other-api",
    "/observability-api-evil",
    "/observability-api/nested",
    "/observability-api?query=1",
    "/observability-api#fragment",
    "/observability-api//",
  ])("rejects unsafe or unsupported API base %s", (apiBaseUrl) => {
    expect(() =>
      parsePublicConfig({ ...validEnv, VITE_API_BASE_URL: apiBaseUrl }),
    ).toThrow("VITE_API_BASE_URL");
  });
});
