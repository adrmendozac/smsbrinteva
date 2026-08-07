// Apply a .sql migration using the same DB credentials the app loads, via
// dotenv — so no secrets are ever echoed to the shell (unlike `. .env`).
//
//   node scripts/apply-migration.js migrations/2026-07-23-contacts-archived-at.sql
//
// Idempotent for the common "column already exists" and "table already
// exists" cases — the deploy hook re-runs every migrations/*.sql file on
// every push with no record of what already applied, so a migration whose
// CREATE TABLE lacks IF NOT EXISTS (an easy oversight — see
// 2026-07-05-consent-records.sql) would otherwise fail this script, and
// `set -e` in the hook would then abort before pm2 ever restarts.
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');
 
(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/apply-migration.js <file.sql>');
    process.exit(1);
  }
  const sql = fs.readFileSync(file, 'utf8');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  try {
    await db.query(sql);
    console.log('Applied:', file);
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('Already applied (column exists) — OK');
    } else if (e.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('Already applied (table exists) — OK');
    } else {
      throw e;
    }
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error('Migration failed, exiting', e.message);
  process.exit(1);
});
