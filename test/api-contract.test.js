'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { schema, validate, contracts } = require('../shared/api-contract');

function assertValid(contract, value) {
  assert.deepEqual(validate(contract, value), { ok: true, value });
}

function assertInvalid(contract, value, paths = []) {
  const result = validate(contract, value);
  assert.equal(result.ok, false);
  assert.ok(result.issues.length > 0);
  assert.deepEqual(result.issues.map((issue) => issue.path), paths);
  return result;
}

test('schema builders use the shared contract shape and clone variant arrays', () => {
  assert.deepEqual(schema.string({ minLength: 1 }), { kind: 'string', minLength: 1 });
  assert.deepEqual(schema.number(), { kind: 'number' });
  assert.deepEqual(schema.integer(), { kind: 'integer' });
  assert.deepEqual(schema.boolean(), { kind: 'boolean' });
  assert.deepEqual(schema.unknown(), { kind: 'unknown' });
  assert.deepEqual(schema.literal('ready'), { kind: 'literal', value: 'ready' });
  assert.deepEqual(schema.isoDateTime(), { kind: 'isoDateTime' });

  const item = schema.string();
  assert.deepEqual(schema.array(item, { minItems: 1 }), { kind: 'array', item, minItems: 1 });
  const fields = { name: schema.string() };
  assert.deepEqual(schema.object(fields, { allowUnknown: true }), { kind: 'object', fields, allowUnknown: true });
  assert.deepEqual(schema.optional(item), { kind: 'optional', inner: item });
  assert.deepEqual(schema.nullable(item), { kind: 'nullable', inner: item });

  const values = ['draft'];
  const enumContract = schema.enum(values);
  values.push('sent');
  assert.deepEqual(enumContract, { kind: 'enum', values: ['draft'] });

  const variants = [schema.string()];
  const unionContract = schema.union(variants);
  variants.push(schema.number());
  assert.deepEqual(unionContract, { kind: 'union', variants: [{ kind: 'string' }] });
});

test('validates string type, length, and pattern without coercion', () => {
  const contract = schema.string({ minLength: 2, maxLength: 4, pattern: /^[A-Z]+$/ });

  assertValid(contract, 'AB');
  assertInvalid(contract, 'A', ['']);
  assertInvalid(contract, 'ABCDE', ['']);
  assertInvalid(contract, 'Ab', ['']);
  assertInvalid(contract, 12, ['']);
  assertInvalid(schema.string(), true, ['']);
});

test('validates finite numbers, integer type, and numeric bounds', () => {
  const number = schema.number({ min: 1, max: 3 });

  assertValid(number, 2.5);
  assertInvalid(number, 0, ['']);
  assertInvalid(number, 4, ['']);
  assertInvalid(number, Infinity, ['']);
  assertInvalid(number, '2', ['']);
  assertValid(schema.integer({ min: -1, max: 2 }), 2);
  assertInvalid(schema.integer({ min: 1 }), 0, ['']);
  assertInvalid(schema.integer({ max: 2 }), 3, ['']);
  assertInvalid(schema.integer(), 1.5, ['']);
});

test('validates booleans, literals, enums, and unions without coercion', () => {
  assertValid(schema.boolean(), false);
  assertInvalid(schema.boolean(), 0, ['']);
  assertValid(schema.literal('ready'), 'ready');
  assertInvalid(schema.literal('ready'), 'waiting', ['']);
  assertValid(schema.enum(['draft', 'sent']), 'sent');
  assertInvalid(schema.enum(['draft', 'sent']), 'failed', ['']);

  const contract = schema.union([schema.integer(), schema.literal('all')]);
  assertValid(contract, 3);
  assertValid(contract, 'all');
  const result = assertInvalid(contract, false, ['']);
  assert.match(result.issues[0].message, /integer/i);
});

test('union stops after the first passing variant', () => {
  const contract = schema.union([schema.literal('ready'), { kind: 'malformed' }]);
  assertValid(contract, 'ready');
});

test('validates arrays, item paths, and item-count bounds', () => {
  const contract = schema.array(schema.integer(), { minItems: 1, maxItems: 2 });

  assertValid(contract, [1, 2]);
  assertInvalid(contract, [], ['']);
  assertInvalid(contract, [1, 2, 3], ['']);
  assertInvalid(contract, [1, '2'], ['[1]']);
  assertInvalid(contract, '1', ['']);
});

test('objects reject unknown keys by default and can allow them', () => {
  const strict = schema.object({ name: schema.string() });
  assertValid(strict, { name: 'Nicoll' });
  assertInvalid(strict, { name: 'Nicoll', role: 'admin' }, ['role']);

  const permissive = schema.object({ name: schema.string() }, { allowUnknown: true });
  const value = { name: 'Nicoll', role: 'admin' };
  assertValid(permissive, value);
});

