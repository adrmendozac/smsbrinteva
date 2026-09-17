// Kommo lead creation fallback: logging, the retry queue, and the scheduler
// retry pass. The db, logger, and Kommo helpers are all fakes.
const test = require('node:test');
const assert = require('node:assert/strict');
const kommoLeads = require('../lib/kommoLeads');
const kommo = require('../lib/kommo');

function fakeLog() {
  const entries = [];
  const push = level => (category, message, meta) => entries.push({ level, category, message, meta });
  return { entries, info: push('info'), warn: push('warn'), error: push('error') };
}

// Answers the few queries kommoLeads issues; `rows` stands in for the table.
function fakeDb({ pending = [], due = [], claimAffected = 1 } = {}) {
  const queries = [];
  return {
    queries,
    async execute(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('SELECT id FROM kommo_lead_retries')) return [pending];
      if (sql.includes('SELECT id, phone, first_message, attempts')) return [due];
      if (sql.includes('SET next_attempt_at = NOW() + INTERVAL ? MINUTE')) return [{ affectedRows: claimAffected }];
      return [{ affectedRows: 1 }];
    },
  };
}

function deps(overrides = {}) {
  const calls = { notes: [], tags: [] };
  return {
    calls,
    db: fakeDb(),
    log: fakeLog(),
    createSmsLead: async () => ({ leadId: 99, error: null }),
    createLeadNote: async args => { calls.notes.push(args); return true; },
    addLeadTags: async args => { calls.tags.push(args); return true; },
    ...overrides,
  };
}

const find = (db, fragment) => db.queries.filter(({ sql }) => sql.includes(fragment));

test('a created lead gets its note and tag and nothing is queued', async () => {
  const d = deps();
  const leadId = await kommoLeads.createInboundLead(d, { phone: '15551234567', text: 'Hola' });

  assert.equal(leadId, 99);
  assert.deepEqual(d.calls.notes, [{ leadId: 99, text: 'Primer mensaje: "Hola"' }]);
  assert.deepEqual(d.calls.tags, [{ leadId: 99, tags: ['sms'] }]);
  assert.equal(find(d.db, 'INSERT INTO kommo_lead_retries').length, 0);
  assert.equal(d.log.entries.length, 0);
});

test('a failed create is logged with log.warn and queued for retry', async () => {
  const d = deps({ createSmsLead: async () => ({ leadId: null, error: 'HTTP 400: bad field' }) });
  const leadId = await kommoLeads.createInboundLead(d, { phone: '15551234567', text: 'Hola' });

  assert.equal(leadId, null);
  assert.equal(d.log.entries.length, 1);
  assert.equal(d.log.entries[0].level, 'warn');
  assert.equal(d.log.entries[0].category, 'kommo');
  assert.deepEqual(d.log.entries[0].meta, { phone: '15551234567', error: 'HTTP 400: bad field' });

  const [insert] = find(d.db, 'INSERT INTO kommo_lead_retries');
  assert.deepEqual(insert.params, ['15551234567', 'Hola', 'HTTP 400: bad field', kommoLeads.RETRY_DELAYS_MINUTES[0]]);
  assert.equal(d.calls.notes.length, 0);
});

test('a thrown create error is treated as a failure, not a crash', async () => {
  const d = deps({ createSmsLead: async () => { throw new Error('socket hang up'); } });
  await kommoLeads.createInboundLead(d, { phone: '15551234567', text: 'Hola' });

  assert.equal(d.log.entries[0].level, 'warn');
  assert.equal(d.log.entries[0].meta.error, 'socket hang up');
  assert.equal(find(d.db, 'INSERT INTO kommo_lead_retries').length, 1);
});

test('a phone that already has a pending retry is not queued twice', async () => {
  const d = deps({
    db: fakeDb({ pending: [{ id: 5 }] }),
    createSmsLead: async () => ({ leadId: null, error: 'HTTP 500: down' }),
  });
  await kommoLeads.createInboundLead(d, { phone: '15551234567', text: 'Hola otra vez' });

  assert.equal(find(d.db, 'INSERT INTO kommo_lead_retries').length, 0);
  assert.equal(d.log.entries[0].level, 'warn');
});

