const test = require('node:test');
const assert = require('node:assert/strict');
const { registerWebhookRoutes } = require('../lib/webhooks');

test('ordinary inbound SMS is stored and mirrored for a human without an AI reply', async () => {
  const routes = new Map();
  const app = {
    post(path, handler) {
      routes.set(path, handler);
    },
  };
  const queries = [];
  const db = {
    async execute(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('SELECT id FROM contacts')) return [[{ id: 7 }]];
      if (sql.includes('SELECT id FROM conversations')) return [[]];
      if (sql.includes('INSERT INTO conversations')) return [{ insertId: 11 }];
      if (sql.includes('INSERT INTO messages')) return [{ insertId: 13 }];
      return [{}];
    },
  };
  const mirrored = [];
  const sent = [];
  registerWebhookRoutes(app, {
    db,
    log: { info() {}, warn() {}, error() {} },
    sendSMS: async (...args) => sent.push(args),
    mirrorInboundToKommo: async value => mirrored.push(value),
    mirrorOutboundToKommo: async () => {},
    pushKommoDeliveryStatus: async () => {},
    sendKommoTyping: async () => {},
  });

  let status;
  await routes.get('/inbound')(
    { body: { from: '15551234567', text: 'Quiero informacion', message_uuid: 'msg-1' } },
    { sendStatus(value) { status = value; } }
  );

  assert.equal(status, 200);
  assert.equal(sent.length, 0);
  assert.equal(mirrored.length, 1);
  assert.equal(mirrored[0].text, 'Quiero informacion');
  const conversationInsert = queries.find(({ sql }) => sql.includes('INSERT INTO conversations'));
  assert.match(conversationInsert.sql, /'needs_human'/);
  assert.equal(queries.some(({ sql }) => sql.includes('FROM promotions')), false);
});
