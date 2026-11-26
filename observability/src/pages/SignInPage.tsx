import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { AppHeader } from '../components/AppHeader';

export interface SignInPageProps {
  busy: boolean;
  error: string | null;
  onSubmit: (username: string, password: string) => Promise<void>;
  onClearError: () => void;
}

export function SignInPage({ busy, error, onSubmit, onClearError }: SignInPageProps) {
  const id = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !username.trim() || !password) return;
    const submittedPassword = password;
    setPassword('');
    await onSubmit(username.trim(), submittedPassword);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#contenido">Ir al contenido</a>
      <AppHeader action={<span className="project-badge">Acceso privado</span>} />
      <main id="contenido" className="auth-layout">
        <section className="auth-intro" aria-labelledby="intro-title">
          <p className="eyebrow">Panel de operaciones</p>
          <h1 id="intro-title">Observabilidad,<br />en un solo lugar.</h1>
          <p className="hero__description">Consulta el catálogo de aplicaciones y el estado técnico de la API de Binder con tu cuenta autorizada.</p>
          <ul className="feature-list">
            <li><span aria-hidden="true">01</span> Fuentes y funciones administradas</li>
            <li><span aria-hidden="true">02</span> Estado de la API y configuración de logging</li>
            <li><span aria-hidden="true">03</span> Permisos verificados por el backend</li>
          </ul>
          <p className="muted small">Conexión al ambiente de producción. Esta pantalla no consulta datos antes de autenticar.</p>
        </section>
        <section className="auth-card" aria-labelledby="login-title">
          <p className="eyebrow">Tu cuenta de Binder</p>
          <h2 id="login-title">Iniciar sesión</h2>
          <p className="muted">Introduce el usuario y la contraseña que te asignó administración.</p>
          {error && <div className="alert alert--error" role="alert">{error}</div>}
          <form onSubmit={(event) => { void submit(event); }} aria-label="Inicio de sesión">
            <div className="field">
              <label htmlFor={`${id}-username`}>Usuario</label>
              <input id={`${id}-username`} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={busy} value={username}
                onChange={(event) => { setUsername(event.target.value); onClearError(); }} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-password`}>Contraseña</label>
              <input id={`${id}-password`} name="password" type="password" autoComplete="current-password" required disabled={busy} value={password}
                onChange={(event) => { setPassword(event.target.value); onClearError(); }} />
            </div>
            <button className="button button--primary button--full" type="submit" disabled={busy}>
              {busy ? 'Iniciando sesión…' : 'Ingresar'}
            </button>
            {busy && <p className="small muted" role="status">Autenticando con Cognito…</p>}
          </form>
          <div className="auth-help">
            <strong>¿No tienes acceso?</strong>
            <p>Un administrador debe crear tu cuenta y asignarte el grupo de lectura o administración de observabilidad. No son tus credenciales de la consola de AWS.</p>
          </div>
          <p className="security-note">Formulario propio · Autenticación Cognito SRP · Sin client secret</p>
        </section>
      </main>
      <footer className="site-footer"><span>Binder · Observabilidad</span><span>Los tokens de sesión se mantienen en memoria</span></footer>
    </div>
  );
}