test('minProperties counts present declared fields', () => {
  const contract = schema.object({
    name: schema.optional(schema.string()),
    active: schema.optional(schema.boolean()),
  }, { minProperties: 1, allowUnknown: true });

  assertInvalid(contract, { ignored: true }, ['']);
  assertValid(contract, { name: 'Nicoll' });
});

test('supports optional object properties and nullable values', () => {
  const contract = schema.object({
    name: schema.string({ minLength: 1 }),
    active: schema.optional(schema.boolean()),
    nickname: schema.nullable(schema.string()),
  });

  assertValid(contract, { name: 'Nicoll', nickname: null });
  assertInvalid(contract, { name: 'Nicoll' }, ['nickname']);
  assertInvalid(contract, { name: 'Nicoll', active: undefined, nickname: null }, ['active']);
  assertInvalid(schema.optional(schema.string()), undefined, ['']);
});

test('validates a strict object and preserves its value', () => {
  assert.deepEqual(
    validate(
      schema.object({ name: schema.string({ minLength: 1 }), active: schema.optional(schema.boolean()) }),
      { name: 'Nicoll' },
    ),
    { ok: true, value: { name: 'Nicoll' } },
  );
});

test('unknown accepts every value unchanged', () => {
  for (const value of [undefined, null, 'text', 4, false, { nested: true }, [1]]) {
    assertValid(schema.unknown(), value);
  }
});

test('validates exact UTC ISO date-time strings and calendar components', () => {
  const contract = schema.isoDateTime();

  for (const value of [
    '2026-07-31T00:00:00Z',
    '2024-02-29T23:59:59.1Z',
    '2024-02-29T23:59:59.12Z',
    '2024-02-29T23:59:59.123Z',
  ]) assertValid(contract, value);

  for (const value of [
    '2026-07-31',
    '2026-07-31T00:00:00+00:00',
    '2026-07-31T00:00:00.1234Z',
    '2026-7-31T00:00:00Z',
    '2023-02-29T00:00:00Z',
    '2024-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-01-01T24:00:00Z',
    0,
  ]) assertInvalid(contract, value, ['']);
});

test('accumulates independent nested issues with precise paths', () => {
  const contract = schema.object({
    contacts: schema.array(schema.object({
      id: schema.integer({ min: 1 }),
      profile: schema.object({ name: schema.string({ minLength: 1 }) }),
    })),
  });

  const result = assertInvalid(contract, {
    contacts: [
      { id: '1', profile: { name: '' }, extra: true },
      { id: 0, profile: { name: 'Nicoll' } },
    ],
  }, ['contacts[0].id', 'contacts[0].profile.name', 'contacts[0].extra', 'contacts[1].id']);

  assert.equal(result.issues.length, 4);
});

test('validates login request and response contracts', () => {
  assertValid(contracts.loginRequest, { pin: '1234' });
  assertValid(contracts.loginResponse, { token: 'signed.jwt.token' });
  assertInvalid(contracts.loginRequest, { pin: '' }, ['pin']);
  assertInvalid(contracts.loginResponse, { token: '' }, ['token']);
  assertInvalid(contracts.loginRequest, { pin: 1234 }, ['pin']);
});

test('validates raw Express id parameters without coercion', () => {
  assertValid(contracts.idParams, { id: '42' });
  assertInvalid(contracts.idParams, { id: '0' }, ['id']);
  assertInvalid(contracts.idParams, { id: 42 }, ['id']);
});

test('validates contact response shapes and lists', () => {
  const contact = {
    id: 1,
    phone: '19256658003',
    name: 'Nicoll',
    opted_in: true,
    archived_at: null,
  };

  assertValid(contracts.contact, contact);
  assertValid(contracts.contactList, [contact, {
    id: 2,
    phone: '19252628150',
    name: null,
  }]);
  assertInvalid(contracts.contact, { ...contact, id: 0 }, ['id']);
  assertInvalid(contracts.contact, { ...contact, archived_at: '2026-08-03' }, ['archived_at']);
});

test('validates create and update contact requests', () => {
  assertValid(contracts.createContactRequest, { name: 'Nicoll', phone: '19256658003' });
  assertValid(contracts.updateContactRequest, { name: '' });
  assertValid(contracts.updateContactRequest, { phone: '19252628150' });
  assertInvalid(contracts.createContactRequest, { name: 'Nicoll', phone: '' }, ['phone']);
  assertInvalid(contracts.updateContactRequest, {}, ['']);
  assertInvalid(contracts.updateContactRequest, { nickname: 'N' }, ['', 'nickname']);
});

