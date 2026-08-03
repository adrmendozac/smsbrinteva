# Mensajes largos alojados (itinerarios por enlace) — diseño

**Fecha:** 2026-08-03
**Estado:** propuesta, pendiente de aprobación

## 1. El problema, con evidencia

Los vendedores pegan itinerarios completos en Kommo. El relay los manda tal cual
a Vonage y Vonage los rechaza.

El límite real es **3200 caracteres**. Confirmado contra la API (sonda con `to`
inválido: nada se envió, nada se cobró):

```
3200 → pasa la validación de texto
3201 → 422  "text: cannot exceed 3200 characters for the given channel."
```

Coincide exactamente con producción: **1015–2681 caracteres entregados (10/10)**,
**3574–12103 fallidos (17/17)**. La documentación de Vonage dice 1000; está
desactualizada — hoy pasan mensajes de 2681.

**Alcance:** 17 fallos, 13 clientes distintos, del 2026-07-29 a hoy. Los
vendedores reintentan a ciegas: `15103755027` recibió el mismo itinerario de
12 103 caracteres 3 veces; `19564006125`, 8735 caracteres 3 veces.

**Por qué nadie pudo diagnosticarlo:**

- `lib/vonage.js:49` `describeError` lee sólo `title`/`detail` y **descarta
  `invalid_parameters`**, que es justamente donde Vonage nombra el campo y la
  razón. Al log llega "Invalid params: The value of one or more parameters is
  invalid."
- `index.js:343` empuja a Kommo el genérico `'SMS send failed'`.
- El log estructurado guarda sólo `{phone, conversationId}` — sin razón, sin
  longitud.

**Costo real** (columna `cost`, verificado): $0.012 por segmento, 153 caracteres
por segmento (`sanitizeForSMS` deja ASCII puro, siempre GSM-7). Un mensaje de
2681 caracteres costó $0.216. Un itinerario de 12 103 caracteres, si se
dividiera, serían 80 segmentos ≈ **$0.95 a un solo cliente**.

## 2. Qué construimos

Cuando el texto del vendedor supera el umbral, se **aloja** y se envía un SMS de
un segmento con el enlace. El itinerario vive en una página propia del dominio
que ya tenemos.

```
Vendedor pega 12 103 caracteres en Kommo
        ↓
Se guarda en hosted_messages → código k7mp2q9xrt
        ↓
SMS (1 segmento, $0.012):
"MARAVILLAS DE ITALIA Y PARIS: https://sms.brintevaworlds.com/i/k7mp2q9xrt"
        ↓
El cliente abre una página legible en el teléfono
```

Sin límite de longitud, 80× más barato, y el cliente puede volver al enlace
cuando quiera.

**No es un sitio nuevo.** Es una ruta más en el Express que ya sirve `/privacy`,
`/sms-terms` y el panel.

**Por qué no PDF por MMS:** el canal MMS de Vonage a operadoras de EE. UU. acepta
JPEG/PNG/GIF únicamente — PDF no. Habría que rasterizar a varias imágenes, cada
una tope ~200 KB para ser segura, y el cliente termina con fotos de texto que no
puede copiar ni buscar. La página, además, **imprime a PDF** desde cualquier
teléfono, que es el mismo resultado sin ninguna de las desventajas.

## 3. Umbral — decisión a aprobar

`HOSTED_LINK_THRESHOLD`, variable de entorno. **Decidido: 2000** (2026-08-03).
La recomendación original era 1000, por el punto 1 de abajo; 2000 es el valor
elegido y queda configurable sin desplegar código.

Tres razones, en orden de peso:

1. **1000 es el límite documentado de Vonage.** Que hoy pasen 3200 es
   comportamiento no documentado. Si Vonage aprieta la validación para que
   coincida con su documentación, todo mensaje entre 1000 y 3200 empieza a
   fallar exactamente como hoy. Quedarse en ≤1000 elimina ese riesgo.
2. **Costo.** Los 10 mensajes de 1001–3200 que hoy funcionan cuestan $0.084–$0.216
   cada uno; por enlace serían $0.012.
3. **Legibilidad.** 1000 caracteres son ~7 SMS concatenados; un itinerario se lee
   mejor como página.

Con umbral 1000, el tráfico actual queda: los ~270 mensajes de ≤1000 caracteres
siguen igual, 10 pasan a enlace, y los 17 que fallan se arreglan.

