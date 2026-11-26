type AuthFailureCode =
  | "credentials"
  | "newPassword"
  | "rateLimit"
  | "network"
  | "unsupportedChallenge"
  | "session"
  | "signOut"
  | "generic";

const messages: Record<AuthFailureCode, string> = {
  credentials: "No se pudo iniciar sesión. Revisa tu usuario y contraseña.",
  newPassword: "La nueva contraseña o los atributos no cumplen los requisitos del servicio.",
  rateLimit: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
  network: "No se pudo conectar con el servicio de autenticación. Inténtalo de nuevo.",
  unsupportedChallenge: "El inicio de sesión requiere un paso no compatible. Contacta con el administrador.",
  session: "Tu sesión no está disponible o caducó. Inicia sesión de nuevo.",
  signOut: "La sesión local se cerró. No se pudo confirmar el cierre con el servicio.",
  generic: "No se pudo completar la autenticación. Inténtalo de nuevo.",
};

/** Only these allowlisted messages may cross the authentication boundary. */
export class AuthFailure extends Error {
  readonly code: AuthFailureCode;

  constructor(code: AuthFailureCode) {
    super(messages[code]);
    this.name = "AuthFailure";
    this.code = code;
  }
}

export function errorName(error: unknown): string {
  if (typeof error !== "object" || error === null || !("name" in error)) return "";
  return typeof error.name === "string" ? error.name : "";
}

export function safeAuthFailure(
  error: unknown,
  operation: "signIn" | "newPassword" | "session" | "signOut",
): AuthFailure {
  if (error instanceof AuthFailure) return error;
  if (operation === "session") return new AuthFailure("session");
  if (operation === "signOut") return new AuthFailure("signOut");

  switch (errorName(error)) {
    case "UserNotFoundException":
    case "NotAuthorizedException":
      // Deliberately indistinguishable: never enumerate whether an account exists.
      return new AuthFailure("credentials");
    case "TooManyRequestsException":
    case "LimitExceededException":
      return new AuthFailure("rateLimit");
    case "NetworkError":
    case "NetworkingError":
      return new AuthFailure("network");
    case "InvalidParameterException":
      return new AuthFailure(operation === "newPassword" ? "newPassword" : "credentials");
    case "InvalidPasswordException":
    case "PasswordHistoryPolicyViolationException":
      return new AuthFailure(operation === "newPassword" ? "newPassword" : "credentials");
    default:
      return new AuthFailure(operation === "signIn" ? "credentials" : "generic");
  }
}
