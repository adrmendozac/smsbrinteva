// Verification for the contact routes (lib/contacts.js), specifically the
// carrier fields GET /api/contacts/all has to carry.
//
// The composer's audience is a FILTER over this response rather than its own
// fetch, so the operator split is computed from these rows. When the endpoint
// omitted the carrier columns every contact reached carrierBrand() with no
// network code, fell to "unknown", and the panel showed a zero split against a
// book that was 1,047 of 1,244 resolved. The contract in
// shared/api-contract.js marks the fields optional, so nothing else catches
// their absence — hence this test.
//
// No database and no Express: db and the route table come in through the same
// injection seam the app uses.
const test = require('node:test');
const assert = require('node:assert');
const { registerContactRoutes } = require('../lib/contacts');
const { contracts, validate } = require('../shared/api-contract');

// Captures the handlers registerContactRoutes() installs, keyed by route.
function fakeApp() {
  const routes = new Map();
  const register = method => (path, _auth, handler) => routes.set(`${method} ${path}`, handler);
  return { get: register('GET'), post: register('POST'), patch: register('PATCH'), routes };
}

function fakeRes() {
  return {
    body: null,
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

// One resolved and one unresolved row, shaped as MySQL returns them: opted_in
// arrives as 0/1, and an unresolved contact has NULL in all three columns.
const rows = [
  {
    id: 2, phone: '19253398990', name: 'Adrian Mendoza', opted_in: 1, archived_at: null,
    carrier_network_code: '310260', carrier_name: 'T-mobile USA, Inc.',
    carrier_checked_at: new Date('2026-08-14T00:44:17.000Z')
  },
  {
    id: 3, phone: '15550001111', name: null, opted_in: 1, archived_at: null,
    carrier_network_code: null, carrier_name: null, carrier_checked_at: null
  }
];

function appWithDb(queryRows) {
  const app = fakeApp();
  const queries = [];
  const db = {
    async execute(sql, params) { queries.push({ sql, params }); return [queryRows]; }
  };
  registerContactRoutes(app, { db, log: () => {} }, (req, res, next) => next());
  return { app, queries };
}

test('the directory query selects the carrier columns the audience tally needs', async () => {
  const { app, queries } = appWithDb(rows);
  const res = fakeRes();

  await app.routes.get('GET /api/contacts/all')({}, res);

  const sql = queries[0].sql;
  for (const column of ['carrier_network_code', 'carrier_name', 'carrier_checked_at']) {
    assert.match(sql, new RegExp(column), `${column} must be selected or the split reads zero`);
  }
});

test('GET /api/contacts/all returns the carrier fields, resolved and unresolved alike', async () => {
  const { app } = appWithDb(rows);
  const res = fakeRes();

  await app.routes.get('GET /api/contacts/all')({}, res);

  const [resolved, unresolved] = res.body;
  assert.equal(resolved.carrier_network_code, '310260');
  assert.equal(resolved.carrier_name, 'T-mobile USA, Inc.');
  assert.ok(resolved.carrier_checked_at, 'a resolved contact must carry its lookup timestamp');

  // An unresolved contact still carries the keys, explicitly null. The UI reads
  // that as "unknown" and budgets it as T-Mobile, which is the safe direction.
  assert.equal(unresolved.carrier_network_code, null);
  assert.equal(unresolved.carrier_name, null);
  assert.equal(unresolved.carrier_checked_at, null);
});

test('the directory response satisfies the shared contact contract', async () => {
  const { app } = appWithDb(rows);
  const res = fakeRes();

  await app.routes.get('GET /api/contacts/all')({}, res);

  // Dates leave Express as ISO strings; mirror that before validating.
  const payload = JSON.parse(JSON.stringify(res.body));
  const result = validate(contracts.contactList, payload);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test('a contact read without the carrier columns omits them rather than claiming null', async () => {
  // The create and edit handlers re-read a contact with a narrower SELECT. If
  // shape() asserted null there, a client merging that response would wipe the
  // carrier data it already held and drop the contact to "unknown".
  const narrowRow = { id: 4, phone: '15550002222', name: 'Sin operador', opted_in: 1, archived_at: null };
  const { app } = appWithDb([narrowRow]);
  const res = fakeRes();

  await app.routes.get('GET /api/contacts/all')({}, res);

  assert.equal('carrier_network_code' in res.body[0], false);
  assert.equal('carrier_name' in res.body[0], false);
  assert.equal('carrier_checked_at' in res.body[0], false);
});
