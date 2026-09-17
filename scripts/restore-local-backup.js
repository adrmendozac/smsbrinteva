#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

const encryptedPath = process.argv[2];
const passwordPath = process.argv[3];

if (!encryptedPath || !passwordPath) {
  console.error('Usage: node scripts/restore-local-backup.js <dump.sql.enc> <password-file>');
  process.exit(1);
}

async function main() {
  const adminConnection = {
    user: process.env.MYSQL_ADMIN_USER || process.env.MYSQL_ROOT_USER || 'root',
  };
  const adminPassword = process.env.MYSQL_ADMIN_PASSWORD ?? process.env.MYSQL_ROOT_PASSWORD;
  const adminSocket = process.env.MYSQL_ADMIN_SOCKET || process.env.MYSQL_ROOT_SOCKET;
  if (adminSocket) {
    adminConnection.socketPath = adminSocket;
  } else {
    adminConnection.host = process.env.MYSQL_ADMIN_HOST || '127.0.0.1';
    adminConnection.port = Number(process.env.MYSQL_ADMIN_PORT) || 3306;
  }
  if (adminPassword !== undefined) adminConnection.password = adminPassword;

  const root = await mysql.createConnection(adminConnection);
  const database = mysql.escapeId(process.env.DB_NAME);
  const user = mysql.escape(process.env.DB_USER);
  const password = mysql.escape(process.env.DB_PASSWORD);

  await root.query(`CREATE DATABASE IF NOT EXISTS ${database}`);
  await root.query(`CREATE USER IF NOT EXISTS ${user}@'localhost' IDENTIFIED BY ${password}`);
  await root.query(`ALTER USER ${user}@'localhost' IDENTIFIED BY ${password}`);
  await root.query(`GRANT ALL PRIVILEGES ON ${database}.* TO ${user}@'localhost'`);
  await root.end();

  const env = { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD };
  const openssl = spawn('openssl', [
    'enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '600000',
    '-pass', `file:${passwordPath}`,
    '-in', encryptedPath,
  ], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const mysqlProcess = spawn('mysql', [
    '--protocol=TCP', '-h', '127.0.0.1', '-P', String(Number(process.env.DB_PORT) || 3306),
    '-u', process.env.DB_USER, process.env.DB_NAME,
  ], { env, stdio: ['pipe', 'inherit', 'inherit'] });

  openssl.stdout.pipe(mysqlProcess.stdin);

  const [opensslResult, mysqlResult] = await Promise.all([
    waitForProcess(openssl),
    waitForProcess(mysqlProcess),
  ]);
  if (opensslResult.status !== 0 || mysqlResult.status !== 0) {
    process.exit(opensslResult.status || mysqlResult.status || 1);
  }
}

function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status: status === null ? 1 : status, signal }));
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
