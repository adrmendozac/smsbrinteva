# Brinteva SMS Automation — `sms.brintevaworlds.com`

Sistema de automatización de SMS con IA para Brinteva Worlds, Inc. Incluye respuestas automáticas con Claude Haiku, bandeja de entrada compartida para agentes, y envíos masivos programados.

---

## Stack

| Capa | Tecnología |
|---|---|
| Servidor | Ubuntu 24.04 VPS (GoDaddy, IP `72.167.54.34`) |
| Runtime | Node.js 20 + PM2 |
| Web server | Nginx + Let's Encrypt (Certbot) |
| Base de datos | MySQL 8.4 (`brinteva_sms`) |
| Cache / Real-time | Redis (puerto `6379`) |
| IA | Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) |
| SMS API | Vonage Communications API (Nexmo) |
| Frontend (inbox) | React + Tailwind (via CDN) + Socket.io |

---

## Estructura de directorios

```
/var/www/sms.brintevaworlds.com/
├── index.js              # Servidor Express principal (webhook handler + API routes)
├── .env                  # Variables de entorno (NO commitear)
├── .gitignore
├── private.key           # Vonage private key para JWT auth (NO commitear)
├── package.json
├── package-lock.json
├── node_modules/
└── public/               # Frontend React (build estático, servido por Nginx)
    └── inbox/
        └── index.html
```

---

## Variables de entorno (`.env`)

```env
PORT=3001

# Vonage Communications API
VONAGE_API_KEY=e1e31164
VONAGE_API_SECRET=
VONAGE_APPLICATION_ID=
VONAGE_PRIVATE_KEY_PATH=./private.key
VONAGE_SIGNATURE_SECRET=
VONAGE_NUMBER=

# Anthropic
ANTHROPIC_API_KEY=

# MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=brinteva_sms
DB_USER=brinteva_user
DB_PASSWORD=

# Auth (inbox)
JWT_SECRET=
SESSION_SECRET=
```

---

## Base de datos — `brinteva_sms`

### Tablas

| Tabla | Descripción |
|---|---|
| `contacts` | Números de clientes, idioma detectado, estado de opt-in/out |
| `conversations` | Hilos por contacto; estados: `ai_handling`, `needs_human`, `open`, `resolved` |
| `messages` | Mensajes individuales inbound/outbound, dirección, remitente (ai/human/system) |
| `broadcasts` | Campañas de envío masivo; estados: draft, scheduled, sending, completed, failed |
| `broadcast_recipients` | Estado individual de envío por contacto por campaña |
| `users` | Agentes con acceso a la bandeja de entrada *(pendiente)* |

### Acceso

```bash
sudo mysql
USE brinteva_sms;
SHOW TABLES;
```

---

## PM2

| Proceso | ID | Puerto | Directorio |
|---|---|---|---|
| `sms-bot` | 0 | 3001 | `/var/www/sms.brintevaworlds.com` |

```bash
pm2 list                    # ver procesos
pm2 restart sms-bot         # reiniciar
pm2 logs sms-bot            # ver logs en vivo
pm2 flush sms-bot           # limpiar logs
pm2 save                    # guardar estado actual
```

---

## Nginx

Archivo de configuración: `/etc/nginx/sites-available/sms.brintevaworlds.com`

- Puerto 80 → redirige a HTTPS
- Puerto 443 → proxy a `127.0.0.1:3001`
- SSL: `/etc/letsencrypt/live/sms.brintevaworlds.com/`

```bash
sudo nginx -t                        # validar config
sudo systemctl reload nginx          # aplicar cambios
sudo certbot renew --dry-run         # probar renovación SSL
```

---

## Endpoints (Webhook)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Health check — devuelve `SMS Bot is running` |
| `POST` | `/inbound` | Recibe SMS entrantes de Vonage |
| `POST` | `/status` | Recibe actualizaciones de entrega de Vonage |
| `GET` | `/inbox` | Bandeja de entrada para agentes *(pendiente)* |
| `POST` | `/api/reply` | Enviar respuesta manual desde inbox *(pendiente)* |
| `POST` | `/api/resolve` | Marcar conversación como resuelta *(pendiente)* |
| `GET` | `/api/conversations` | Lista de conversaciones *(pendiente)* |
| `GET` | `/api/messages/:id` | Mensajes de un hilo *(pendiente)* |

