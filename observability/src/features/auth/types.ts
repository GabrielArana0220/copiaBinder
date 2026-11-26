/** Identity metadata only; never an authorization decision for the backend. */
export interface AuthUser {
  readonly subject: string;
  readonly username: string;
  readonly email?: string;
}

/** Session metadata, not a token store or proof of backend permissions. */
export interface AuthSession {
  readonly user: AuthUser;
  /** Access-token expiration as Unix epoch seconds. */
  readonly expiresAtEpochSeconds: number;
}
