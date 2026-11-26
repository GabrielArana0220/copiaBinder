import { Amplify } from "aws-amplify";
import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  signIn as cognitoSignIn,
  signOut as cognitoSignOut,
} from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import type { PublicAppConfig } from "../../config/env";
import { AuthFailure, errorName, safeAuthFailure } from "./errors";
import { MemoryTokenStorage } from "./memory-storage";
import type { AuthSession } from "./types";

export type SignInResult =
  | { step: "signedIn"; session: AuthSession }
  | { step: "newPasswordRequired"; requiredAttributes: string[] };

export interface AuthService {
  restoreSession(): Promise<AuthSession | null>;
  signIn(username: string, password: string): Promise<SignInResult>;
  completeNewPassword(password: string, attributes?: Record<string, string>): Promise<SignInResult>;
  signOut(): Promise<void>;
  getAccessToken(): Promise<string>;
}

// Amplify 6.22.2 persists opaque challenge state separately from its token
// provider. Remove only its challenge keys; JWT/refresh storage is always a Map.
function clearPersistedChallenge(): void {
  try {
    for (const key of ["username", "challengeName", "signInSession", "expiry"]) {
      globalThis.sessionStorage?.removeItem(`CognitoSignInState.${key}`);
    }
  } catch {
    // Browser persistence may be unavailable; authentication needs no such store.
  }
}

/**
 * One application-level instance: Amplify's Cognito provider is a singleton.
 * Configure only a public User Pool client, without OAuth or a client secret.
 */
