import { useCallback, useState } from 'react';
import type { PublicAppConfig } from '../config/env';
import { AppHeader } from '../components/AppHeader';
import { AuthProvider, useAuth } from '../features/auth/AuthProvider';
import type { AuthService } from '../features/auth/cognito';
import { NewPasswordPage } from '../pages/NewPasswordPage';
import { OverviewPage } from '../pages/OverviewPage';
import { SignInPage } from '../pages/SignInPage';

export interface AppProps {
  service: AuthService;
  config: PublicAppConfig;
}

function Application({ config }: { config: PublicAppConfig }) {
  const auth = useAuth();
  const [notice, setNotice] = useState<string | null>(null);

  const handleUnauthorized = useCallback(async () => {
    setNotice('La API no aceptó tu sesión. Vuelve a iniciar sesión para continuar.');
    await auth.signOut();
  }, [auth.signOut]);

  if (auth.status === 'checking') {
    return (
      <div className="app-shell">
        <AppHeader />
        <main id="contenido" className="session-check" role="status">Comprobando sesión…</main>
      </div>
    );
  }

  if (auth.status === 'newPasswordRequired') {
    return <NewPasswordPage busy={auth.isSubmitting} error={auth.error} requiredAttributes={auth.requiredAttributes}
      onSubmit={auth.completeNewPassword} onCancel={auth.cancelChallenge} onClearError={auth.clearError} />;
  }

  if (auth.status === 'signedIn' && auth.user) {
    return <OverviewPage key={auth.user.subject} config={config} user={auth.user} getAccessToken={auth.getAccessToken}
      onUnauthorized={handleUnauthorized} onSignOut={async () => { setNotice(null); await auth.signOut(); }} />;
  }

  return <SignInPage busy={auth.isSubmitting} error={auth.error ?? notice}
    onSubmit={async (username, password) => { setNotice(null); await auth.signIn(username, password); }}
    onClearError={() => { setNotice(null); auth.clearError(); }} />;
}

export default function App({ service, config }: AppProps) {
  return <AuthProvider service={service}><Application config={config} /></AuthProvider>;
}
