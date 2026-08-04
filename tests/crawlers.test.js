const test = require('node:test');
const assert = require('node:assert');

test('crawler protection applies a global noindex header and disallows every path', () => {
  const { registerCrawlerProtection, X_ROBOTS_TAG } = require('../lib/crawlers');
  let middleware = null;
  let robotsHandler = null;
  const app = {
    use(fn) { middleware = fn; },
    get(path, fn) { if (path === '/robots.txt') robotsHandler = fn; },
  };

  registerCrawlerProtection(app);

  const headers = {};
  let nextCalled = false;
  middleware({}, { set(name, value) { headers[name] = value; } }, () => { nextCalled = true; });
  assert.equal(headers['X-Robots-Tag'], X_ROBOTS_TAG);
  assert.equal(X_ROBOTS_TAG, 'noindex, nofollow, noarchive, nosnippet, noimageindex');
  assert.equal(nextCalled, true);

  let type = null;
  let body = null;
  robotsHandler({}, {
    type(value) { type = value; return this; },
    send(value) { body = value; return this; },
  });
  assert.equal(type, 'text/plain');
  assert.equal(body, 'User-agent: *\nDisallow: /\n');
});
