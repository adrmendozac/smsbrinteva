const mysql = require('mysql2/promise');

const UTC_SESSION_SQL = "SET time_zone = '+00:00'";

// mysql2's timezone option controls conversion between MySQL date/time values
// and JavaScript Date objects. It does not change SQL functions such as NOW(),
// so every connection also needs its MySQL session pinned to UTC.
function utcOptions(options) {
  return { ...options, timezone: 'Z' };
}

function createUtcPool(options, driver = mysql) {
  const pool = driver.createPool(utcOptions(options));

  // mysql2 emits this before handing a new connection to the first caller.
  // Queuing SET here therefore puts it ahead of that caller's query. If the
  // session cannot be made safe, destroy it instead of silently using local
  // time for the throughput budget.
  pool.on('connection', (connection) => {
    connection.query(UTC_SESSION_SQL, (err) => {
      if (!err) return;
      console.error('Failed to set MySQL session timezone to UTC:', err.message);
      connection.destroy();
    });
  });

  return pool;
}

async function createUtcConnection(options, driver = mysql) {
  const connection = await driver.createConnection(utcOptions(options));
  try {
    await connection.query(UTC_SESSION_SQL);
    return connection;
  } catch (err) {
    await connection.end().catch(() => {});
    throw err;
  }
}

module.exports = {
  UTC_SESSION_SQL,
  utcOptions,
  createUtcPool,
  createUtcConnection,
};
