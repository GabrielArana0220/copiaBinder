// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCognitoAuth } from "../src/features/auth/cognito";
import { MemoryTokenStorage } from "../src/features/auth/memory-storage";

const sdk = vi.hoisted(() => ({
  configure: vi.fn(),
  setKeyValueStorage: vi.fn(),
  signIn: vi.fn(),
  confirmSignIn: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchAuthSession: vi.fn(),
}));
vi.mock("aws-amplify", () => ({ Amplify: { configure: sdk.configure } }));
vi.mock("aws-amplify/auth", () => ({
  signIn: sdk.signIn,
  confirmSignIn: sdk.confirmSignIn,
  signOut: sdk.signOut,
  getCurrentUser: sdk.getCurrentUser,
  fetchAuthSession: sdk.fetchAuthSession,
}));
vi.mock("aws-amplify/auth/cognito", () => ({
  cognitoUserPoolsTokenProvider: { setKeyValueStorage: sdk.setKeyValueStorage },
}));

const config = {
  region: "us-east-1",
  userPoolId: "us-east-1_UnitTests",
  userPoolClientId: "unitTestPublicClient",
  apiBaseUrl: "https://api.example.test/observability",
};
const done = { isSignedIn: true, nextStep: { signInStep: "DONE" } };
const challenge = {
  isSignedIn: false,
  nextStep: {
    signInStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED",
    missingAttributes: ["email", "name"],
  },
};
// Synthetic tokens exist only as test fixtures; no AWS or network is used.
function token(value = "fixture-access-token", claims: Record<string, unknown> = {}) {
  return {
    payload: { token_use: "access", sub: "fixture-subject", exp: Math.floor(Date.now() / 1000) + 3600, ...claims },
    toString: () => value,
  };
}
function tokens(accessToken = token()) {
  return { tokens: { accessToken, idToken: { toString: () => "fixture-id-token-NEVER-USE" } } };
}
function capturedStorage(): MemoryTokenStorage {
  return sdk.setKeyValueStorage.mock.calls[0]?.[0] as MemoryTokenStorage;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  sdk.signOut.mockResolvedValue(undefined);
  sdk.getCurrentUser.mockResolvedValue({ userId: "fixture-subject", username: "fixture-user" });
  sdk.fetchAuthSession.mockResolvedValue(tokens());
  sdk.signIn.mockResolvedValue(done);
  sdk.confirmSignIn.mockResolvedValue(done);
});

