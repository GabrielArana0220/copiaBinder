// @vitest-environment happy-dom
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../src/features/auth/AuthProvider";
import type { AuthContextValue } from "../src/features/auth/AuthProvider";
import type { AuthService, SignInResult } from "../src/features/auth/cognito";
import type { AuthSession } from "../src/features/auth/types";

const session: AuthSession = {
  user: { subject: "fixture-subject", username: "fixture-user", email: "fixture@example.test" },
  expiresAtEpochSeconds: 4_000_000_000,
};
const signedIn: SignInResult = { step: "signedIn", session };
const challenge: SignInResult = { step: "newPasswordRequired", requiredAttributes: ["email"] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function createService() {
  return {
    restoreSession: vi.fn<AuthService["restoreSession"]>().mockResolvedValue(null),
    signIn: vi.fn<AuthService["signIn"]>().mockResolvedValue(signedIn),
    completeNewPassword: vi.fn<AuthService["completeNewPassword"]>().mockResolvedValue(signedIn),
    signOut: vi.fn<AuthService["signOut"]>().mockResolvedValue(undefined),
    getAccessToken: vi.fn<AuthService["getAccessToken"]>().mockResolvedValue("fixture-access-token"),
  };
}
let auth: AuthContextValue;
function Probe() {
  auth = useAuth();
  return <>
    <div data-testid="status">{auth.status}</div>
    <div data-testid="user">{JSON.stringify(auth.user)}</div>
    <div data-testid="attributes">{JSON.stringify(auth.requiredAttributes)}</div>
    <div data-testid="error">{auth.error}</div>
    <div data-testid="submitting">{String(auth.isSubmitting)}</div>
  </>;
}
function setup(service = createService()) {
  const view = render(<AuthProvider service={service}><Probe /></AuthProvider>);
  return { service, ...view };
}
async function ready() {
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedOut"));
}
async function login() {
  await act(async () => { await auth.signIn("fixture-user", "fixture-password"); });
}
afterEach(() => { cleanup(); });

describe("AuthProvider", () => {
  it("shows no identity/data before login and performs no API queries", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const service = createService();
    const restore = deferred<AuthSession | null>();
    service.restoreSession.mockReturnValue(restore.promise);
    setup(service);
    expect(auth.status).toBe("checking");
    expect(auth.user).toBeNull();
    expect(auth.requiredAttributes).toEqual([]);
    expect(service.getAccessToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () => { restore.resolve(null); });
    await ready();
    expect(auth.user).toBeNull();
    expect(service.signIn).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exposes only metadata after login, with stable token/logout callbacks", async () => {
    const { service } = setup();
    await ready();
    const getAccessToken = auth.getAccessToken;
    const signOut = auth.signOut;
    await login();
    expect(auth.status).toBe("signedIn");
    expect(auth.user).toEqual(session.user);
    expect(auth.getAccessToken).toBe(getAccessToken);
    expect(auth.signOut).toBe(signOut);
    expect(JSON.stringify(auth)).not.toMatch(/fixture-password|fixture-access-token|fixture-id-token/);
    expect(service.signIn).toHaveBeenCalledWith("fixture-user", "fixture-password");
    expect(service.getAccessToken).not.toHaveBeenCalled();
    await expect(auth.getAccessToken()).resolves.toBe("fixture-access-token");
    expect(JSON.stringify(auth)).not.toContain("fixture-access-token");
  });

  it("restores valid metadata without fetching an API", async () => {
    const service = createService();
    service.restoreSession.mockResolvedValue(session);
    setup(service);
    await waitFor(() => expect(auth.status).toBe("signedIn"));
    expect(auth.user).toEqual(session.user);
    expect(service.getAccessToken).not.toHaveBeenCalled();
  });

  it("maps restore failure to a safe signed-out message", async () => {
    const service = createService();
    service.restoreSession.mockRejectedValue(new Error("raw sensitive fixture"));
    setup(service);
    await ready();
    expect(auth.user).toBeNull();
    expect(auth.error).toContain("Tu sesión");
    expect(auth.error).not.toContain("raw sensitive fixture");
  });

  it.each(["UserNotFoundException", "NotAuthorizedException"])(
    "handles %s in state without rejecting to the UI or exposing account details",
    async (name) => {
      const { service } = setup();
      await ready();
      service.signIn.mockRejectedValue({ name, message: "raw account details" });
      await act(async () => {
        await expect(auth.signIn("fixture-user", "fixture-password")).resolves.toBeUndefined();
      });
      expect(auth.status).toBe("signedOut");
      expect(auth.user).toBeNull();
      expect(auth.isSubmitting).toBe(false);
      expect(auth.error).toBe("No se pudo iniciar sesión. Revisa tu usuario y contraseña.");
      act(() => { auth.clearError(); });
      expect(auth.error).toBeNull();
    },
  );

  it("supports a required-password challenge, attributes, and successful confirmation", async () => {
    const { service } = setup();
    await ready();
    service.signIn.mockResolvedValue(challenge);
    await login();
    expect(auth.status).toBe("newPasswordRequired");
    expect(auth.user).toBeNull();
    expect(auth.requiredAttributes).toEqual(["email"]);
    const attributes = { email: "fixture@example.test" };
    await act(async () => { await auth.completeNewPassword("fixture-new-password", attributes); });
    expect(service.completeNewPassword).toHaveBeenCalledWith("fixture-new-password", attributes);
    expect(auth.status).toBe("signedIn");
    expect(auth.requiredAttributes).toEqual([]);
    expect(auth.user).toEqual(session.user);
  });

  it("keeps a correctable password error in challenge state and never rejects to UI", async () => {
    const { service } = setup();
    await ready();
    service.signIn.mockResolvedValue(challenge);
    service.completeNewPassword.mockRejectedValue({ name: "InvalidPasswordException", message: "raw policy details" });
    await login();
    await act(async () => { await expect(auth.completeNewPassword("fixture-password")).resolves.toBeUndefined(); });
    expect(auth.status).toBe("newPasswordRequired");
    expect(auth.isSubmitting).toBe(false);
    expect(auth.error).toContain("La nueva contraseña");
    expect(auth.error).not.toContain("raw policy details");
  });

  it("cancels challenges and ignores a late confirmation", async () => {
    const { service } = setup();
    await ready();
    service.signIn.mockResolvedValue(challenge);
    await login();
    const confirmation = deferred<SignInResult>();
    service.completeNewPassword.mockReturnValue(confirmation.promise);
    let pending!: Promise<void>;
    act(() => { pending = auth.completeNewPassword("fixture-new-password"); });
    expect(auth.isSubmitting).toBe(true);
    await act(async () => { await auth.cancelChallenge(); });
    expect(auth.status).toBe("signedOut");
    expect(auth.requiredAttributes).toEqual([]);
    await act(async () => { confirmation.resolve(signedIn); await pending; });
    expect(auth.status).toBe("signedOut");
    expect(auth.user).toBeNull();
    expect(service.signOut).toHaveBeenCalledOnce();
  });

  it("does not resurrect a late restore after logout", async () => {
    const service = createService();
    const restore = deferred<AuthSession | null>();
    service.restoreSession.mockReturnValue(restore.promise);
    setup(service);
    await act(async () => { await auth.signOut(); });
    await act(async () => { restore.resolve(session); });
    expect(auth.status).toBe("signedOut");
    expect(auth.user).toBeNull();
    expect(auth.error).toBeNull();
  });

  it("does not resurrect a late login after logout", async () => {
    const { service } = setup();
    await ready();
    const response = deferred<SignInResult>();
    service.signIn.mockReturnValue(response.promise);
    let pending!: Promise<void>;
    act(() => { pending = auth.signIn("fixture-user", "fixture-password"); });
    expect(auth.isSubmitting).toBe(true);
    await act(async () => { await auth.signOut(); });
    await act(async () => { response.resolve(signedIn); await pending; });
    expect(auth.status).toBe("signedOut");
    expect(auth.user).toBeNull();
    expect(auth.isSubmitting).toBe(false);
  });

  it("ignores an earlier restore after an explicit login", async () => {
    const service = createService();
    const restore = deferred<AuthSession | null>();
    service.restoreSession.mockReturnValue(restore.promise);
    setup(service);
    await login();
    await act(async () => { restore.resolve(null); });
    expect(auth.status).toBe("signedIn");
    expect(auth.user).toEqual(session.user);
  });

  it("logout keeps UI signed out even if the SDK/service fails", async () => {
    const { service } = setup();
    await ready();
    await login();
    service.signOut.mockRejectedValue(new Error("raw logout details"));
    await act(async () => { await expect(auth.signOut()).resolves.toBeUndefined(); });
    expect(auth.status).toBe("signedOut");
    expect(auth.user).toBeNull();
    expect(auth.error).toContain("La sesión local se cerró");
    expect(auth.error).not.toContain("raw logout details");
  });

  it("invalidates UI immediately while SDK logout is still pending", async () => {
    const { service } = setup();
    await ready();
    await login();
    const response = deferred<void>();
    service.signOut.mockReturnValue(response.promise);
    let logout!: Promise<void>;
    act(() => { logout = auth.signOut(); });
    expect(auth.status).toBe("signedOut");
    expect(auth.user).toBeNull();
    expect(auth.requiredAttributes).toEqual([]);
    await act(async () => { response.resolve(); await logout; });
    expect(auth.status).toBe("signedOut");
  });

  it("invalid token/refresh rejects to API and invalidates the UI safely", async () => {
    const { service } = setup();
    await ready();
    await login();
    service.getAccessToken.mockRejectedValue({ name: "NotAuthorizedException", message: "raw token fixture" });
    await act(async () => { await expect(auth.getAccessToken()).rejects.toThrow("Tu sesión"); });
    expect(auth.status).toBe("signedOut");
    expect(auth.user).toBeNull();
    expect(auth.error).toContain("Tu sesión");
    expect(auth.error).not.toContain("raw token fixture");
    expect(service.signOut).toHaveBeenCalledOnce();
  });

  it("rejects a late token after logout without returning it or overwriting the UI", async () => {
    const { service } = setup();
    await ready();
    await login();
    const response = deferred<string>();
    service.getAccessToken.mockReturnValue(response.promise);
    const pending = auth.getAccessToken();
    const rejected = expect(pending).rejects.toThrow("Tu sesión");
    await act(async () => { await auth.signOut(); });
    await act(async () => { response.resolve("fixture-late-access-token"); await rejected; });
    expect(auth.status).toBe("signedOut");
    expect(auth.user).toBeNull();
    expect(auth.error).toBeNull();
  });

  it("does not return a token while signed out", async () => {
    const { service } = setup();
    await ready();
    await act(async () => { await expect(auth.getAccessToken()).rejects.toThrow("Tu sesión"); });
    expect(service.getAccessToken).not.toHaveBeenCalled();
    expect(auth.user).toBeNull();
  });

  it("ignores late login on unmount and clears the service", async () => {
    const { service, unmount } = setup();
    await ready();
    const response = deferred<SignInResult>();
    service.signIn.mockReturnValue(response.promise);
    let pending!: Promise<void>;
    act(() => { pending = auth.signIn("fixture-user", "fixture-password"); });
    unmount();
    await act(async () => { response.resolve(signedIn); await pending; });
    expect(service.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("user")).toBeNull();
  });

  it("is safe under StrictMode effect replay without logging out a restored session", async () => {
    const service = createService();
    service.restoreSession.mockResolvedValue(session);
    render(<StrictMode><AuthProvider service={service}><Probe /></AuthProvider></StrictMode>);
    await waitFor(() => expect(auth.status).toBe("signedIn"));
    expect(auth.user).toEqual(session.user);
    expect(service.restoreSession).toHaveBeenCalledTimes(2);
    expect(service.signOut).not.toHaveBeenCalled();
  });
});
