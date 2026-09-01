const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  UTC_SESSION_SQL,
  createUtcPool,
  createUtcConnection,
} = require('../lib/database');

test('pool pins both mysql2 conversion and every MySQL session to UTC', () => {
  const pool = new EventEmitter();
  let options;
  const driver = {
    createPool(value) {
      options = value;
      return pool;
    },
  };

  const queries = [];
  createUtcPool({ host: 'database', timezone: 'local' }, driver);
  pool.emit('connection', {
    query(sql, callback) {
      queries.push(sql);
      callback(null);
    },
  });

  assert.equal(options.timezone, 'Z');
  assert.deepEqual(queries, [UTC_SESSION_SQL]);
});

test('pool destroys a connection that cannot be pinned to UTC', () => {
  const pool = new EventEmitter();
  const driver = { createPool: () => pool };
  let destroyed = false;
  const originalError = console.error;
  console.error = () => {};

  try {
    createUtcPool({}, driver);
    pool.emit('connection', {
      query(_sql, callback) {
        callback(new Error('session setup failed'));
      },
      destroy() {
        destroyed = true;
      },
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(destroyed, true);
});

test('standalone connections are UTC before they are returned', async () => {
  const calls = [];
  let options;
  const connection = {
    async query(sql) {
      calls.push(sql);
    },
  };
  const driver = {
    async createConnection(value) {
      options = value;
      return connection;
    },
  };

  const result = await createUtcConnection({ database: 'sms', timezone: '-08:00' }, driver);

  assert.equal(result, connection);
  assert.equal(options.timezone, 'Z');
  assert.deepEqual(calls, [UTC_SESSION_SQL]);
});

test('standalone connection closes when UTC session setup fails', async () => {
  let ended = false;
  const driver = {
    async createConnection() {
      return {
        async query() {
          throw new Error('session setup failed');
        },
        async end() {
          ended = true;
        },
      };
    },
  };

  await assert.rejects(() => createUtcConnection({}, driver), /session setup failed/);
  assert.equal(ended, true);
});
