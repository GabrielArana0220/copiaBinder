import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { appConfig } from './config';
import { createCognitoAuth } from './features/auth/cognito';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el contenedor de la aplicación.');

// Amplify is a singleton: initialize once, outside React's StrictMode replay.
const authService = createCognitoAuth(appConfig);

createRoot(root).render(
  <StrictMode>
    <App config={appConfig} service={authService} />
  </StrictMode>,
);
