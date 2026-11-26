// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import type { PublicAppConfig } from '../src/config/env';
import type { AuthService } from '../src/features/auth/cognito';
import type { AuthSession } from '../src/features/auth/types';

// Synthetic fixtures only. No Cognito users, credentials or API data are used.
const config: PublicAppConfig = { region: 'us-east-1', userPoolId: 'us-east-1_Unit123', userPoolClientId: 'unitclient123', apiBaseUrl: '/observability-api' };
const session: AuthSession = { user: { subject: 'unit-user-id', username: 'unit-user' }, expiresAtEpochSeconds: 4_000_000_000 };
const catalog = { domains: [{ id: 'unit-domain', name: 'Dominio de prueba', applications: [{ id: 'unit-app', name: 'Aplicación de prueba', functions: [{ name: 'unit-function', component: 'api', log_group: '/aws/lambda/unit-function' }] }] }] };
const health = { status: 'ok', catalog_applications: 1, selected_log_groups: 1, logging: { detailed: false, version: 2 }, checks: { ssm: 'available', query_registry: 'configured' } };
const token = 'unit-test-access-token';

function createService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    restoreSession: vi.fn(async () => null),
    signIn: vi.fn(async () => ({ step: 'signedIn' as const, session })),
    completeNewPassword: vi.fn(async () => ({ step: 'signedIn' as const, session })),
    signOut: vi.fn(async () => undefined),
    getAccessToken: vi.fn(async () => token),
    ...overrides,
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function installApi() {
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (url === '/observability-api/catalog') return json(catalog);
    if (url === '/observability-api/health') return json(health);
    throw new Error('Unexpected URL in unit test');
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

async function login() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Usuario'), 'unit-user');
  await user.type(screen.getByLabelText('Contraseña'), 'UnitPassword!42');
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
  return user;
}

afterEach(async () => {
  await act(async () => { cleanup(); await Promise.resolve(); });
  vi.unstubAllGlobals();
});

