// Runtime enforcement of shared/api-contract.js at the HTTP boundary.
//
// The contract module was written as the shared source of truth for the admin
// API's shapes, but until now nothing in the backend required it: it described
// the API instead of constraining it, and every handler kept its own ad-hoc
// `if (!name) return 400`. These middlewares put the contract in the request
// path, so a request that disagrees with it is rejected in one place, with the
// same message everywhere, instead of failing deeper in — or not at all.
//
// REQUESTS ONLY, deliberately. A response that fails its contract is our bug,
// not the caller's, and turning it into a 500 would take the panel down over a
// field the UI may not even read. Response shapes stay covered by tests
// (test/api-contract.test.js, tests/contacts-routes.test.js).
const { validate } = require('../shared/api-contract');

// The issues carry paths and messages, never values — a rejected login must not
// echo the PIN back into a response or a log line.
function reject(res, issues) {
  return res.status(400).json({ error: 'Solicitud inválida', issues });
}

function isEmpty(value) {
  return value == null
    || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

// `emptyAs` supplies the value to validate when the request carries no body at
// all — Express 5 leaves req.body undefined there. Both archive routes document
// "absent body means archive", so that default lives at the two call sites
// rather than loosening `archived` to optional for every caller.
function validateBody(contract, { emptyAs } = {}) {
  return (req, res, next) => {
    const value = emptyAs !== undefined && isEmpty(req.body) ? emptyAs : req.body;
    const result = validate(contract, value);
    if (!result.ok) return reject(res, result.issues);
    // Hand the handler the value that was actually validated, so a defaulted
    // body is what it reads.
    req.body = value;
    next();
  };
}

// Copies before validating: req.query and req.params are framework-owned (in
// Express 5 req.query is a getter), and the contract rejects unknown keys, so
// it has to see a plain object rather than whatever the router hands over.
function validateQuery(contract) {
  return (req, res, next) => {
    const result = validate(contract, { ...req.query });
    if (!result.ok) return reject(res, result.issues);
    next();
  };
}

function validateParams(contract) {
  return (req, res, next) => {
    const result = validate(contract, { ...req.params });
    if (!result.ok) return reject(res, result.issues);
    next();
  };
}

module.exports = { validateBody, validateQuery, validateParams };
