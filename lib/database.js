const mysql = require('mysql2/promise');

const UTC_SESSION_SQL = "SET time_zone = '+00:00'";

// mysql2's timezone option controls conversion between MySQL date/time values
// and JavaScript Date objects. It does not change SQL functions such as NOW(),
// so every connection also needs its MySQL session pinned to UTC.
function utcOptions(options) {
  return { ...options, timezone: 'Z' };
}

function createUtcPool(options, driver = mysql, log) {
  const pool = driver.createPool(utcOptions(options));
  let reportingSessionError = false;

  function reportSessionError(err) {
    const message = 'No se pudo configurar la zona horaria UTC de MySQL';
    if (!log || typeof log.error !== 'function' || reportingSessionError) {
      console.error(`${message}:`, err.message);
      return;
    }

    // The structured logger writes to this same pool. Guard against a second
    // connection failing while that write is in flight, which would otherwise
    // recurse indefinitely while the database is unavailable or misconfigured.
    reportingSessionError = true;
    Promise.resolve(log.error('system', message, { error: err.message }))
      .catch((logErr) => {
        console.error('[database] structured log failed:', logErr.message);
      })
      .finally(() => {
        reportingSessionError = false;
      });
  }

  // mysql2 emits this before handing a new connection to the first caller.
  // Queuing SET here therefore puts it ahead of that caller's query. If the
  // session cannot be made safe, destroy it instead of silently using local
  // time for the throughput budget.
  pool.on('connection', (connection) => {
    connection.query(UTC_SESSION_SQL, (err) => {
      if (!err) return;
      reportSessionError(err);
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
