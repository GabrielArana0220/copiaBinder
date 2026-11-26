# Binder · Web de observabilidad

Aplicación independiente de **Vite + React + TypeScript** con formulario propio y Cognito SRP. Tiene sus dependencias, lockfile y compilación; no modifica el backend Python ni los stacks AWS.

## Funcionalidad implementada

- Inicio de sesión con el cliente público de Cognito mediante **`USER_SRP_AUTH`**, sin Hosted UI, redirecciones ni client secret.
- Cambio de contraseña temporal (`NEW_PASSWORD_REQUIRED`) y atributos requeridos que Cognito indique.
- JWT y refresh token **solo en memoria**, sin persistirlos en localStorage/sessionStorage. Al recargar la página hay que iniciar sesión de nuevo.
- Obtención del access token mediante `fetchAuthSession()` en cada lectura, para que el SDK renueve la sesión cuando corresponda.
- Cierre de sesión, limpieza de datos y cancelación de peticiones; errores de sesión vuelven al formulario.
- Lecturas reales **`GET /catalog` y `GET /health`** después de autenticar y al pulsar «Actualizar datos», sin sondeo continuo.
- Catálogo con filtro local de aplicaciones y detalle de funciones/grupos; estado técnico y configuración de logging informativos.
- Respuestas validadas y errores seguros: `401` cierra la sesión local; `403` explica la falta de permisos sin bucle de login; errores de red/servicio no inventan datos.

La aplicación **no crea usuarios**, no permite registro público, no modifica logging y no incluye todavía búsqueda de eventos, jobs de Logs Insights, trazas o métricas. MFA y otros desafíos distintos de contraseña temporal se rechazan de forma segura con indicación de contactar a administración. No hay sesiones, tokens o datos simulados en el runtime; las fixtures solo existen en pruebas.

## Requisitos y ejecución local

Node.js **24 LTS** recomendado y **pnpm 11.28.5**. No se necesita activar el entorno virtual Python.

Desde la raíz del repositorio:

```powershell
Set-Location web/observability
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

Abre **http://localhost:5173**. Si otro proyecto ya ocupa ese puerto:

```powershell
pnpm dev --port 5174
```

En ese caso abre **http://localhost:5174**. El puerto es estricto y Vite no lo cambia silenciosamente. Cambiar el puerto local no requiere modificar Cognito, callback URLs ni el CORS de AWS mientras utilices el proxy de desarrollo.

Comprobaciones locales:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

La compilación estática queda en `dist/`. `pnpm preview` permite inspeccionarla en **http://localhost:4173**, pero **no utiliza el proxy de desarrollo**. El build de producción apunta directamente a la API, por lo que para consultar desde ese origen haría falta CORS. Para pruebas locales contra la API real utiliza `pnpm dev`.

## Usuario necesario para la prueba real

Un administrador debe crear o habilitar tu usuario en **Amazon Cognito → User pools → pool de Binder → Users** y asignarle uno de estos grupos:

| Grupo | Acceso en esta pantalla |
|---|---|
| `binder-observability-read` | Consultar catálogo y salud |
| `binder-observability-admin` | También puede leer; esta web no implementa acciones administrativas |
| Ninguno | El login puede ser válido, pero la API devolverá `403` |

Usa **el nombre de usuario de Cognito**, no credenciales de AWS ni claves de aplicación. El pool actual no configura email como alias de login. No escribas contraseñas en archivos de ambiente, código, logs o solicitudes de soporte.

1. Introduce usuario y contraseña en tu formulario local.
2. Si es contraseña temporal, establece la definitiva y los atributos requeridos.
3. Al completar la autenticación, la web enviará el **access token** en `Authorization: Bearer ...` y cargará catálogo/salud.
4. Comprueba los resultados o el mensaje de permisos; no confundas autenticarse con tener autorización.
5. «Cerrar sesión» borra la sesión/datos locales y cancela peticiones pendientes. Los access tokens ya emitidos pueden seguir siendo válidos hasta su expiración en API Gateway; no se implementa una lista de revocación por petición.

No se ha creado ninguna cuenta como parte de esta implementación. Las pruebas automatizadas usan SDK/HTTP simulados, y la revisión del navegador sin credenciales comprueba el formulario y la ausencia de consultas previas al login. **Un login real y la lectura end-to-end con un usuario autorizado deben verificarse proporcionando esas credenciales en la propia web.**

## Configuración pública

Vite usa explícitamente esta carpeta como `root` y `envDir`; **no carga el archivo de ambiente del backend**. Los archivos públicos de desarrollo/producción están incluidos en Git y no contienen secretos.

| Variable | Valor preparado / uso |
|---|---|
| `VITE_AWS_REGION` | `us-east-1` |
| `VITE_COGNITO_USER_POOL_ID` | `us-east-1_EhRxu4W91` |
| `VITE_COGNITO_CLIENT_ID` | `1jgm878n71qoe4s2gsurqkrik3`, cliente web sin secreto |
| `VITE_API_BASE_URL` | Desarrollo: `/observability-api`; producción: `https://api.binder.la/prod/observability` |
| `OBSERVABILITY_API_PROXY_TARGET` | Solo servidor de desarrollo: `https://api.binder.la/prod/observability` |

