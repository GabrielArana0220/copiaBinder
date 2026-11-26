import { parsePublicConfig } from "./env";

export const appConfig = parsePublicConfig(import.meta.env);
