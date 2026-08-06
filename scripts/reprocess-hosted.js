#!/usr/bin/env node
// Re-run hosted-message interpretation without changing the stored raw body.
// Explicit scope is required:
//   node scripts/reprocess-hosted.js --code 4kq66yjbaq
//   node scripts/reprocess-hosted.js --limit 25
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const axios = require('axios');
const {
  analyzeHostedBody,
  extractDestination,
  fetchUnsplashHero,
  trackUnsplashDownload,
  ALPHABET,
  CODE_LENGTH,
} = require('../lib/hosted');
const { createLogger } = require('../lib/logs');

function readArgs(argv) {
  const codeAt = argv.indexOf('--code');
  const limitAt = argv.indexOf('--limit');
  if ((codeAt === -1) === (limitAt === -1)) {
    throw new Error('Use exactamente uno: --code <código> o --limit <1-100>');
  }
  if (codeAt !== -1) {
    const code = String(argv[codeAt + 1] || '');
    if (!new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(code)) throw new Error('Código inválido');
    return { code };
  }
  const limit = Number(argv[limitAt + 1]);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit debe estar entre 1 y 100');
  return { limit };
}

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no está configurada');
  const scope = readArgs(process.argv.slice(2));
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const log = createLogger(db);
  const deps = { db, axios, env: process.env, log };

  try {
    const [rows] = scope.code
      ? await db.execute(
        'SELECT id, code, body, title, title_origin FROM hosted_messages WHERE code = ? LIMIT 1',
        [scope.code]
      )
      : await db.query(
        `SELECT id, code, body, title, title_origin
           FROM hosted_messages
          ORDER BY id DESC
          LIMIT ${scope.limit}`
      );

    if (rows.length === 0) throw new Error('No se encontraron mensajes alojados');
    for (const row of rows) {
      const providedTitle = row.title_origin === 'provided' ? row.title : null;
      const analysis = await analyzeHostedBody(deps, row.body, providedTitle);
      const destination = extractDestination(analysis.parsed);
      const hero = destination ? await fetchUnsplashHero(deps, destination) : null;
      const heroField = (name) => (hero && hero[name]) || null;

      await db.execute(
        `UPDATE hosted_messages
            SET title = ?, ai_structure = ?, parse_method = ?, parse_model = ?,
                parse_duration_ms = ?, parse_input_tokens = ?, parse_output_tokens = ?,
                parse_cost_usd = ?, title_origin = ?, parsed_at = NOW(),
                hero_destination = ?, hero_photo_id = ?, hero_image_url = ?,
                hero_photo_url = ?, hero_photographer_name = ?, hero_photographer_url = ?
          WHERE id = ?`,
        [analysis.resolvedTitle,
         analysis.aiStructure ? JSON.stringify(analysis.aiStructure) : null,
         analysis.parseMethod, analysis.parseModel, analysis.parseDurationMs,
         analysis.inputTokens, analysis.outputTokens, analysis.estimatedCostUsd,
         analysis.titleOrigin,
         heroField('destination'), heroField('photoId'), heroField('imageUrl'),
         heroField('photoUrl'), heroField('photographerName'), heroField('photographerUrl'),
         row.id]
      );

      if (hero?.downloadLocation) trackUnsplashDownload(deps, hero.downloadLocation).catch(() => {});
      console.log(`${row.code}: ${analysis.parseMethod} / ${analysis.classification} / ${analysis.resolvedTitle}`);
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(`Reprocess failed: ${err.message}`);
  process.exit(1);
});
