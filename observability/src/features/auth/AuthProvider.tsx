import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { AuthService, SignInResult } from "./cognito";
import { AuthFailure, safeAuthFailure } from "./errors";
import type { AuthUser } from "./types";

export interface AuthContextValue {
  status: "checking" | "signedOut" | "newPasswordRequired" | "signedIn";
  user: AuthUser | null;
  requiredAttributes: string[];
  isSubmitting: boolean;
  error: string | null;
  signIn(username: string, password: string): Promise<void>;
  completeNewPassword(password: string, attributes?: Record<string, string>): Promise<void>;
  signOut(): Promise<void>;
  cancelChallenge(): Promise<void>;
  getAccessToken(): Promise<string>;
  clearError(): void;
}

type AuthState = Pick<AuthContextValue, "status" | "user" | "requiredAttributes" | "isSubmitting" | "error">;
const signedOut: AuthState = {
  status: "signedOut",
  user: null,
  requiredAttributes: [],
  isSubmitting: false,
  error: null,
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ service, children }: { service: AuthService; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...signedOut, status: "checking" });
  const stateRef = useRef(state);
  const generation = useRef(0);
  const mounted = useRef(false);
  const activeService = useRef(service);

  const commit = useCallback((next: AuthState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const isCurrent = useCallback((expected: number) => mounted.current && generation.current === expected, []);

  useEffect(() => {
    mounted.current = true;
    activeService.current = service;
    const expected = ++generation.current;
    commit({ ...signedOut, status: "checking" });
    void service.restoreSession().then(
      (session) => {
        if (!isCurrent(expected)) return;
        commit(session ? { ...signedOut, status: "signedIn", user: session.user } : { ...signedOut });
      },
      (error: unknown) => {
        if (!isCurrent(expected)) return;
        commit({ ...signedOut, error: safeAuthFailure(error, "session").message });
      },
    );
    return () => {
      mounted.current = false;
      ++generation.current;
      // React StrictMode immediately replays setup. Defer cleanup by one
      // microtask so that replay does not destroy an existing in-memory session.
      queueMicrotask(() => {
        if (!mounted.current || activeService.current !== service) {
          void service.signOut().catch(() => undefined);
        }
      });
    };
  }, [service, commit, isCurrent]);

  const applyResult = useCallback((result: SignInResult) => {
    commit(result.step === "signedIn"
      ? { ...signedOut, status: "signedIn", user: result.session.user }
      : { ...signedOut, status: "newPasswordRequired", requiredAttributes: [...result.requiredAttributes] });
  }, [commit]);

  const signIn = useCallback(async (username: string, password: string): Promise<void> => {
    if (!mounted.current || stateRef.current.isSubmitting) return;
    const expected = ++generation.current;
    commit({ ...signedOut, isSubmitting: true });
    try {
      const result = await service.signIn(username, password);
      if (isCurrent(expected)) applyResult(result);
    } catch (error) {
      if (isCurrent(expected)) commit({ ...signedOut, error: safeAuthFailure(error, "signIn").message });
    }
  }, [service, commit, isCurrent, applyResult]);

  const completeNewPassword = useCallback(async (
    password: string,
    attributes?: Record<string, string>,
  ): Promise<void> => {
    if (!mounted.current || stateRef.current.isSubmitting || stateRef.current.status !== "newPasswordRequired") return;
    const expected = ++generation.current;
    const challenge = stateRef.current;
    commit({ ...challenge, isSubmitting: true, error: null });
    try {
      const result = await service.completeNewPassword(password, attributes);
      if (isCurrent(expected)) applyResult(result);
    } catch (error) {
      if (!isCurrent(expected)) return;
      const failure = safeAuthFailure(error, "newPassword");
      commit(failure.code === "newPassword"
        ? { ...challenge, isSubmitting: false, error: failure.message }
        : { ...signedOut, error: failure.message });
    }
  }, [service, commit, isCurrent, applyResult]);

  const signOut = useCallback(async (): Promise<void> => {
    const expected = ++generation.current;
    if (mounted.current) commit({ ...signedOut });
    try {
      await service.signOut();
    } catch (error) {
      if (isCurrent(expected)) commit({ ...signedOut, error: safeAuthFailure(error, "signOut").message });
    }
  }, [service, commit, isCurrent]);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const expected = generation.current;
    try {
      if (!mounted.current || stateRef.current.status !== "signedIn") throw new AuthFailure("session");
      const token = await service.getAccessToken();
      if (!isCurrent(expected) || stateRef.current.status !== "signedIn") throw new AuthFailure("session");
      if (!token || /\s/u.test(token)) throw new AuthFailure("session");
      // Tokens are returned directly to the caller, never put in React state.
      return token;
    } catch {
      const failure = new AuthFailure("session");
      if (isCurrent(expected)) {
        ++generation.current;
        commit({ ...signedOut, error: failure.message });
        // Invalidate pending SDK refreshes and remove local challenge/token state.
        void service.signOut().catch(() => undefined);
      }
      throw failure;
    }
  }, [service, commit, isCurrent]);

  const clearError = useCallback(() => {
    if (mounted.current) commit({ ...stateRef.current, error: null });
  }, [commit]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    signIn,
    completeNewPassword,
    signOut,
    cancelChallenge: signOut,
    getAccessToken,
    clearError,
  }), [state, signIn, completeNewPassword, signOut, getAccessToken, clearError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe utilizarse dentro de AuthProvider.");
  return context;
}
