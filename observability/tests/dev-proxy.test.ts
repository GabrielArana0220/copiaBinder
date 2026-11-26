import { describe, expect, it } from 'vitest';
import { createObservabilityProxy, DEV_API_PREFIX } from '../tooling/dev-proxy';

describe('proxy de desarrollo', () => {
  it('conserva el mapping del ambiente y no desactiva TLS', () => {
    const proxy = createObservabilityProxy('https://api.binder.la/prod/observability/');
    expect(DEV_API_PREFIX).toBe('/observability-api');
    expect(proxy.target).toBe('https://api.binder.la/prod/observability');
    expect(proxy.changeOrigin).toBe(true);
    expect(proxy.secure).toBe(true);
    expect(proxy.rewrite?.('/observability-api/catalog')).toBe('/catalog');
    expect(proxy.rewrite?.('/observability-api/queries?id=example')).toBe('/queries?id=example');
    expect(proxy.rewrite?.('/observability-api-extra/catalog')).toBe('/observability-api-extra/catalog');
  });

  it('permite configurar otro ambiente HTTPS explícitamente', () => {
    expect(createObservabilityProxy('https://api.example.com/dev/observability').target)
      .toBe('https://api.example.com/dev/observability');
  });

  it.each([
    undefined, '', 'not-a-url', 'http://api.binder.la/prod/observability',
    'https://user:password@api.binder.la/prod/observability',
    'https://api.binder.la/prod/observability?token=secret',
    'https://api.binder.la/prod/observability#fragment',
    'https://api.binder.la/other',
  ])('rechaza un destino inválido o inseguro: %s', (target) => {
    expect(() => createObservabilityProxy(target)).toThrow();
  });
});
