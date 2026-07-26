# Brinteva SMS — `sms.brintevaworlds.com`

Plataforma de SMS para Brinteva Worlds, Inc.: lanzador de campañas masivas con
redacción asistida por IA, cumplimiento 10DLC (opt-out en español e inglés), y
puente bidireccional hacia Kommo CRM, donde los vendedores atienden las
conversaciones.

> **Sin secretos en este repositorio.** Credenciales, IPs, llaves y números de
> cuenta viven en `.env` y en el VPS. Este README documenta *nombres* de
> variables y procedimientos, nunca sus valores.

---

## Stack

| Capa | Tecnología |
|---|---|
| Servidor | Ubuntu 24.04 VPS (GoDaddy) |
| Runtime | Node.js 20 + PM2 (proceso `sms-bot`) |
| Web server | Nginx + Let's Encrypt, proxy a `127.0.0.1:3001` |
| Base de datos | MySQL 8.4 (`brinteva_sms`) |
| IA | Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) |
| SMS / Voz | Vonage **Messages API** (JWT RS256) + NCCO |
| CRM | Kommo Chats API (canal externo) |
| Admin UI | React + Vite + Tailwind, build estático en `public/admin/` |

---

## Estructura

```
.
├── index.js              # Express: webhooks, auth, opt-in, páginas 10DLC
├── lib/
│   ├── vonage.js         #  Messages API + JWT
│   ├── sms.js            #  sanitizeForSMS (GSM-7), segmentación
│   ├── campaigns.js      #  CRUD de campañas + resolución de audiencia
│   ├── sendEngine.js     #  motor de envío con throttling
│   ├── scheduler.js      #  node-cron para campañas programadas
│   ├── contacts.js       #  gestor de contactos (alta/edición/archivo)
│   ├── kommo.js          #  puente Kommo (firma X-Signature)
│   └── voice.js          #  NCCO: llamadas entrantes → grupo VBC
├── migrations/           # .sql fechados, aplicados con scripts/apply-migration.js
├── scripts/
│   ├── apply-migration.js
│   └── dlr.js            #  consulta acuses de entrega (Reports API)
├── admin-ui/             # fuente del panel (React); se compila a public/admin/
├── public/               # estáticos servidos por Express
│   ├── admin/            #  build del panel — SÍ se commitea
│   ├── privacy.html
│   └── sms-terms.html
└── docs/superpowers/     # specs y planes de implementación
```

`inbox-ui/` es una bandeja de entrada propia que quedó **descontinuada**: Kommo
la reemplazó como interfaz de los vendedores. Se conserva solo como referencia.

---

## Variables de entorno (`.env`, nunca commiteado)

```env
PORT

# Vonage — Messages API (JWT)
VONAGE_APPLICATION_ID
VONAGE_PRIVATE_KEY_PATH
VONAGE_NUMBER
VONAGE_API_KEY          # solo para scripts/dlr.js (Reports API)
VONAGE_API_SECRET       # idem

# Anthropic
ANTHROPIC_API_KEY

# MySQL
DB_HOST  DB_PORT  DB_NAME  DB_USER  DB_PASSWORD

# Auth del panel
JWT_SECRET
INBOX_PIN

# Envío
SEND_RATE_PER_SEC       # throttling del motor de envío
DRY_RUN                 # 1 = no llama a Vonage, simula message ids
AI_AUTOREPLY            # 1 = respuesta automática; 0 = contestan los vendedores

# Kommo
KOMMO_ENABLED  KOMMO_SCOPE_ID  KOMMO_CHANNEL_SECRET  KOMMO_BOT_ID
KOMMO_MIRROR_AI  KOMMO_ENFORCE_SIGNATURE

# Voz
VOICE_CONNECT  VOICE_EVENT_URL  VOICE_GREETING
VOICE_RING_TIMEOUT  VOICE_FALLBACK_NUMBER
```

---

## Base de datos

| Tabla | Descripción |
|---|---|
| `contacts` | Números, nombre, `opted_in`, `opted_out_at`, `archived_at` |
| `conversations` | Hilos por contacto: `ai_handling`, `needs_human`, `resolved` |
| `messages` | Mensajes 1-a-1 (inbound/outbound), estado de entrega, `sent_by` |
| `broadcasts` | Campañas: `draft`, `scheduled`, `sending`, `completed`, `failed` |
| `broadcast_recipients` | Estado por destinatario: `pending`, `sent`, `delivered`, `failed`, `opted_out` |
| `promotions` | Catálogo que se inyecta al prompt de la IA |
| `consent_records` | Evidencia de consentimiento del formulario web (10DLC) |

No hay tabla `users`: el panel se protege con un PIN compartido que emite un JWT.

Los contactos y las campañas se **archivan**, nunca se borran (`archived_at`):
las filas de `broadcast_recipients` son la evidencia de qué se envió a quién.

### Migraciones

Cada cambio de esquema es un `.sql` fechado en `migrations/`, aplicado con:

```bash
node scripts/apply-migration.js migrations/2026-07-23-contacts-archived-at.sql
```

El runner lee las credenciales vía `dotenv`, así que no expone secretos en el
historial del shell, y es idempotente ante "la columna ya existe".

---

## Endpoints

