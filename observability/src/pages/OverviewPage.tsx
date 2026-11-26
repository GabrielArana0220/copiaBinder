import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AppHeader } from '../components/AppHeader';
import { StatusCard } from '../components/StatusCard';
import type { PublicAppConfig } from '../config/env';
import type { AuthUser } from '../features/auth/types';
import { createObservabilityReader } from '../features/observability/service';
import type { Catalog, Health } from '../features/observability/types';
import { ApiHttpError, apiErrorMessage, createApiClient, isApiAbortError } from '../services/api/client';

interface OverviewPageProps {
  config: PublicAppConfig;
  user: AuthUser;
  getAccessToken: () => Promise<string>;
  onSignOut: () => Promise<void>;
  onUnauthorized: () => Promise<void>;
}

type RemoteData<T> =
  | { status: 'loading'; data: null; error: null; receivedAt: null }
  | { status: 'success'; data: T; error: null; receivedAt: number }
  | { status: 'error'; data: null; error: string; receivedAt: null };

function loading<T>(): RemoteData<T> {
  return { status: 'loading', data: null, error: null, receivedAt: null };
}

export function OverviewPage({ config, user, getAccessToken, onSignOut, onUnauthorized }: OverviewPageProps) {
  const [catalog, setCatalog] = useState<RemoteData<Catalog>>(loading);
  const [health, setHealth] = useState<RemoteData<Health>>(loading);
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('');
  const reader = useMemo(() => createObservabilityReader(createApiClient({ baseUrl: config.apiBaseUrl, getAccessToken })), [config.apiBaseUrl, getAccessToken]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setCatalog(loading());
    setHealth(loading());

    async function load<T>(read: () => Promise<T>, apply: Dispatch<SetStateAction<RemoteData<T>>>) {
      try {
        const data = await read();
        if (active && !controller.signal.aborted) apply({ status: 'success', data, error: null, receivedAt: Date.now() });
      } catch (error) {
        if (!active || controller.signal.aborted || isApiAbortError(error)) return;
        if (error instanceof ApiHttpError && error.status === 401) {
          // One rejected batch must close the session only once and stop siblings.
          active = false;
          controller.abort();
          void onUnauthorized();
          return;
        }
        apply({ status: 'error', data: null, error: apiErrorMessage(error), receivedAt: null });
      }
    }

    void load(() => reader.getCatalog(controller.signal), setCatalog);
    void load(() => reader.getHealth(controller.signal), setHealth);
    return () => { active = false; controller.abort(); };
  }, [reader, refresh, onUnauthorized]);

  const query = filter.trim().toLocaleLowerCase('es');
  const domains = catalog.status === 'success'
    ? catalog.data.domains.map((domain) => ({
      ...domain,
      applications: domain.applications.filter((app) => `${domain.id} ${domain.name ?? ''} ${app.id} ${app.name ?? ''}`.toLocaleLowerCase('es').includes(query)),
    })).filter((domain) => domain.applications.length > 0)
    : [];
  const busy = catalog.status === 'loading' || health.status === 'loading';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#contenido">Ir al contenido</a>
      <AppHeader action={<><span className="session-user">{user.username}</span><button className="button button--secondary" onClick={() => { void onSignOut(); }}>Cerrar sesión</button></>} />
      <main id="contenido">
        <section className="dashboard-heading" aria-labelledby="page-title">
          <div><p className="eyebrow">Ambiente de producción · Solo lectura</p><h1 id="page-title">Vista general</h1><p className="muted">Catálogo y estado técnico recibidos de la API de Binder.</p></div>
          <button className="button button--primary" onClick={() => setRefresh((value) => value + 1)} disabled={busy}>{busy ? 'Consultando…' : 'Actualizar datos'}</button>
        </section>

        <section className="panel" aria-labelledby="health-title">
          <div className="section-heading"><h2 id="health-title">Salud de la API</h2>{health.status === 'success' && <span className="small muted">Recibido a las {new Date(health.receivedAt).toLocaleTimeString('es-PE')}</span>}</div>
          {health.status === 'loading' && <p className="loading-state" role="status">Consultando estado técnico…</p>}
          {health.status === 'error' && <div className="alert alert--error" role="alert">{health.error}</div>}
          {health.status === 'success' && <>
            <div className="status-grid health-grid">
              <StatusCard label="Respuesta /health" title="Disponible" description={`Estado devuelto por la API: ${health.data.status}.`} />
              <StatusCard label="Catálogo administrado" title={String(health.data.catalog_applications)} description="Aplicaciones informadas por el servicio." />
              <StatusCard label="Fuentes seleccionadas" title={String(health.data.selected_log_groups)} description="Grupos de logs incluidos en esta comprobación." />
              <StatusCard label={`Logging · versión ${health.data.logging.version}`} title={health.data.logging.detailed ? 'Detalle activado' : 'Detalle desactivado'} description="Estado informativo; esta pantalla no modifica la configuración." />
            </div>
            <dl className="technical-checks"><div><dt>Parameter Store</dt><dd>{health.data.checks.ssm === 'available' ? 'Disponible' : health.data.checks.ssm}</dd></div><div><dt>Registro de consultas</dt><dd>{health.data.checks.query_registry === 'configured' ? 'Configurado' : health.data.checks.query_registry}</dd></div></dl>
            <p className="small muted">Esta respuesta comprueba el servicio de observabilidad; no certifica la salud de todas las aplicaciones del catálogo.</p>
          </>}
        </section>

        <section className="panel" aria-labelledby="catalog-title">
          <div className="section-heading"><div><p className="eyebrow">Fuentes disponibles</p><h2 id="catalog-title">Catálogo de aplicaciones</h2></div>{catalog.status === 'success' && <span className="small muted">Recibido a las {new Date(catalog.receivedAt).toLocaleTimeString('es-PE')}</span>}</div>
          {catalog.status === 'loading' && <p className="loading-state" role="status">Consultando catálogo…</p>}
          {catalog.status === 'error' && <div className="alert alert--error" role="alert">{catalog.error}</div>}
          {catalog.status === 'success' && <>
            <div className="field catalog-search"><label htmlFor="catalog-filter">Filtrar aplicaciones</label><input id="catalog-filter" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Dominio o aplicación" /></div>
            {domains.length === 0 && <div className="empty-state">{query ? 'No hay aplicaciones que coincidan con el filtro.' : 'El catálogo no contiene aplicaciones.'}</div>}
            <div className="catalog-domains">{domains.map((domain) => (
              <section className="catalog-domain" key={domain.id} aria-labelledby={`domain-${domain.id}`}>
                <div className="domain-heading"><h3 id={`domain-${domain.id}`}>{domain.name ?? domain.id}</h3><code>{domain.id}</code></div>
                {domain.applications.map((app) => <details className="application-details" key={app.id}>
                  <summary><span>{app.name ?? app.id}</span><span className="small muted">{app.functions.length} {app.functions.length === 1 ? 'función' : 'funciones'}</span></summary>
                  <p className="small muted application-id">Identificador: <code>{app.id}</code></p>
                  {app.functions.length === 0 ? <p className="small muted">No hay funciones declaradas para esta aplicación.</p> : <div className="table-scroll"><table><caption className="visually-hidden">Funciones de {app.name ?? app.id}</caption><thead><tr><th scope="col">Función</th><th scope="col">Componente</th><th scope="col">Grupo de logs</th></tr></thead><tbody>{app.functions.map((fn) => <tr key={`${fn.name}-${fn.log_group}`}><td><code>{fn.name}</code></td><td>{fn.component}</td><td><code>{fn.log_group}</code></td></tr>)}</tbody></table></div>}
                </details>)}
              </section>
            ))}</div>
          </>}
        </section>
        <div className="dashboard-note"><p className="small muted">Las consultas se realizan al entrar y al pulsar «Actualizar datos», sin sondeo continuo. Los permisos reales siempre los verifica la API.</p><a href="https://api.binder.la/prod/observability/docs" target="_blank" rel="noopener noreferrer">Documentación de la API ↗</a></div>
      </main>
      <footer className="site-footer"><span>Binder · Observabilidad</span><span>{config.apiBaseUrl === '/observability-api' ? 'Proxy local → API real' : 'Conexión directa a la API'} · {config.region}</span></footer>
    </div>
  );
}
