// Kommo CRM payload shapes, exercised through the injected axios the module
// already takes. No network, no credentials.
const test = require('node:test');
const assert = require('node:assert');
const kommoCrm = require('../lib/kommoCrm');

// crmRequest calls axios(config) directly, so a function stands in for it.
function fakeAxios(response = { status: 200, data: {} }) {
  const calls = [];
  const axios = async (config) => { calls.push(config); return response; };
  return { axios, calls };
}

const creds = { subdomain: 'brinteva', token: 'secret-token' };

test('createLeadNote nests the body inside params', async () => {
  const { axios, calls } = fakeAxios();
  const ok = await kommoCrm.createLeadNote({ axios, ...creds, leadId: 42, text: 'Primer mensaje: "Hola"' });

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://brinteva.kommo.com/api/v4/leads/42/notes');

  const [note] = calls[0].data;
  assert.equal(note.note_type, 'common');
  // The exact shape Kommo's 400 demanded: params.text, not a sibling `text`.
  assert.deepEqual(note.params, { text: 'Primer mensaje: "Hola"' });
  assert.equal('text' in note, false, 'a sibling `text` is what caused FieldMissing');
});

test('createLeadNote coerces a missing body instead of sending undefined', async () => {
  const { axios, calls } = fakeAxios();
  await kommoCrm.createLeadNote({ axios, ...creds, leadId: 1, text: undefined });
  assert.deepEqual(calls[0].data[0].params, { text: '' });
});

test('createLeadNote reports failure rather than throwing', async () => {
  const { axios } = fakeAxios({ status: 400, data: { title: 'Bad Request' } });
  assert.equal(await kommoCrm.createLeadNote({ axios, ...creds, leadId: 1, text: 'x' }), null);

  const throwing = async () => { throw new Error('ECONNRESET'); };
  assert.equal(await kommoCrm.createLeadNote({ axios: throwing, ...creds, leadId: 1, text: 'x' }), null);
});

test('the note carries an Authorization bearer and JSON content type', async () => {
  const { axios, calls } = fakeAxios();
  await kommoCrm.createLeadNote({ axios, ...creds, leadId: 7, text: 'x' });
  assert.equal(calls[0].headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
});
