import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { createObservabilityProxy, DEV_API_PREFIX } from './tooling/dev-proxy.ts';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command, mode, isPreview }) => {
  // Env aislado al frontend: nunca cargar el .env del backend desde el cwd.
  const env = loadEnv(mode, projectRoot, ['VITE_', 'OBSERVABILITY_API_PROXY_TARGET']);
  const useDevProxy = command === 'serve' && !isPreview;
  const proxy = useDevProxy
    ? { [`^${DEV_API_PREFIX}(?:/|$)`]: createObservabilityProxy(env.OBSERVABILITY_API_PROXY_TARGET) }
    : undefined;

  return {
    root: projectRoot,
    envDir: projectRoot,
    plugins: [react()],
    server: { host: 'localhost', port: 5173, strictPort: true, proxy },
    preview: { host: 'localhost', port: 4173, strictPort: true },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
