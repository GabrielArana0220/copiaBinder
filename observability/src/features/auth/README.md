# Autenticación Cognito SRP

`createCognitoAuth(config)` configura una única instancia de Amplify con el User
Pool y app client públicos, sin OAuth, Hosted UI ni client secret. No crea usuarios
ni modifica configuración AWS. El inicio usa `USER_SRP_AUTH`; únicamente se admite
`NEW_PASSWORD_REQUIRED`, con los atributos indicados por `missingAttributes`.
Cualquier otro desafío falla de forma segura y descarta la sesión local.

El token provider usa `MemoryTokenStorage` (un `Map` por instancia), instalado
sincrónicamente después de `Amplify.configure` y antes de autenticar. El SDK
6.22.2 restablece su storage por defecto al configurar: por eso importa ese orden.
JWT y refresh tokens nunca se escriben en `localStorage` o `sessionStorage`;
recargar la página elimina la sesión. Amplify usa además claves
`CognitoSignInState.*` para su desafío opaco: se eliminan al configurar, tras cada
paso y al salir/cancelar, sin modificar otras claves del navegador. Las contraseñas
solo se pasan durante la llamada al SDK.

`AuthProvider` expone identidad/metadatos y estados `checking`, `signedOut`,
`newPasswordRequired` y `signedIn`. No contiene tokens ni realiza consultas a la
API. Los métodos de formulario capturan los errores y muestran mensajes seguros
en español; cuenta inexistente y contraseña incorrecta son indistinguibles.
El UI debe vaciar sus inputs de contraseña tras enviarlos.

`getAccessToken()` llama a `fetchAuthSession()` en cada solicitud, permitiendo la
renovación del SDK sin temporizadores. Solo devuelve el **access token**, verifica
`token_use=access` y expiración y nunca sustituye el ID token. Un fallo de sesión o
renovación elimina estado local y hace que el proveedor vuelva a `signedOut`.
`AuthSession` conserva solo usuario y expiración, no prueba permisos del backend.

La generación de operaciones y la cola del SDK impiden que resultados tardíos de
restore/login/refresh reactiven una sesión tras logout, cancelación o unmount.
Salir invalida inmediatamente la generación y el UI; después permite al SDK leer
el refresh token e intentar revocarlo, y limpia el Map en `finally` aunque falle.
Esto no garantiza revocación inmediata del access JWT: el backend puede aceptarlo
hasta su expiración. El montaje es seguro bajo el replay de efectos de React StrictMode. Crear el servicio una sola vez fuera
del render de React, porque el token provider del SDK es un singleton.

Las pruebas usan SDK simulado o `AuthService` inyectado y fixtures sintéticos;
no necesitan usuarios reales ni hacen llamadas de red/AWS. La autorización real
corresponde al backend en cada consulta, no a los atributos mostrados en el UI.
