#!/usr/bin/env node
/**
 * Carrier-side delivery check via the Vonage Reports API.
 *
 * Reads the real DLR (carrier receipt) for outbound SMS — not the submit
 * response, which returns status 0 even when carriers reject the message.
 *
 * Run on the VPS (needs .env):
 *   node scripts/dlr.js [days] [toNumber]
 *
 * Or without deploying, piped from a local checkout:
 *   ssh vuelosmundi@72.167.54.34 'cd /var/www/sms.brintevaworlds.com && node - 2 19253398990' < scripts/dlr.js
 */
require('dotenv').config({ quiet: true });
const https = require('https');

const days = Number(process.argv[2] || 30);
const filterTo = process.argv[3] || null;

const key = process.env.VONAGE_API_KEY;
const secret = process.env.VONAGE_API_SECRET;
const sender = process.env.VONAGE_NUMBER;
const auth = Buffer.from(`${key}:${secret}`).toString('base64');

function get(path) {
  return new Promise((resolve, reject) => {
    https
      .get(
        { host: 'api.nexmo.com', path, headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ code: res.statusCode, body }));
        }
      )
      .on('error', reject);
  });
}

(async () => {
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 3600 * 1000);
  const path =
    `/v2/reports/records?account_id=${key}&product=SMS&direction=outbound` +
    `&date_start=${iso(start)}&date_end=${iso(end)}`;

  const res = await get(path);
  if (res.code !== 200) {
    console.error(`Reports API ${res.code}:`, res.body.slice(0, 400));
    process.exit(1);
  }

  let records = JSON.parse(res.body).records || [];
  if (filterTo) records = records.filter((m) => m.to === filterTo);

  console.log(`window: last ${days}d   records: ${records.length}${filterTo ? `   to: ${filterTo}` : ''}`);

  // Delivered-vs-rejected per sending number: the signal that a 10DLC link took effect.
  const tally = {};
  for (const m of records) {
    const k = `${m.from} ${m.status}`;
    tally[k] = (tally[k] || 0) + 1;
  }
  console.log('\nby sender/status:');
  for (const [k, n] of Object.entries(tally).sort()) {
    console.log(`  ${k.padEnd(28)} ${n}`);
  }

  console.log('\n12 newest:');
  for (const m of records.slice(0, 12)) {
    const flag = m.from === sender && m.status === 'delivered' ? '  <-- delivered on current sender' : '';
    console.log(
      `  ${(m.date_received || m.date_finalized || '').slice(0, 19)}  ${m.to}  from=${m.from}  ` +
        `${String(m.status).padEnd(9)} err=${String(m.error_code).padEnd(3)} ${m.network_name || ''}${flag}`
    );
  }

  const win = records.filter((m) => m.from === sender && m.status === 'delivered');
  console.log(
    `\n${win.length ? `PASS: ${win.length} delivered from ${sender}` : `no delivered records yet from ${sender}`}`
  );
})();