### Públicos / webhooks

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` · `/health` | Health check |
| `GET` | `/privacy` · `/sms-terms` · `/consent-script` | Páginas y script de consentimiento 10DLC |
| `POST` | `/api/opt-in` | Alta desde el formulario web; graba en `consent_records` |
| `POST` | `/inbound` | SMS entrante (Vonage) |
| `POST` | `/status` | Acuses de entrega (Vonage) |
| `POST` | `/voice/events` | Eventos de llamada (Vonage) |
| `POST` | `/kommo/webhook/:scope_id` | Respuestas de vendedores desde Kommo |

### Panel (requieren `Authorization: Bearer <jwt>`)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/login` | PIN → JWT (12 h) |
| `GET` | `/api/contacts` | Contactos activos y opted-in (selector de audiencia) |
| `GET` | `/api/contacts/all` | Todos, incluidos archivados y opted-out |
| `POST` · `PATCH` | `/api/contacts` · `/api/contacts/:id` | Alta y edición |
| `PATCH` | `/api/contacts/:id/archive` | Archivar / restaurar |
| `POST` | `/api/suggest` | Borrador del mensaje con Claude Haiku |
| `GET` · `POST` | `/api/campaigns` | Historial y creación |
| `GET` | `/api/campaigns/:id` | Detalle + estado por destinatario |
| `POST` | `/api/campaigns/:id/send` | Enviar ya (motor asíncrono) |
| `PATCH` | `/api/campaigns/:id/archive` | Archivar / restaurar |
| `GET` | `/admin/*` | Panel React (SPA) |

URLs a configurar en el dashboard de Vonage: `/inbound`, `/status`,
`/voice/events`.

---

## Flujo de un SMS entrante

```
1. Upsert del contacto y de la conversación abierta
2. Guardar el mensaje entrante
3. ¿HELP / INFO / SOPORTE?  → copia de ayuda registrada  (antes del opt-out,
                               responde incluso a quien ya se dio de baja)
4. ¿Palabra de baja?        → opted_in = FALSE, conversación resuelta
5. ¿Palabra de alta?        → opted_in = TRUE
6. Espejo hacia Kommo       → el vendedor ve y responde el hilo
7. AI_AUTOREPLY = 1         → Claude Haiku responde; [NEEDS_HUMAN] escala
```

Hoy `AI_AUTOREPLY` está **apagado**: contestan los vendedores desde Kommo. La
IA se usa solo para redactar campañas. La lógica del auto-responder se conserva
intacta para poder reactivarla.

### Cumplimiento 10DLC

Palabras clave reconocidas tras normalizar mayúsculas, puntuación y acentos:

- **Baja** — `stop`, `unsubscribe`, `cancel`, `quit`, `end`, `alto`, `pare`,
  `parar`, `detener`, `cancelar`, `fin`, `basta`, `eliminar`, `quitar`
- **Alta** — `start`, `alta`, `empezar`, `iniciar`, `comenzar`, `suscribir`,
  `suscribirme`
- **Ayuda** — `help`, `info`, `soporte`

`sí` y `yes` quedan **fuera** de la lista de alta a propósito: son respuestas
conversacionales normales y resuscribirían a gente que no lo pidió. Los textos
de confirmación se envían en inglés porque esa es la copia registrada ante los
operadores.

> **El opt-out tiene dos capas independientes.** `contacts.opted_in` decide qué
> *intentamos* enviar; el operador móvil mantiene su propio bloqueo que solo se
> levanta cuando el teléfono envía START. Reactivar a alguien desde el panel
> arregla nuestro lado únicamente: los envíos parecerán exitosos y no llegarán.
> Si alguien se dio de baja, tiene que escribir START desde su teléfono.

---

## Envío de campañas

`resolveRecipients` filtra por `opted_in = TRUE AND archived_at IS NULL`, y el
motor **vuelve a verificar** el opt-in de cada destinatario justo antes de
enviar (si cambió, la fila queda como `opted_out`). Los envíos se espacian según
`SEND_RATE_PER_SEC`, un fallo individual no aborta la campaña, y el error de
Vonage se guarda por destinatario.

Las campañas se reflejan en Kommo al enviarse, pero **no** se escriben en
`messages`, así que no aparecen dentro del hilo de conversación.

Con `DRY_RUN=1` el motor recorre todo el camino real —base de datos, throttling,
conteos— sin llamar a Vonage.

---

## Despliegue

```bash
git push production main
```

El hook `post-receive` del repositorio bare en el VPS hace checkout, corre
`npm install` y reinicia PM2. `origin` es GitHub; `production` es el VPS.

```bash
pm2 list                     # estado
pm2 logs sms-bot --lines 50  # logs en vivo
pm2 restart sms-bot          # reinicio manual

sudo nginx -t && sudo systemctl reload nginx
curl -s -o /dev/null -w '%{http_code}\n' https://sms.brintevaworlds.com/
```

### Panel de administración

```bash
cd admin-ui && npm install && npm run build   # compila a ../public/admin/
python3 devserve.py                           # servidor local de depuración
```

El build de `public/admin/` **se commitea** a propósito: el VPS no compila.

---

## Verificación

Este proyecto no usa suites con mocks. Los cambios se verifican con `curl`
real contra la base de datos real, primero con `DRY_RUN=1` y después con un
envío a un número propio. `scripts/dlr.js` consulta los acuses de entrega
cuando hay dudas sobre si un mensaje llegó al operador.

---

## Pendientes

- [ ] Soporte de imágenes (MMS) en campañas
- [ ] Agregar `unstop` a las palabras de alta
- [ ] Mostrar `opted_out_at` en el panel
- [ ] Normalizar números de 10 dígitos al importar CSV
- [ ] Procesar MMS entrantes (hoy se descartan)
- [ ] Endurecer el firewall del VPS y limitar MySQL a `127.0.0.1`

---

*Brinteva Worlds, Inc.*