describe('formulario propio y lecturas autenticadas', () => {
  it('muestra el formulario sin pedir tokens ni consultar la API antes del login', async () => {
    const service = createService();
    const fetchFn = installApi();
    render(<App config={config} service={service} />);
    expect(await screen.findByLabelText('Usuario')).toBeTruthy();
    expect(service.getAccessToken).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Vista general' })).toBeNull();
  });

  it('inicia sesión, envía el access token y muestra datos de ambas lecturas', async () => {
    const service = createService();
    const fetchFn = installApi();
    render(<App config={config} service={service} />);
    const user = await login();
    expect(service.signIn).toHaveBeenCalledExactlyOnceWith('unit-user', 'UnitPassword!42');
    expect(await screen.findByRole('heading', { name: 'Vista general' })).toBeTruthy();
    expect(await screen.findByText('Aplicación de prueba')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Disponible' })).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchFn.mock.calls) {
      expect(init?.headers).toEqual({ Authorization: `Bearer ${token}` });
      expect(init?.credentials).toBe('omit');
    }
    expect(document.body.textContent).not.toContain(token);
    await user.type(screen.getByLabelText('Filtrar aplicaciones'), 'no-coincide');
    expect(screen.getByText('No hay aplicaciones que coincidan con el filtro.')).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('maneja contraseña temporal y atributos requeridos antes de consultar datos', async () => {
    const service = createService({ signIn: vi.fn(async () => ({ step: 'newPasswordRequired' as const, requiredAttributes: ['email'] })) });
    const fetchFn = installApi();
    render(<App config={config} service={service} />);
    const user = await login();
    await screen.findByRole('heading', { name: 'Establece tu contraseña' });
    expect(fetchFn).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Nueva contraseña'), 'UnitNewPassword!42');
    await user.type(screen.getByLabelText('Repetir nueva contraseña'), 'DifferentPassword!42');
    await user.type(screen.getByLabelText('Correo electrónico'), 'unit@example.invalid');
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña y continuar' }));
    expect(screen.getByRole('alert').textContent).toContain('no coinciden');
    expect(service.completeNewPassword).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Repetir nueva contraseña'));
    await user.type(screen.getByLabelText('Repetir nueva contraseña'), 'UnitNewPassword!42');
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña y continuar' }));
    expect(await screen.findByText('Aplicación de prueba')).toBeTruthy();
    expect(service.completeNewPassword).toHaveBeenCalledExactlyOnceWith('UnitNewPassword!42', { email: 'unit@example.invalid' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('permite cancelar el desafío sin consultar la API', async () => {
    const service = createService({ signIn: vi.fn(async () => ({ step: 'newPasswordRequired' as const, requiredAttributes: [] })) });
    const fetchFn = installApi();
    render(<App config={config} service={service} />);
    const user = await login();
    await user.click(await screen.findByRole('button', { name: 'Volver al ingreso' }));
    expect(await screen.findByLabelText('Usuario')).toBeTruthy();
    expect(service.signOut).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('muestra un error seguro de autenticación y limpia la contraseña', async () => {
    const failure = Object.assign(new Error('PRIVATE_PROVIDER_DETAIL'), { name: 'NotAuthorizedException' });
    const service = createService({ signIn: vi.fn(async () => { throw failure; }) });
    const fetchFn = installApi();
    render(<App config={config} service={service} />);
    await login();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(document.body.textContent).not.toContain('PRIVATE_PROVIDER_DETAIL');
    expect((screen.getByLabelText('Contraseña') as HTMLInputElement).value).toBe('');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('mantiene la sesión ante 403 y explica la falta de permisos sin inventar datos', async () => {
    const service = createService();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'PRIVATE_ERROR' }, 403));
    vi.stubGlobal('fetch', fetchFn);
    render(<App config={config} service={service} />);
    await login();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('grupo autorizado'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy();
    expect(service.signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Disponible' })).toBeNull();
    expect(document.body.textContent).not.toContain('PRIVATE_ERROR');
  });

  it.each([false, true])('cierra la sesión una sola vez ante 401 sin reintentos ni datos residuales (ambos=%s)', async (bothRejected) => {
    const service = createService();
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (url) => bothRejected || url === '/observability-api/catalog' ? json({}, 401) : json(health));
    vi.stubGlobal('fetch', fetchFn);
    render(<App config={config} service={service} />);
    await login();
    expect(await screen.findByLabelText('Usuario')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('La API no aceptó tu sesión');
    expect(service.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Vista general' })).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('no envía peticiones si falla la obtención o renovación del token', async () => {
    const service = createService({ restoreSession: vi.fn(async () => session), getAccessToken: vi.fn(async () => { throw new Error('PRIVATE_REFRESH_DETAIL'); }) });
    const fetchFn = installApi();
    render(<App config={config} service={service} />);
    expect(await screen.findByLabelText('Usuario')).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('PRIVATE_REFRESH_DETAIL');
  });

  it('aborta consultas y descarta respuestas tardías al cerrar sesión', async () => {
    let resolveCatalog!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveCatalog = resolve; });
    const service = createService({ restoreSession: vi.fn(async () => session) });
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (url) => url === '/observability-api/catalog' ? pending : json(health));
    vi.stubGlobal('fetch', fetchFn);
    render(<App config={config} service={service} />);
    await screen.findByRole('heading', { name: 'Vista general' });
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    const signal = fetchFn.mock.calls.find(([url]) => url === '/observability-api/catalog')?.[1]?.signal;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByLabelText('Usuario')).toBeTruthy();
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolveCatalog(json(catalog)); await Promise.resolve(); });
    expect(screen.queryByText('Aplicación de prueba')).toBeNull();
  });

  it('actualiza explícitamente sin sondeo continuo y maneja catálogo vacío/servicio caído', async () => {
    const service = createService({ restoreSession: vi.fn(async () => session) });
    const fetchFn = installApi();
    render(<App config={config} service={service} />);
    await screen.findByText('Aplicación de prueba');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Actualizar datos' }) as HTMLButtonElement).disabled).toBe(false));
    fetchFn.mockImplementation(async (url) => url === '/observability-api/catalog' ? json({ domains: [] }) : json({}, 503));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Actualizar datos' }));
    expect(await screen.findByText('El catálogo no contiene aplicaciones.')).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('no está disponible temporalmente');
    expect(screen.queryByRole('heading', { name: 'Disponible' })).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});