export function createCognitoAuth(config: PublicAppConfig): AuthService {
  const storage = new MemoryTokenStorage();
  clearPersistedChallenge();
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
      },
    },
  });
  // configure() resets singleton storage in Amplify 6.22.2. Override it AFTER
  // configure, synchronously before any getCurrentUser/restore/sign-in call.
  cognitoUserPoolsTokenProvider.setKeyValueStorage(storage);

  let generation = 0;
  let newPasswordPending = false;
  let queue: Promise<unknown> = Promise.resolve();

  // Serialize SDK work: a late refresh/sign-in must finish and be cleared before a
  // newer login starts. signOut still invalidates immediately, not when dequeued.
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }

  function assertCurrent(expected: number): void {
    if (generation !== expected) throw new AuthFailure("session");
  }

  async function clearLocalSession(): Promise<void> {
    newPasswordPending = false;
    clearPersistedChallenge();
    try {
      // Preserve the refresh token until the SDK has attempted its revocation.
      // Generation/queue isolation blocks its use by newer auth operations.
      await cognitoSignOut();
    } catch {
      // Local sign-out is authoritative for this browser instance.
    } finally {
      await storage.clear();
    }
  }

  async function discardSession(expected: number): Promise<void> {
    if (generation === expected) ++generation;
    await clearLocalSession();
  }

  async function readAccessToken(expected: number) {
    // Called on EVERY token request; the SDK renews expired tokens as needed.
    const authSession = await fetchAuthSession();
    assertCurrent(expected);
    const accessToken = authSession.tokens?.accessToken;
    const expiresAt = accessToken?.payload.exp;
    if (
      !accessToken ||
      accessToken.payload.token_use !== "access" ||
      typeof expiresAt !== "number" ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() / 1000
    ) {
      throw new AuthFailure("session");
    }
    const value = accessToken.toString();
    if (!value || /\s/u.test(value)) throw new AuthFailure("session");
    return { accessToken, expiresAt, value };
  }

  async function readSession(expected: number): Promise<AuthSession> {
    const currentUser = await getCurrentUser();
    assertCurrent(expected);
    const { accessToken, expiresAt } = await readAccessToken(expected);
    if (!currentUser.userId || !currentUser.username) throw new AuthFailure("session");
    // Identity metadata is not an authorization decision. Never use the ID token.
    const email = accessToken.payload.email;
    return {
      user: {
        subject: currentUser.userId,
        username: currentUser.username,
        ...(typeof email === "string" && email ? { email } : {}),
      },
      expiresAtEpochSeconds: expiresAt,
    };
  }

  async function interpretSignIn(
    result: Awaited<ReturnType<typeof cognitoSignIn>>,
    expected: number,
  ): Promise<SignInResult> {
    assertCurrent(expected);
    if (result.isSignedIn && result.nextStep.signInStep === "DONE") {
      const session = await readSession(expected);
      newPasswordPending = false;
      return { step: "signedIn", session };
    }
    if (
      !result.isSignedIn &&
      result.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
    ) {
      newPasswordPending = true;
      return {
        step: "newPasswordRequired",
        requiredAttributes: [...(result.nextStep.missingAttributes ?? [])],
      };
    }
    // MFA, reset-password, unconfirmed accounts, custom challenges, etc. are not
    // implicitly treated as authenticated and never trigger account mutations.
    throw new AuthFailure("unsupportedChallenge");
  }

  return {
    restoreSession() {
      const expected = generation;
      return enqueue(async () => {
        try {
          assertCurrent(expected);
          return await readSession(expected);
        } catch (error) {
          const wasCancelled = generation !== expected;
          await discardSession(expected);
          if (wasCancelled || errorName(error) === "UserUnAuthenticatedException") {
            return null;
          }
          throw safeAuthFailure(error, "session");
        }
      });
    },

    signIn(username, password) {
      const expected = ++generation;
      newPasswordPending = false;
      return enqueue(async () => {
        try {
          assertCurrent(expected);
          if (!username.trim() || !password) throw new AuthFailure("credentials");
          const result = await cognitoSignIn({
            username: username.trim(),
            password,
            options: { authFlowType: "USER_SRP_AUTH" },
          }).finally(clearPersistedChallenge);
          return await interpretSignIn(result, expected);
        } catch (error) {
          await discardSession(expected);
          throw safeAuthFailure(error, "signIn");
        }
      });
    },

    completeNewPassword(password, attributes) {
      const expected = generation;
      return enqueue(async () => {
        try {
          assertCurrent(expected);
          if (!newPasswordPending) throw new AuthFailure("session");
          if (!password) throw new AuthFailure("newPassword");
          // Amplify infers NEW_PASSWORD_REQUIRED from its active challenge. The
          // required keys come from nextStep.missingAttributes, not error text.
          const result = await confirmSignIn({
            challengeResponse: password,
            options: { userAttributes: attributes ?? {} },
          }).finally(clearPersistedChallenge);
          return await interpretSignIn(result, expected);
        } catch (error) {
          const safeError = safeAuthFailure(error, "newPassword");
          // A password-policy/validation error can be corrected in the same
          // challenge. Unexpected/expired challenges must discard all state.
          const correctable = generation === expected && newPasswordPending && (
            safeError.code === "newPassword" ||
            ["InvalidPasswordException", "PasswordHistoryPolicyViolationException", "InvalidParameterException"].includes(errorName(error))
          );
          if (!correctable) {
            await discardSession(expected);
            throw safeError.code === "unsupportedChallenge" ? safeError : new AuthFailure("session");
          }
          throw safeError;
        }
      });
    },

    signOut() {
      ++generation;
      newPasswordPending = false;
      clearPersistedChallenge();
      // Invalidate immediately, but let the SDK read/revoke the refresh token
      // before the guaranteed Map cleanup. The queue fences newer logins.
      return enqueue(async () => {
        try {
          await cognitoSignOut();
        } catch (error) {
          throw safeAuthFailure(error, "signOut");
        } finally {
          await storage.clear();
        }
      });
    },

    getAccessToken() {
      const expected = generation;
      return enqueue(async () => {
        try {
          assertCurrent(expected);
          const { value } = await readAccessToken(expected);
          return value;
        } catch (error) {
          await discardSession(expected);
          throw safeAuthFailure(error, "session");
        }
      });
    },
  };
}
