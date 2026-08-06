#!/usr/bin/env node
/**
 * Manual smoke test for lib/hostedInterpreter.js against a real Haiku call.
 *
 * Defaults to the real seller message that failed as messages.id=708 (the
 * Keren / bundled-offers screenshot, conversation 77) — no "Día N" headings
 * at all, two unrelated promos in one paste, the exact shape this module's
 * "travel_offers" classification exists for.
 *
 * Needs ANTHROPIC_API_KEY, which only lives in the VPS .env. Run from a local
 * checkout without deploying:
 *   ssh vuelosmundi@72.167.54.34 'cd /var/www/sms.brintevaworlds.com && node -' < scripts/try-hosted-interpreter.js
 *
 * Or on the VPS directly, optionally against a different example file:
 *   node scripts/try-hosted-interpreter.js [path/to/example.txt]
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const axios = require('axios');
const { interpretHostedMessage } = require('../lib/hostedInterpreter');

const DEFAULT_EXAMPLE = `Buenas tardes le atiende Keren, nos indica cuantas personas viajan y de donde considero su salida?

Vive El Grito como nunca!

Excursion Grupal Guadalajara y Leon  septiembre 2026
Vuelo: Salida de Oakland
Precio: Adulto $1,290 USD por persona
en habitacion doble
Visitando: Guadalajara, Chapala, Tequila, Guanajuato, San Miguel (grito), Callejoneada y Dolores Hidalgo
Incluye: avion redondo, hotel 4 estrellas, transporte y visitas segun itinerario.
(Entradas, comidas, maletas y pasaporte americano NO estan incluidas)
Pago total
Si quieres salir de otra ciudad lo checamos, personas solas tiene otro costo
tarifa no reembolsable//no permite cambios
Fecha: 13 al 18 de septiembre - 6 dias (salida 12 por la noche)

 Santuario de la Mariposa Monarca!

Excursion Grupal a Guadalajara y Morelia  Diciembre 2026
Vuelo: Salida de Oakland, Los Angeles y Tijuana
Precio: Adulto $1,290 USD por persona
en habitacion doble
Visitando: Guadalajara, Chapala ,Tequila, Morelia, Mariposa Monarca, Pazcuaro y Janitzio
Incluye: avion redondo, hotel 4 estrellas, transporte y visitas segun itinerario.
(Entradas, comidas, maletas y pasaporte americano NO estan incluidas)
Reserva con $250 USD por persona y paga en abonos.
Si quieres salir de otra ciudad lo checamos, personas solas tiene otro costo
tarifa no reembolsable//no permite cambios
Fecha: 4 al 9 de diciembre - 6 dias (salida 3 por la noche)`;

(async () => {
  const filePath = process.argv[2];
  const rawBody = filePath ? fs.readFileSync(filePath, 'utf8') : DEFAULT_EXAMPLE;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set — run this where the real .env lives (see header comment).');
    process.exit(1);
  }

  console.log(`source: ${filePath || 'embedded Keren example (messages.id=708)'}`);
  console.log(`chars: ${rawBody.length}\n`);

  const result = await interpretHostedMessage({ axios, env: process.env, log: console }, rawBody);
  console.log(JSON.stringify(result, null, 2));

  if (result.ok) {
    console.log(`\nclassification: ${result.classification}   tours: ${result.tours.length}   ` +
      `durationMs: ${result.usage.durationMs}`);
  } else {
    console.log(`\nfailed closed — reason: ${result.reason} (this is the signal Part 2's deterministic fallback reacts to)`);
  }
})();