describe("Cognito SRP auth service", () => {
  it("configures a public User Pool without OAuth and installs memory before authentication", () => {
    createCognitoAuth(config);
    expect(sdk.configure).toHaveBeenCalledExactlyOnceWith({
      Auth: { Cognito: { userPoolId: config.userPoolId, userPoolClientId: config.userPoolClientId } },
    });
    expect(capturedStorage()).toBeInstanceOf(MemoryTokenStorage);
    expect(sdk.setKeyValueStorage.mock.invocationCallOrder[0]).toBeGreaterThan(sdk.configure.mock.invocationCallOrder[0]!);
    expect(sdk.signIn).not.toHaveBeenCalled();
    expect(sdk.fetchAuthSession).not.toHaveBeenCalled();
  });

  it("overrides the SDK default-storage reset before any authentication begins", async () => {
    sdk.configure.mockImplementationOnce(() => {
      sdk.setKeyValueStorage({ fixturePersistentDefault: true });
    });
    const auth = createCognitoAuth(config);
    expect(sdk.setKeyValueStorage).toHaveBeenLastCalledWith(expect.any(MemoryTokenStorage));
    expect(sdk.signIn).not.toHaveBeenCalled();
    expect(sdk.getCurrentUser).not.toHaveBeenCalled();
    expect(sdk.fetchAuthSession).not.toHaveBeenCalled();
    await auth.signIn("fixture-user", "fixture-password");
    expect(sdk.setKeyValueStorage.mock.invocationCallOrder.at(-1)).toBeLessThan(sdk.signIn.mock.invocationCallOrder[0]!);
  });

  it("uses USER_SRP_AUTH and returns identity metadata, never a JWT or password", async () => {
    const auth = createCognitoAuth(config);
    sdk.fetchAuthSession.mockResolvedValue(tokens(token("fixture-access-token", { email: "fixture@example.test" })));
    const result = await auth.signIn(" fixture-user ", "fixture-password");
    expect(sdk.signIn).toHaveBeenCalledExactlyOnceWith({
      username: "fixture-user",
      password: "fixture-password",
      options: { authFlowType: "USER_SRP_AUTH" },
    });
    expect(result).toEqual({
      step: "signedIn",
      session: {
        user: { subject: "fixture-subject", username: "fixture-user", email: "fixture@example.test" },
        expiresAtEpochSeconds: expect.any(Number),
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture-access-token|fixture-id-token|fixture-password/);
    expect(sdk.getCurrentUser).toHaveBeenCalledOnce();
  });

  it("restores a valid in-memory session via getCurrentUser and fetchAuthSession", async () => {
    const auth = createCognitoAuth(config);
    await expect(auth.restoreSession()).resolves.toMatchObject({ user: { subject: "fixture-subject" } });
    expect(sdk.getCurrentUser).toHaveBeenCalledOnce();
    expect(sdk.fetchAuthSession).toHaveBeenCalledOnce();
  });

  it("returns null for no session and clears local state even when SDK cleanup fails", async () => {
    const auth = createCognitoAuth(config);
    await capturedStorage().setItem("fixture-refresh", "fixture-refresh-value");
    sdk.getCurrentUser.mockRejectedValue({ name: "UserUnAuthenticatedException", message: "raw fixture error" });
    sdk.signOut.mockRejectedValue(new Error("raw fixture failure"));
    await expect(auth.restoreSession()).resolves.toBeNull();
    expect(await capturedStorage().getItem("fixture-refresh")).toBeNull();
    expect(sdk.fetchAuthSession).not.toHaveBeenCalled();
  });

  it("returns NEW_PASSWORD_REQUIRED missing attributes and confirms them with the SDK", async () => {
    const auth = createCognitoAuth(config);
    sdk.signIn.mockResolvedValue(challenge);
    await expect(auth.signIn("fixture-user", "temporary-fixture-password")).resolves.toEqual({
      step: "newPasswordRequired", requiredAttributes: ["email", "name"],
    });
    expect(sdk.fetchAuthSession).not.toHaveBeenCalled();
    const attributes = { email: "fixture@example.test", name: "Fixture" };
    await expect(auth.completeNewPassword("new-fixture-password", attributes)).resolves.toMatchObject({ step: "signedIn" });
    expect(sdk.confirmSignIn).toHaveBeenCalledExactlyOnceWith({
      challengeResponse: "new-fixture-password", options: { userAttributes: attributes },
    });
  });

  it("supports a password challenge with no missing attributes", async () => {
    const auth = createCognitoAuth(config);
    sdk.signIn.mockResolvedValue({ isSignedIn: false, nextStep: { signInStep: challenge.nextStep.signInStep } });
    await expect(auth.signIn("fixture-user", "fixture-password")).resolves.toEqual({ step: "newPasswordRequired", requiredAttributes: [] });
    await auth.completeNewPassword("new-fixture-password");
    expect(sdk.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: "new-fixture-password", options: { userAttributes: {} } });
  });

  it("allows correction of a rejected new password in the same challenge", async () => {
    const auth = createCognitoAuth(config);
    sdk.signIn.mockResolvedValue(challenge);
    await auth.signIn("fixture-user", "fixture-password");
    sdk.confirmSignIn.mockRejectedValueOnce({ name: "InvalidPasswordException", message: "raw policy detail" });
    await expect(auth.completeNewPassword("bad-fixture-password")).rejects.toThrow("La nueva contraseña");
    await expect(auth.completeNewPassword("better-fixture-password")).resolves.toMatchObject({ step: "signedIn" });
    expect(sdk.signOut).not.toHaveBeenCalled();
  });

  it("rejects password confirmation without an active challenge", async () => {
    const auth = createCognitoAuth(config);
    await expect(auth.completeNewPassword("fixture-password")).rejects.toThrow("Tu sesión");
    expect(sdk.confirmSignIn).not.toHaveBeenCalled();
  });

  it.each(["RESET_PASSWORD", "CONFIRM_SIGN_IN_WITH_TOTP_CODE", "CONFIRM_SIGN_UP"])(
    "does not authenticate an unsupported step %s and discards tokens",
    async (signInStep) => {
      const auth = createCognitoAuth(config);
      await capturedStorage().setItem("fixture-token", "fixture-value");
      sdk.signIn.mockResolvedValue({ isSignedIn: false, nextStep: { signInStep } });
      await expect(auth.signIn("fixture-user", "fixture-password")).rejects.toThrow("paso no compatible");
      expect(sdk.fetchAuthSession).not.toHaveBeenCalled();
      expect(sdk.signOut).toHaveBeenCalledOnce();
      expect(await capturedStorage().getItem("fixture-token")).toBeNull();
    },
  );

  it.each(["UserNotFoundException", "NotAuthorizedException"])(
    "maps %s to the same Spanish message without leaking raw errors",
    async (name) => {
      const auth = createCognitoAuth(config);
      sdk.signIn.mockRejectedValue({ name, message: "raw account/credential fixture details" });
      await expect(auth.signIn("fixture-user", "fixture-password")).rejects.toThrow(
        "No se pudo iniciar sesión. Revisa tu usuario y contraseña.",
      );
    },
  );

  it("requests the access token on every call, allowing SDK renewal and never choosing ID", async () => {
    const auth = createCognitoAuth(config);
    sdk.fetchAuthSession.mockResolvedValueOnce(tokens(token("fixture-first-access")))
      .mockResolvedValueOnce(tokens(token("fixture-renewed-access")));
    await expect(auth.getAccessToken()).resolves.toBe("fixture-first-access");
    await expect(auth.getAccessToken()).resolves.toBe("fixture-renewed-access");
    expect(sdk.fetchAuthSession).toHaveBeenCalledTimes(2);
    expect(sdk.fetchAuthSession).toHaveBeenNthCalledWith(1);
    expect(sdk.fetchAuthSession).toHaveBeenNthCalledWith(2);
  });

  it.each([
    { tokens: undefined },
    { tokens: { idToken: token("fixture-id-only", { token_use: "id" }) } },
    tokens(token("fixture-wrong-use", { token_use: "id" })),
    tokens(token("fixture-expired", { exp: 1 })),
    tokens(token("fixture-no-expiry", { exp: undefined })),
  ])("fails closed for invalid/missing access tokens and clears memory (%j)", async (session) => {
    const auth = createCognitoAuth(config);
    await capturedStorage().setItem("fixture-refresh", "fixture-refresh-value");
    sdk.fetchAuthSession.mockResolvedValue(session);
    await expect(auth.getAccessToken()).rejects.toThrow("Tu sesión");
    expect(await capturedStorage().getItem("fixture-refresh")).toBeNull();
    expect(sdk.signOut).toHaveBeenCalledOnce();
  });

  it("invalid refresh errors are safe and clear local tokens", async () => {
    const auth = createCognitoAuth(config);
    await capturedStorage().setItem("fixture-refresh", "fixture-refresh-value");
    sdk.fetchAuthSession.mockRejectedValue({ name: "NotAuthorizedException", message: "raw refresh token fixture" });
    await expect(auth.getAccessToken()).rejects.toThrow("Tu sesión");
    expect(await capturedStorage().getItem("fixture-refresh")).toBeNull();
  });

  it.each([false, true])("lets SDK logout read/revoke refresh before clearing memory (SDK failure=%s)", async (fails) => {
    const auth = createCognitoAuth(config);
    const started = deferred<void>();
    const finish = deferred<void>();
    await capturedStorage().setItem("fixture-refresh", "fixture-refresh-value");
    sdk.signOut.mockImplementation(async () => {
      expect(await capturedStorage().getItem("fixture-refresh")).toBe("fixture-refresh-value");
      started.resolve();
      await finish.promise;
      if (fails) throw new Error("raw service fixture failure");
    });
    const logout = auth.signOut();
    const outcome = fails
      ? expect(logout).rejects.toThrow("La sesión local se cerró.")
      : expect(logout).resolves.toBeUndefined();
    await started.promise;
    expect(await capturedStorage().getItem("fixture-refresh")).toBe("fixture-refresh-value");
    finish.resolve();
    await outcome;
    expect(await capturedStorage().getItem("fixture-refresh")).toBeNull();
  });

  it.each([false, true])("invalid-session cleanup preserves refresh for SDK logout then clears (SDK failure=%s)", async (fails) => {
    const auth = createCognitoAuth(config);
    await capturedStorage().setItem("fixture-refresh", "fixture-refresh-value");
    sdk.fetchAuthSession.mockRejectedValue({ name: "NotAuthorizedException", message: "raw refresh fixture" });
    let observedRefresh: string | null | undefined;
    sdk.signOut.mockImplementation(async () => {
      observedRefresh = await capturedStorage().getItem("fixture-refresh");
      if (fails) throw new Error("raw logout fixture");
    });
    await expect(auth.getAccessToken()).rejects.toThrow("Tu sesión");
    expect(sdk.signOut).toHaveBeenCalledOnce();
    expect(observedRefresh).toBe("fixture-refresh-value");
    expect(await capturedStorage().getItem("fixture-refresh")).toBeNull();
  });

  it("prevents a late login from restoring tokens after logout", async () => {
    const auth = createCognitoAuth(config);
    const started = deferred<void>();
    const response = deferred<typeof done>();
    sdk.signIn.mockImplementation(async () => {
      started.resolve();
      const result = await response.promise;
      await capturedStorage().setItem("fixture-late-token", "fixture-late-value");
      return result;
    });
    const login = auth.signIn("fixture-user", "fixture-password");
    const rejected = expect(login).rejects.toThrow("Tu sesión");
    await started.promise;
    const logout = auth.signOut();
    response.resolve(done);
    await rejected;
    await logout;
    expect(await capturedStorage().getItem("fixture-late-token")).toBeNull();
    expect(sdk.getCurrentUser).not.toHaveBeenCalled();
  });

  it("cleans only SDK challenge persistence after configuration and each auth step", async () => {
    sessionStorage.setItem("unrelated.fixture", "keep-fixture");
    sessionStorage.setItem("CognitoSignInState.signInSession", "fixture-stale-challenge");
    const auth = createCognitoAuth(config);
    expect(sessionStorage.getItem("CognitoSignInState.signInSession")).toBeNull();
    sdk.signIn.mockImplementation(async () => {
      sessionStorage.setItem("CognitoSignInState.username", "fixture-user");
      sessionStorage.setItem("CognitoSignInState.signInSession", "fixture-new-challenge");
      return challenge;
    });
    await auth.signIn("fixture-user", "fixture-password");
    expect(sessionStorage.getItem("CognitoSignInState.username")).toBeNull();
    expect(sessionStorage.getItem("CognitoSignInState.signInSession")).toBeNull();
    expect(sessionStorage.getItem("unrelated.fixture")).toBe("keep-fixture");
    sessionStorage.removeItem("unrelated.fixture");
  });

  it("discards an expired password challenge rather than leaving a resumable UI session", async () => {
    const auth = createCognitoAuth(config);
    sdk.signIn.mockResolvedValue(challenge);
    await auth.signIn("fixture-user", "fixture-password");
    sdk.confirmSignIn.mockRejectedValue({ name: "NotAuthorizedException", message: "raw expired fixture" });
    await expect(auth.completeNewPassword("fixture-new-password")).rejects.toThrow("Tu sesión");
    sdk.confirmSignIn.mockClear();
    await expect(auth.completeNewPassword("fixture-new-password")).rejects.toThrow("Tu sesión");
    expect(sdk.confirmSignIn).not.toHaveBeenCalled();
  });

  it("fails closed if confirmation returns an unexpected follow-up challenge", async () => {
    const auth = createCognitoAuth(config);
    sdk.signIn.mockResolvedValue(challenge);
    await auth.signIn("fixture-user", "fixture-password");
    sdk.confirmSignIn.mockResolvedValue({ isSignedIn: false, nextStep: { signInStep: "CONTINUE_SIGN_IN_WITH_TOTP_SETUP" } });
    await expect(auth.completeNewPassword("fixture-new-password")).rejects.toThrow("paso no compatible");
    expect(sdk.fetchAuthSession).not.toHaveBeenCalled();
    expect(sdk.signOut).toHaveBeenCalled();
  });

  it("serializes a replacement login after logout so old cleanup cannot erase it", async () => {
    const auth = createCognitoAuth(config);
    const started = deferred<void>();
    const response = deferred<typeof done>();
    sdk.signIn.mockImplementationOnce(async () => { started.resolve(); return response.promise; });
    const first = auth.signIn("fixture-first-user", "fixture-first-password");
    const rejected = expect(first).rejects.toThrow("Tu sesión");
    await started.promise;
    const logout = auth.signOut();
    sdk.signIn.mockImplementationOnce(async () => {
      await capturedStorage().setItem("fixture-current-token", "fixture-current-value");
      return done;
    });
    const next = auth.signIn("fixture-next-user", "fixture-next-password");
    response.resolve(done);
    await rejected;
    await logout;
    await expect(next).resolves.toMatchObject({ step: "signedIn" });
    expect(await capturedStorage().getItem("fixture-current-token")).toBe("fixture-current-value");
  });

  it("prevents a late restore/refresh from restoring tokens after logout", async () => {
    const auth = createCognitoAuth(config);
    const started = deferred<void>();
    const response = deferred<ReturnType<typeof tokens>>();
    sdk.fetchAuthSession.mockImplementation(async () => {
      started.resolve();
      const result = await response.promise;
      await capturedStorage().setItem("fixture-late-refresh", "fixture-late-value");
      return result;
    });
    const restore = auth.restoreSession();
    await started.promise;
    const logout = auth.signOut();
    response.resolve(tokens());
    await expect(restore).resolves.toBeNull();
    await logout;
    expect(await capturedStorage().getItem("fixture-late-refresh")).toBeNull();
  });
});
