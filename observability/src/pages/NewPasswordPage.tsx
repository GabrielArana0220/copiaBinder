import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { AppHeader } from '../components/AppHeader';

interface NewPasswordPageProps {
  busy: boolean;
  error: string | null;
  requiredAttributes: string[];
  onSubmit: (password: string, attributes?: Record<string, string>) => Promise<void>;
  onCancel: () => Promise<void>;
  onClearError: () => void;
}

const attributeNames: Record<string, string> = {
  email: 'Correo electrónico',
  phone_number: 'Teléfono (formato internacional)',
  name: 'Nombre completo',
  given_name: 'Nombre',
  family_name: 'Apellidos',
};

export function NewPasswordPage({ busy, error, requiredAttributes, onSubmit, onCancel, onClearError }: NewPasswordPageProps) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  function clearErrors() {
    setValidationError(null);
    onClearError();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmation) {
      setValidationError('Las contraseñas no coinciden.');
      return;
    }
    if (!password) return;
    const submittedPassword = password;
    setPassword('');
    setConfirmation('');
    setValidationError(null);
    await onSubmit(submittedPassword, Object.fromEntries(requiredAttributes.map((name) => [name, attributes[name]?.trim() ?? ''])));
  }

  return (
    <div className="app-shell">
      <AppHeader action={<span className="project-badge">Primer acceso</span>} />
      <main id="contenido" className="challenge-layout">
        <section className="auth-card challenge-card" aria-labelledby="password-title">
          <p className="eyebrow">Completa tu acceso</p>
          <h1 id="password-title">Establece tu contraseña</h1>
          <p className="muted">Cognito requiere sustituir tu contraseña temporal. La nueva contraseña debe cumplir la política de tu cuenta.</p>
          {(validationError || error) && <div className="alert alert--error" role="alert">{validationError || error}</div>}
          <form onSubmit={(event) => { void submit(event); }} aria-label="Contraseña definitiva">
            <div className="field">
              <label htmlFor={`${id}-password`}>Nueva contraseña</label>
              <input id={`${id}-password`} name="newPassword" type="password" autoComplete="new-password" required minLength={8} disabled={busy} value={password}
                onChange={(event) => { setPassword(event.target.value); clearErrors(); }} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-confirmation`}>Repetir nueva contraseña</label>
              <input id={`${id}-confirmation`} name="confirmation" type="password" autoComplete="new-password" required minLength={8} disabled={busy} value={confirmation}
                onChange={(event) => { setConfirmation(event.target.value); clearErrors(); }} />
            </div>
            {requiredAttributes.map((name) => (
              <div className="field" key={name}>
                <label htmlFor={`${id}-${name}`}>{attributeNames[name] ?? name}</label>
                <input id={`${id}-${name}`} name={name} required disabled={busy} type={name === 'email' ? 'email' : name === 'phone_number' ? 'tel' : 'text'}
                  value={attributes[name] ?? ''} onChange={(event) => { setAttributes((values) => ({ ...values, [name]: event.target.value })); clearErrors(); }} />
              </div>
            ))}
            <button className="button button--primary button--full" type="submit" disabled={busy}>
              {busy ? 'Confirmando…' : 'Guardar contraseña y continuar'}
            </button>
            <button className="button button--text button--full" type="button" disabled={busy} onClick={() => { void onCancel(); }}>Volver al ingreso</button>
            {busy && <p className="small muted" role="status">Confirmando con Cognito…</p>}
          </form>
          <p className="security-note">No guardamos tu contraseña en la aplicación.</p>
        </section>
      </main>
    </div>
  );
}