**Nota de entregabilidad:** el enlace usa **nuestro dominio 10DLC registrado**,
nunca un acortador. Los acortadores genéricos sí disparan filtros anti-spam de
las operadoras; un dominio de marca registrado es el caso seguro.

## 4. Modelo de datos

`migrations/2026-08-03-hosted-messages.sql`

```sql
CREATE TABLE hosted_messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code            VARCHAR(16)  NOT NULL UNIQUE,
  title           VARCHAR(200) NULL,
  body            MEDIUMTEXT   NOT NULL,
  contact_id      INT          NULL,
  conversation_id INT          NULL,
  message_id      INT          NULL,   -- fila de `messages` que llevó el enlace
  source          ENUM('kommo','campaign','admin') NOT NULL DEFAULT 'kommo',
  view_count      INT UNSIGNED NOT NULL DEFAULT 0,
  first_viewed_at TIMESTAMP    NULL,
  last_viewed_at  TIMESTAMP    NULL,
  expires_at      TIMESTAMP    NULL,   -- NULL = sin vencimiento
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Se llama `hosted_messages` y no `itineraries` porque el relay es genérico: un
vendedor también pega cotizaciones largas, y las campañas podrán usar la misma
tabla más adelante (`source`).

`expires_at` nace en NULL (sin vencimiento) pero existe desde el principio, para
poder activar caducidad después sin otra migración.

`view_count` / `first_viewed_at` son valor de negocio real: el vendedor puede
saber si el cliente abrió su itinerario.

## 5. Códigos de URL

10 caracteres del alfabeto `abcdefghjkmnpqrstuvwxyz23456789` (sin `i`, `l`, `o`,
`0`, `1` — nada ambiguo), vía `crypto.randomBytes`. ≈49 bits: enumerar es
inviable.

La URL **es** la credencial — el cliente no tiene login. De ahí el tamaño del
código y los controles de la sección 6.

## 6. La página

Server-side, HTML autocontenido, sin dependencias nuevas. Móvil primero.

- **Escapado obligatorio** de `& < > " '` sobre el cuerpo: es texto arbitrario
  pegado por un vendedor, y sin escapar es un XSS directo.
- **`X-Robots-Tag: noindex, nofollow`** + meta equivalente. Los itinerarios de
  clientes no se indexan en Google. Es el control de privacidad principal junto
  al código impredecible.
- **CSP** `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'` — la
  página no tiene scripts, así que puede cerrarse por completo.
- **CSS de impresión**, para que "imprimir → guardar como PDF" dé un documento
  limpio. Es la respuesta a la intuición del PDF.
- Tipografía del sistema (no fuentes propias): carga instantánea con datos
  móviles.
- Estructura: encabezado Brinteva Worlds → título (primera línea) → bloques por
  día → pie con **925-665-8003** (reservas, sólo llamadas) y **925-262-8150**
  (soporte).

El formato real de los itinerarios es bloques separados por línea en blanco,
donde la primera línea es el día (`viernes, 11 de septiembre de 2026: ROMA`). Se
detecta ese patrón para destacar el encabezado de cada día; si no coincide, cae
a párrafo normal. Nunca falla, sólo se ve menos bonito.

## 7. Integración en el relay

`index.js:328`, hoy:

```js
const sent = await sendSMS(phone, sanitizeForSMS(text), conversationId, 'human', mediaUrl);
```

Nuevo orden — importa, porque `sanitizeForSMS` cambia la longitud:

```
1. clean = sanitizeForSMS(text)
2. si !clean && !mediaUrl  → fallar con razón clara      (arregla el bug 3)
3. si !mediaUrl && clean.length > THRESHOLD:
       aloja → code → url
       body  = "<título ≤80>: <url>"   (se afirma ≤160 = 1 segmento)
4. si mediaUrl && clean.length > 300:
       aloja; el caption del MMS lleva el enlace
5. enviar
```

El paso 2 arregla de paso el bug de "vacío tras sanitizar": hoy el guard
`(!text && !mediaUrl)` corre **antes** de sanitizar, así que una respuesta de
puro emoji pasa el guard, queda en `''` y se envía vacía (ya pasó dos veces,
mensajes 308 y 311).

Lo que se guarda en `messages.body` es **el SMS que realmente salió** (el
enlace), no el itinerario — el itinerario vive en `hosted_messages`. Así el panel
muestra la verdad de lo enviado.