**URLs para configurar en Vonage Dashboard (Application):**
- Inbound: `https://sms.brintevaworlds.com/inbound`
- Status: `https://sms.brintevaworlds.com/status`

---

## Lógica del webhook inbound (`/inbound`)

```
Mensaje entrante
  ↓
1. Upsert contacto en `contacts`
2. Obtener o crear conversación abierta
3. Guardar mensaje en `messages`
4. ¿Es STOP/UNSUBSCRIBE? → opt-out + respuesta + resolver
5. ¿Es START? → opt-in + respuesta
6. ¿Conversación en `needs_human`? → skip AI, esperar agente
7. Llamar a Claude Haiku (bilingüe, <160 caracteres)
8. ¿Respuesta contiene [NEEDS_HUMAN]? → escalar conversación
9. Enviar respuesta via Vonage SMS API
10. Guardar mensaje outbound en `messages`
```

---

## Vonage — Estado actual

| Item | Estado |
|---|---|
| Cuenta API (Nexmo) | ✅ Creada — API key `e1e31164` |
| Fondos | ✅ Cargados (recibo No. 580335) |
| Acceso a cuenta | ⏳ En revisión por Vonage (ticket enviado a Rodolfo) |
| Brand 10DLC — VBC | ✅ Aprobada: `BHDQXLV` (Brinteva Worlds Inc., abril 2024) |
| Brand 10DLC — API | ⏳ Pendiente (registrar en API dashboard una vez desbloqueado) |
| Campaña 10DLC | ⏳ Pendiente |
| Número virtual (LVN) | ⏳ Pendiente |
| Application ID + Private Key | ⏳ Pendiente |

---

## Pendientes de desarrollo

- [ ] Tabla `users` en MySQL con roles (admin / agente)
- [ ] Sistema de login con JWT y sesiones
- [ ] Frontend React — bandeja de entrada (`/inbox`)
  - Lista de conversaciones (estado, último mensaje, asignado a)
  - Hilo de mensajes por contacto
  - Caja de respuesta manual
  - Botón de escalar / resolver
  - Indicador de "agente está respondiendo" (Socket.io)
  - Notificaciones en tiempo real de mensajes nuevos
- [ ] Actualizar Vonage de SMS API legacy → Messages API con JWT auth
- [ ] Módulo de envío masivo (`/broadcasts`)
  - UI para redactar campaña
  - Carga de lista de contactos (CSV)
  - Programación de envío (node-cron)
  - Rate limiting y batching (evitar filtros de spam)
  - Reporte de entrega en tiempo real
- [ ] Integración Claude para personalización de mensajes masivos
- [ ] WhatsApp via Vonage Messages API (misma infraestructura)

---

## Historial de cambios

| Fecha | Cambio |
|---|---|
| Jun 2026 | Setup inicial: VPS, Nginx, SSL, PM2, Express |
| Jun 2026 | Webhook inbound + Claude Haiku AI responder |
| Jun 2026 | Base de datos MySQL — 5 tablas |
| Jun 2026 | Eliminación de `fb-bot` (Facebook bot deprecado) |
| Jun 2026 | Seguridad: app bindeada a `127.0.0.1` (no expuesta directamente) |

---

## Comandos rápidos de referencia

```bash
# Ver estado general
pm2 list && ss -tlnp | grep 3001

# Reiniciar app después de cambios en index.js
pm2 restart sms-bot && pm2 logs sms-bot --lines 20

# Verificar SSL y health del stack completo
curl https://sms.brintevaworlds.com/

# Acceder a MySQL
sudo mysql -e "USE brinteva_sms; SHOW TABLES;"

# Ver logs de Nginx
sudo tail -f /var/log/nginx/error.log

# Renovar SSL manualmente si hace falta
sudo certbot renew
```

---

## Contactos del proyecto

| Rol | Nombre | Contacto |
|---|---|---|
| Owner / Dev | Adrian Mendoza | `munditravels10@hotmail.com` |
| Vonage Support | Rodolfo | Ticket abierto — cuenta `e1e31164` |
| VBC Super User | Bridget Ruiz | `nicoll.brintevaworlds...` |

---

*Brinteva Worlds, Inc. — EIN 92-3293741 — Pittsburg, CA*
