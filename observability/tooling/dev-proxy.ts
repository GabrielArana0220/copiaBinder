import type { ProxyOptions } from 'vite';

export const DEV_API_PREFIX = '/observability-api';

export function createObservabilityProxy(targetBaseUrl: string | undefined): ProxyOptions {
  if (!targetBaseUrl?.trim()) {
    throw new Error('Configura OBSERVABILITY_API_PROXY_TARGET en el entorno del frontend.');
  }

  let target: URL;
  try {
    target = new URL(targetBaseUrl.trim());
  } catch {
    throw new Error('OBSERVABILITY_API_PROXY_TARGET debe ser una URL HTTPS válida.');
  }

  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !/^\/(dev|prod)\/observability\/?$/.test(target.pathname)
  ) {
    throw new Error('El proxy exige HTTPS y la ruta /<dev|prod>/observability, sin credenciales, query ni fragmento.');
  }

  return {
    target: `${target.origin}${target.pathname.replace(/\/$/, '')}`,
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/observability-api(?=\/|$)/, ''),
  };
}
