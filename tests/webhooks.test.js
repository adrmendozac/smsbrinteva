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

test('a failed Kommo lead on a new conversation is logged and queued for retry', async () => {
  const routes = new Map();
  const app = { post(path, handler) { routes.set(path, handler); } };
  const queries = [];
  const db = {
    async execute(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('SELECT id FROM contacts')) return [[{ id: 7 }]];
      if (sql.includes('SELECT id FROM conversations')) return [[]];
      if (sql.includes('INSERT INTO conversations')) return [{ insertId: 11 }];
      if (sql.includes('INSERT INTO messages')) return [{ insertId: 13 }];
      if (sql.includes('SELECT id FROM kommo_lead_retries')) return [[]];
      return [{}];
    },
  };
  const warnings = [];
  registerWebhookRoutes(app, {
    db,
    log: { info() {}, warn: (...args) => warnings.push(args), error() {} },
    sendSMS: async () => {},
    mirrorInboundToKommo: async () => {},
    mirrorOutboundToKommo: async () => {},
    pushKommoDeliveryStatus: async () => {},
    sendKommoTyping: async () => {},
    createSmsLead: async () => ({ leadId: null, error: 'HTTP 401: Unauthorized' }),
    createLeadNote: async () => true,
    addLeadTags: async () => true,
  });

  await routes.get('/inbound')(
    { body: { from: '15551234567', text: 'Quiero informacion', message_uuid: 'msg-2' } },
    { sendStatus() {} }
  );
  // Lead creation runs in the background; let it settle.
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], 'kommo');
  assert.deepEqual(warnings[0][2], { phone: '15551234567', error: 'HTTP 401: Unauthorized' });
  assert.equal(queries.filter(({ sql }) => sql.includes('INSERT INTO kommo_lead_retries')).length, 1);
});
