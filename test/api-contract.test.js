'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { schema, validate } = require('../shared/api-contract');

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