test('an unconfigured CRM is skipped silently', async () => {
  const d = deps({ createSmsLead: async () => ({ skipped: true }) });
  const leadId = await kommoLeads.createInboundLead(d, { phone: '15551234567', text: 'Hola' });

  assert.equal(leadId, null);
  assert.equal(d.log.entries.length, 0);
  assert.equal(d.db.queries.length, 0);
});

test('note and tag failures are logged but keep the lead', async () => {
  const d = deps({ createLeadNote: async () => null, addLeadTags: async () => null });
  const leadId = await kommoLeads.createInboundLead(d, { phone: '15551234567', text: 'Hola' });

  assert.equal(leadId, 99);
  assert.deepEqual(d.log.entries.map(e => e.level), ['warn', 'warn']);
  assert.equal(find(d.db, 'INSERT INTO kommo_lead_retries').length, 0);
});

const dueRow = (attempts) => ({ id: 3, phone: '15551234567', first_message: 'Hola', attempts });

test('a successful retry marks the row done and adds the note and tag', async () => {
  const d = deps({ db: fakeDb({ due: [dueRow(2)] }) });
  await kommoLeads.retryPendingLeads(d);

  const [done] = find(d.db, "status = 'done'");
  assert.deepEqual(done.params, [3, 99, 3]);
  assert.equal(d.calls.notes.length, 1);
  assert.equal(d.calls.tags.length, 1);
  assert.equal(d.log.entries[0].level, 'info');
});

test('a failed retry is rescheduled with the next delay and logged', async () => {
  const d = deps({
    db: fakeDb({ due: [dueRow(1)] }),
    createSmsLead: async () => ({ leadId: null, error: 'HTTP 502: bad gateway' }),
  });
  await kommoLeads.retryPendingLeads(d);

  const [reschedule] = find(d.db, 'SET attempts = ?, last_error = ?, next_attempt_at');
  assert.deepEqual(reschedule.params, [2, 'HTTP 502: bad gateway', kommoLeads.RETRY_DELAYS_MINUTES[1], 3]);
  assert.equal(d.log.entries[0].level, 'warn');
});

test('the last failed attempt marks the row failed and logs an error', async () => {
  const d = deps({
    db: fakeDb({ due: [dueRow(kommoLeads.MAX_ATTEMPTS - 1)] }),
    createSmsLead: async () => ({ leadId: null, error: 'HTTP 400: bad field' }),
  });
  await kommoLeads.retryPendingLeads(d);

  const [failed] = find(d.db, "status = 'failed'");
  assert.deepEqual(failed.params, [kommoLeads.MAX_ATTEMPTS, 'HTTP 400: bad field', 3]);
  assert.equal(d.log.entries[0].level, 'error');
  assert.equal(d.log.entries[0].meta.attempts, kommoLeads.MAX_ATTEMPTS);
});

test('a row another tick already claimed is left alone', async () => {
  let created = 0;
  const d = deps({
    db: fakeDb({ due: [dueRow(1)], claimAffected: 0 }),
    createSmsLead: async () => { created++; return { leadId: 99, error: null }; },
  });
  await kommoLeads.retryPendingLeads(d);

  assert.equal(created, 0);
  assert.equal(find(d.db, "status = 'done'").length, 0);
});

test('createSmsLead reports the Kommo status and body on failure', async () => {
  const axios = async (config) => (config.method === 'GET'
    ? { status: 204, data: null }
    : { status: 400, data: { title: 'Bad Request' } });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await kommo.createSmsLead({
      axios, subdomain: 'brinteva', token: 't', pipelineId: 1, statusId: 2,
      mensajeClienteFieldId: 3, phone: '15551234567', name: null, text: 'Hola',
    });
    assert.deepEqual(result, { leadId: null, error: 'HTTP 400: {"title":"Bad Request"}' });
  } finally {
    console.error = originalError;
  }
});

test('createSmsLead returns the new lead id on success', async () => {
  const axios = async (config) => (config.method === 'GET'
    ? { status: 204, data: null }
    : { status: 200, data: [{ id: 555 }] });
  const result = await kommo.createSmsLead({
    axios, subdomain: 'brinteva', token: 't', pipelineId: 1, statusId: 2,
    mensajeClienteFieldId: 3, phone: '15551234567', name: null, text: 'Hola',
  });
  assert.deepEqual(result, { leadId: 555, error: null });
});
