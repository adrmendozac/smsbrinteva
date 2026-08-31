const test = require('node:test');
const assert = require('node:assert/strict');
const { handleUpload } = require('../lib/media');

function fakeResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('Multer file-size errors return the media route JSON 413 response', () => {
  const error = Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' });
  const upload = (_req, _res, done) => done(error);
  const logs = [];
  const middleware = handleUpload(upload, {
    error(category, message, meta) {
      logs.push({ category, message, meta });
    }
  });
  const res = fakeResponse();
  let nextCalls = 0;

  middleware({}, res, () => { nextCalls += 1; });

  assert.equal(nextCalls, 0);
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { error: 'La imagen supera 5 MB.' });
  assert.deepEqual(logs, [{
    category: 'media',
    message: 'Error recibiendo imagen',
    meta: { code: 'LIMIT_FILE_SIZE', error: 'File too large' }
  }]);
});

test('successful Multer parsing continues to the media route handler', () => {
  const upload = (_req, _res, done) => done();
  const middleware = handleUpload(upload);
  const res = fakeResponse();
  let nextCalls = 0;

  middleware({}, res, () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
});

test('other Multer errors stay at the route boundary as JSON 400 responses', () => {
  const error = Object.assign(new Error('Unexpected field'), {
    code: 'LIMIT_UNEXPECTED_FILE'
  });
  const upload = (_req, _res, done) => done(error);
  const middleware = handleUpload(upload, { error() {} });
  const res = fakeResponse();

  middleware({}, res, () => assert.fail('must not reach the route handler'));

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'No se pudo procesar la imagen subida.' });
});