**Todo `VITE_*` es visible en el navegador.** Aquí solo van identificadores públicos. No añadas secretos M2M, JWT, contraseñas, claves OpenAI ni credenciales AWS.

```text
Formulario propio → SDK Cognito / USER_SRP_AUTH → access token
Navegador → localhost:<puerto>/observability-api/catalog
          → proxy de Vite → api.binder.la/prod/observability/catalog
```

El proxy mantiene el mapping `/prod/observability`, verifica TLS y reenvía el encabezado Bearer; no autentica por su cuenta ni evita los permisos del backend. La configuración apunta al ambiente **de producción**: las dos operaciones implementadas son de lectura, sin cambios de configuración ni ejecución de jobs.

## Estructura

```text
src/
├── main.tsx                    # Inicialización única del SDK fuera de StrictMode
├── app/App.tsx                 # Rutas de estado de sesión y gating de consultas
├── components/                 # Header y tarjetas
├── config/                     # Configuración pública validada
├── features/
│   ├── auth/                   # SDK, proveedor React, errores y memoria
│   └── observability/          # Contratos y lectores de catálogo/salud
├── pages/
│   ├── SignInPage.tsx
│   ├── NewPasswordPage.tsx
│   └── OverviewPage.tsx
├── services/api/client.ts      # Bearer bajo demanda, cancelación y errores seguros
└── styles/global.css
```

Amplify es un singleton: `main.tsx` crea el servicio una sola vez, fuera del render de React. El token provider de memoria se instala **después** de `Amplify.configure`, porque el SDK puede restablecer su almacenamiento al configurar. Los resultados tardíos de login/renovación no pueden reactivar una sesión cerrada; al salir se desmonta la vista y se descartan respuestas anteriores. El SDK conserva internamente estado opaco de desafío; se eliminan únicamente sus claves `CognitoSignInState.*` al configurar, tras cada paso y al salir.

## Git y publicación

Se versionan fuentes, configuración pública y lockfile. `node_modules/`, `dist/`, cachés y cobertura son regenerables y quedan ignorados. No se han cambiado los archivos del backend ni se ha desplegado la web. Su futura publicación podrá usar S3 privado + CloudFront; el dominio HTTPS final deberá permitirse en el CORS de la API. Un commit/push y un despliegue AWS son acciones distintas.

Referencias: [autenticación del frontend](src/features/auth/README.md), [guía Cognito/API](../../docs/observability-web.md) y [contrato público de la API](https://api.binder.la/prod/observability/docs).