test('validates archive request', () => {
  assertValid(contracts.archiveRequest, { archived: true });
  assertValid(contracts.archiveRequest, { archived: false });
  assertInvalid(contracts.archiveRequest, {}, ['archived']);
  assertInvalid(contracts.archiveRequest, { archived: 'true' }, ['archived']);
});

const campaignStatuses = ['draft', 'scheduled', 'sending', 'completed', 'failed'];
const recipientStatuses = ['pending', 'sent', 'delivered', 'failed', 'opted_out'];

function campaignValue(overrides = {}) {
  return {
    id: 7,
    name: 'Promo Italia',
    body: 'Brinteva Worlds: Viaja con nosotros',
    media_url: null,
    status: 'draft',
    scheduled_at: null,
    sent_count: 0,
    failed_count: 0,
    total_count: 2,
    created_by: 'admin',
    created_at: '2026-08-03T12:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

function recipientValue(overrides = {}) {
  return {
    id: 11,
    phone: '19256658003',
    name: 'Nicoll',
    status: 'pending',
    vonage_message_id: null,
    error: null,
    sent_at: null,
    ...overrides,
  };
}

test('validates campaign statuses and nullable response fields', () => {
  for (const status of campaignStatuses) {
    assertValid(contracts.campaign, campaignValue({ status }));
  }
  assertValid(contracts.campaign, campaignValue({
    media_url: 'https://sms.brintevaworlds.com/media/trip.jpg',
    scheduled_at: '2026-08-04T12:00:00Z',
    created_by: null,
    archived_at: '2026-08-05T12:00:00Z',
  }));
  assertValid(contracts.campaignList, [campaignValue()]);
  assertInvalid(contracts.campaign, campaignValue({ status: 'paused' }), ['status']);
  assertInvalid(contracts.campaign, campaignValue({ media_url: 'ftp://example.com/trip.jpg' }), ['media_url']);
});

test('validates recipient counts and recipient response fields', () => {
  for (const status of recipientStatuses) {
    assertValid(contracts.recipientCount, { status, n: 1 });
    assertValid(contracts.recipient, recipientValue({ status }));
  }
  assertValid(contracts.recipient, recipientValue({
    name: null,
    vonage_message_id: 'message-123',
    error: 'carrier rejected message',
    sent_at: '2026-08-03T12:30:00Z',
  }));
  assertInvalid(contracts.recipientCount, { status: 'unknown', n: 1 }, ['status']);
  assertInvalid(contracts.recipient, recipientValue({ sent_at: 'yesterday' }), ['sent_at']);
});

test('validates nested campaign details', () => {
  const detail = {
    ...campaignValue(),
    recipientCounts: [{ status: 'pending', n: 1 }],
    recipients: [recipientValue()],
  };
  assertValid(contracts.campaignDetail, detail);
  assertInvalid(contracts.campaignDetail, {
    ...detail,
    recipients: [recipientValue({ id: 0 })],
  }, ['recipients[0].id']);
});

test('validates campaign creation requests without coercing contact IDs', () => {
  const request = {
    name: 'Promo Italia',
    body: 'Brinteva Worlds: Viaja con nosotros',
    contactIds: [1, 2],
    phones: ['19256658003'],
    scheduledAt: null,
    mediaUrl: null,
  };
  assertValid(contracts.createCampaignRequest, request);
  assertValid(contracts.createCampaignRequest, {
    ...request,
    scheduledAt: '2026-08-04T12:00:00.000Z',
    mediaUrl: 'https://sms.brintevaworlds.com/media/trip.jpg',
  });

  const scalar = validate(contracts.createCampaignRequest, { ...request, contactIds: 7 });
  assert.deepEqual(scalar, {
    ok: false,
    issues: [{ path: 'contactIds', message: 'Expected array' }],
  });
  assertInvalid(contracts.createCampaignRequest, { ...request, contactIds: ['1'] }, ['contactIds[0]']);
  assertInvalid(contracts.createCampaignRequest, { ...request, phones: [''] }, ['phones[0]']);
  assertInvalid(contracts.createCampaignRequest, { ...request, mediaUrl: 'data:image/png;base64,abc' }, ['mediaUrl']);
});

test('validates campaign response envelopes', () => {
  assertValid(contracts.campaignCreatedResponse, { id: 7, total: 2 });
  assertValid(contracts.okResponse, { ok: true });
  assertValid(contracts.archiveCampaignResponse, {
    ok: true,
    id: 7,
    archived_at: '2026-08-03T12:00:00Z',
  });
  assertValid(contracts.archiveCampaignResponse, { ok: true, id: 7, archived_at: null });
  assertInvalid(contracts.campaignCreatedResponse, { id: 0, total: -1 }, ['id', 'total']);
});
