// Verification for the carrier backfill's status handling
// (scripts/backfill-carriers.js).
//
// Number Insight reports failure INSIDE a 200 response via a numeric status,
// and those failures are not interchangeable: retrying a malformed number
// forever wastes money, while giving up on a throttled one leaves the contact
// permanently unresolved — which silently pins it to the strict T-Mobile
// bucket. No network or DB is touched; classify() is a pure function.
const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../scripts/backfill-carriers');
const { NON_MOBILE, INVALID } = require('../lib/throughput');

test('stores the network code for a resolved mobile number', () => {
  const v = classify({ status: 0, networkType: 'mobile', networkCode: '310260', carrierName: 'T-Mobile USA, Inc.' });
  assert.equal(v.action, 'store');
  assert.equal(v.networkCode, '310260');
  assert.equal(v.carrierName, 'T-Mobile USA, Inc.');
});

test('marks landline and virtual numbers as non-mobile', () => {
  for (const networkType of ['landline', 'virtual', 'unknown']) {
    const v = classify({ status: 0, networkType, networkCode: null, carrierName: 'Some Telco' });
    assert.equal(v.action, 'store');
    assert.equal(v.networkCode, NON_MOBILE, `${networkType} should not be treated as SMS-capable`);
  }
});

test('a mobile answer with no network code is not trusted as a carrier', () => {
  const v = classify({ status: 0, networkType: 'mobile', networkCode: null, carrierName: null });
  assert.equal(v.networkCode, NON_MOBILE);
});

test('transient failures are retried, not recorded', () => {
  for (const status of [1 /* throttled */, 5 /* internal */, 9 /* partner quota */]) {
    assert.equal(classify({ status }).action, 'retry', `status ${status} must be retryable`);
  }
});

test('an unusable number is recorded once and never retried', () => {
  const v = classify({ status: 3 });
  assert.equal(v.action, 'store');
  assert.equal(v.networkCode, INVALID);
});

test('bad credentials abort the run instead of burning a lookup per contact', () => {
  assert.equal(classify({ status: 4 }).action, 'abort');
});

test('an unrecognized status is retried rather than stored as fact', () => {
  assert.equal(classify({ status: 42 }).action, 'retry');
});