## 8. Diagnóstico (va incluido, sin depender del resto)

Esto se arregla igual, sea cual sea la decisión de producto:

- **`describeError`** suma `invalid_parameters`:
  `"text: cannot exceed 3200 characters for the given channel."` en vez de
  "Invalid params".
- **`sendSMS` devuelve la razón.** Hoy devuelve `null` y la pierde. Pasa a
  `{ ok:false, error }`. Verificado: **sólo `index.js:328` lee el retorno**; los
  otros 5 sitios (`lib/public.js:121`, `lib/webhooks.js:167/181/193/262`) lo
  ignoran, así que el cambio es seguro.
- **Kommo recibe la razón real** en vez de `'SMS send failed'`.
- **El log estructurado** guarda `{ phone, conversationId, length, reason }`.
- **Guard de 3200 antes de llamar a Vonage** (defensa en profundidad: si el
  alojamiento falla, no mandamos algo que sabemos que va a ser rechazado).

## 9. Landmine relacionada: campañas

`lib/campaigns.js` limita el caption de MMS a 300 (`MMS_CAPTION_MAX`) pero **no
limita el cuerpo de texto plano** desde que `161c0be` quitó el tope de un
segmento. Un cuerpo de campaña >3200 fallaría para **todos** los destinatarios,
uno por uno.

Además `appendOptOut` agrega `\n\n` + 27 caracteres, así que el tope efectivo es
**3200 − 30**. Un cuerpo de exactamente 3200 se pasa al añadir el opt-out.

Se agrega validación en la creación de campaña (400 con mensaje claro), que es
donde el usuario puede corregirlo. Barato y evita un fallo masivo.

## 10. Qué ve cada quien

- **Cliente:** un SMS normal de un segmento con el título y el enlace.
- **Vendedor en Kommo:** entrega exitosa. En caso de fallo real, la razón
  concreta ("el mensaje tiene 12 103 caracteres, el máximo es 3200") en vez de
  "SMS send failed".
- **Panel / Registro:** el `messages.body` con el enlace enviado, y un log
  `info` con la URL y la longitud original.

## 11. Fuera de alcance / preguntas abiertas

- **Avisar al vendedor dentro del chat de Kommo** que se envió como enlace. Lo
  natural sería una nota en el lead, pero `createLeadNote` está roto (bug
  conocido: manda `params:{}` con `text` hermano; Kommo quiere `params:{text}`) y
  además la búsqueda de lead por teléfono devuelve coincidencias equivocadas. Se
  deja fuera: el vendedor ve la entrega exitosa y aprende la convención. **Si lo
  quieres dentro, dilo y lo diseñamos aparte.**
- Caducidad de enlaces: columna lista, apagada.
- Reutilizar el alojamiento para campañas largas (`source='campaign'`).
- Vista en el panel de "itinerarios enviados / abiertos".

## 12. Verificación (sin mocks, contra la base real)

Según la convención del repo:

1. `node --check` en cada archivo de backend tocado.
2. Aplicar la migración en el VPS con `scripts/apply-migration.js`.
3. Sembrar una fila y `curl` a `/i/<code>`: comprobar HTML, escapado (probar con
   un cuerpo que contenga `<script>`), cabeceras `noindex` y CSP, y un 404 para
   un código inexistente.
4. Prueba real punta a punta del relay **a un teléfono que tú indiques** — ojo:
   `DRY_RUN` **no** aplica a `sendSMS` (sólo al motor de campañas), así que
   cualquier prueba del relay envía un SMS de verdad.
5. Confirmar en la base: `hosted_messages` con la fila, `messages.body` con el
   enlace, y el DLR llegando a `delivered`.

## 13. Archivos

| Archivo | Cambio |
|---|---|
| `migrations/2026-08-03-hosted-messages.sql` | nuevo — tabla |
| `lib/hosted.js` | nuevo — código, guardado, plantilla HTML, ruta `/i/:code` |
| `index.js` | relay: sanitizar→guard→alojar; `sendSMS` devuelve razón; montar ruta |
| `lib/vonage.js` | `describeError` incluye `invalid_parameters` |
| `lib/campaigns.js` | validar longitud de cuerpo (3200 − margen de opt-out) |
| `README.md` | tabla nueva, endpoint nuevo, variable nueva |

Sin cambios en `admin-ui/` (no hace falta recompilar el panel).
