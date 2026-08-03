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
│   └── logs.js           #  bitácora estructurada (tabla `logs`)
│   └── hosted.js         #  mensajes largos alojados + página `/i/:code`
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

# Mensajes largos alojados
PUBLIC_BASE_URL         # base de los enlaces (default sms.brintevaworlds.com)
HOSTED_LINK_THRESHOLD   # caracteres a partir de los cuales se envía enlace (2000)
HOSTED_LINK_TTL_DAYS    # vigencia del enlace en días (90)
UNSPLASH_ACCESS_KEY     # opcional: foto del destino. Sin llave no hay foto

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
| `logs` | Bitácora estructurada: envíos, acuses, webhooks, auth, acciones del panel |
| `hosted_messages` | Itinerarios y textos largos servidos en `/i/:code`; vencen a los 90 días |

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
| `GET` | `/i/:code` | Itinerario o mensaje largo alojado (404 si no existe, 410 si venció) |
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
| `GET` | `/api/logs` | Bitácora del servidor (`level`, `category`, `before` para paginar) |
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

## Mensajes largos (itinerarios)

Vonage rechaza cualquier SMS de más de **3200 caracteres** —verificado contra la
API el 2026-08-03: `text: cannot exceed 3200 characters for the given channel`.
La documentación de Vonage dice 1000 y está desactualizada. Los vendedores pegan
itinerarios de 5000 a 12 000 caracteres en Kommo, así que el relay los aloja:

```
Vendedor pega 12 103 caracteres en Kommo
        ↓  supera HOSTED_LINK_THRESHOLD (2000)
Se guarda en hosted_messages → código de 10 caracteres
        ↓
SMS de un segmento: "MARAVILLAS DE ITALIA Y PARIS: https://.../i/k7mp2q9xrt"
```

Cuesta $0.012 en vez de ~$0.95, no tiene tope de longitud, y la página muestra
los acentos y la ñ que GSM-7 no admite (por eso se guarda el texto **crudo**, no
el sanitizado). Por debajo del umbral no cambia nada.

La URL **es** la credencial: el destinatario no tiene login. De ahí que el código
sea impredecible (10 caracteres, ~49 bits), que la página se sirva `noindex`,
`no-store`, `nosniff` y sin poder embeberse en un iframe, y que el enlace **venza
a los 90 días** — los itinerarios llevan nombre del cliente, fechas de viaje y
datos de reserva, y además los precios cambian. Vencido responde 410 con una
página que invita a llamar.

El cuerpo se escapa siempre antes de renderizarse: es texto arbitrario pegado
por un vendedor.

### Qué ve el vendedor

Tras enviarse el enlace, se importa un aviso **en el mismo hilo de Kommo** que el
vendedor está mirando:

```
Enviado como enlace (4826 caracteres, máximo 2000 por SMS).
Link al itinerario: https://sms.brintevaworlds.com/i/m7qk3x9r2
```

Va por la misma ruta que usan las campañas (`importMessage` con `silent: true`),
así que Kommo lo registra en la conversación sin intentar entregarlo como SMS y
sin devolvernos el webhook de respuesta de vendedor. Sin este aviso el vendedor
vería su itinerario completo y un acuse de entrega, sin manera de saber que el
cliente recibió un enlace — parecería que el sistema truncó su trabajo.

### Formato de itinerarios

El contrato de parseo vive en `docs/hosted-itinerary-parsing.md`. **No es una
plantilla que los vendedores deban seguir**: el parser lee línea por línea y
acepta encabezados en español e inglés —`Día 1: BANGKOK`, `1er día:`,
`Day 1 — Chiang Rai`, `viernes, 11 de septiembre de 2026: Roma`,
`2026-09-11: Rome`— **sin exigir líneas en blanco entre días**, que es como
llegan los itinerarios reales. Una línea es encabezado sólo si coincide con la
forma completa, así que `day 1 of the conference` sigue siendo un párrafo.
Ninguna línea con contenido se pierde nunca.

El límite del cuerpo son **120 000 bytes UTF-8** (no caracteres: MySQL cuenta
bytes y JavaScript cuenta unidades UTF-16, y una `ñ` ocupa dos bytes). Por eso
`body` es `MEDIUMTEXT` y los límites de `express.json`/`urlencoded` son `256kb`.

### Foto del destino (Unsplash)

Si `UNSPLASH_ACCESS_KEY` está configurada, al crear el mensaje se busca **una
sola vez** una foto del primer destino con confianza (`Día 1: BANGKOK` → Bangkok;
`CIUDAD DE ORIGEN - ROMA` → Roma). La imagen **se enlaza desde Unsplash**, nunca
se copia al VPS, conserva su parámetro `ixid`, y se acredita al fotógrafo y a
Unsplash con los parámetros de referencia que exigen sus términos. El CSP sólo
añade `https://images.unsplash.com` a `img-src`.

Sin llave, sin resultados, con timeout o con una URL fuera de la lista blanca,
la página se muestra igual, sin foto. Las páginas de privacidad en inglés y
español declaran que Unsplash puede recibir la IP del visitante.

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

La única excepción es `npm test` (`tests/*.test.js`, `node --test`): cubre el
contrato de parseo de itinerarios y la capa de Unsplash con funciones puras y
las dependencias que ya se inyectan (`deps.axios`, `deps.db`). No toca la base
de datos ni la red, así que corre en cualquier parte; la verificación contra la
base real sigue siendo un paso aparte.

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
