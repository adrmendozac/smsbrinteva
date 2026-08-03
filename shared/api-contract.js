'use strict';

const schema = {
  string(options = {}) {
    return { kind: 'string', ...options };
  },
  number(options = {}) {
    return { kind: 'number', ...options };
  },
  integer(options = {}) {
    return { kind: 'integer', ...options };
  },
  boolean() {
    return { kind: 'boolean' };
  },
  unknown() {
    return { kind: 'unknown' };
  },
  literal(value) {
    return { kind: 'literal', value };
  },
  enum(values) {
    return { kind: 'enum', values: [...values] };
  },
  union(variants) {
    return { kind: 'union', variants: [...variants] };
  },
  isoDateTime() {
    return { kind: 'isoDateTime' };
  },
  array(item, options = {}) {
    return { kind: 'array', item, ...options };
  },
  object(fields, options = {}) {
    return { kind: 'object', fields, ...options };
  },
  optional(inner) {
    return { kind: 'optional', inner };
  },
  nullable(inner) {
    return { kind: 'nullable', inner };
  },
};

function issue(path, message) {
  return { path, message };
}

function propertyPath(parent, property) {
  return parent ? `${parent}.${property}` : property;
}

function itemPath(parent, index) {
  return `${parent}[${index}]`;
}

function validateIsoDateTime(value) {
  if (typeof value !== 'string') return false;

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;

  const [, year, month, day, hour, minute, second, fraction = '0'] = match;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hour)
    && date.getUTCMinutes() === Number(minute)
    && date.getUTCSeconds() === Number(second)
    && date.getUTCMilliseconds() === Number(fraction.padEnd(3, '0'));
}

function inspect(contract, value, path, context = {}) {
  switch (contract.kind) {
    case 'unknown':
      return [];

    case 'string': {
      if (typeof value !== 'string') return [issue(path, 'Expected string')];
      const issues = [];
      if (contract.minLength !== undefined && value.length < contract.minLength) {
        issues.push(issue(path, `Expected at least ${contract.minLength} characters`));
      }
      if (contract.maxLength !== undefined && value.length > contract.maxLength) {
        issues.push(issue(path, `Expected at most ${contract.maxLength} characters`));
      }
      if (contract.pattern !== undefined) {
        contract.pattern.lastIndex = 0;
        if (!contract.pattern.test(value)) issues.push(issue(path, 'String does not match required pattern'));
      }
      return issues;
    }

    case 'number':
    case 'integer': {
      const isValidType = contract.kind === 'integer'
        ? Number.isInteger(value)
        : typeof value === 'number' && Number.isFinite(value);
      if (!isValidType) {
        return [issue(path, contract.kind === 'integer' ? 'Expected integer' : 'Expected finite number')];
      }
      const issues = [];
      if (contract.min !== undefined && value < contract.min) {
        issues.push(issue(path, `Expected number greater than or equal to ${contract.min}`));
      }
      if (contract.max !== undefined && value > contract.max) {
        issues.push(issue(path, `Expected number less than or equal to ${contract.max}`));
      }
      return issues;
    }

    case 'boolean':
      return typeof value === 'boolean' ? [] : [issue(path, 'Expected boolean')];

    case 'literal':
      return Object.is(value, contract.value) ? [] : [issue(path, `Expected literal ${String(contract.value)}`)];

    case 'enum':
      return contract.values.some((candidate) => Object.is(candidate, value))
        ? []
        : [issue(path, 'Expected an allowed enum value')];

    case 'union': {
      if (contract.variants.length === 0) return [issue(path, 'Expected a union value')];
      let firstIssues;
      for (const variant of contract.variants) {
        const issues = inspect(variant, value, path, context);
        if (issues.length === 0) return [];
        if (firstIssues === undefined) firstIssues = issues;
      }
      return firstIssues;
    }

    case 'isoDateTime':
      return validateIsoDateTime(value) ? [] : [issue(path, 'Expected a valid UTC ISO date-time')];

    case 'array': {
      if (!Array.isArray(value)) return [issue(path, 'Expected array')];
      const issues = [];
      if (contract.minItems !== undefined && value.length < contract.minItems) {
        issues.push(issue(path, `Expected at least ${contract.minItems} items`));
      }
      if (contract.maxItems !== undefined && value.length > contract.maxItems) {
        issues.push(issue(path, `Expected at most ${contract.maxItems} items`));
      }
      value.forEach((item, index) => {
        issues.push(...inspect(contract.item, item, itemPath(path, index), context));
      });
      return issues;
    }

    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return [issue(path, 'Expected object')];
      }

      const issues = [];
      let presentProperties = 0;
      for (const [name, propertyContract] of Object.entries(contract.fields)) {
        const hasProperty = Object.prototype.hasOwnProperty.call(value, name);
        if (!hasProperty) {
          if (propertyContract.kind !== 'optional') {
            issues.push(issue(propertyPath(path, name), 'Required property is missing'));
          }
          continue;
        }

        presentProperties += 1;
        const inner = propertyContract.kind === 'optional' ? propertyContract.inner : propertyContract;
        issues.push(...inspect(inner, value[name], propertyPath(path, name), { objectProperty: true }));
      }

      if (contract.minProperties !== undefined && presentProperties < contract.minProperties) {
        issues.push(issue(path, `Expected at least ${contract.minProperties} declared properties`));
      }

      if (!contract.allowUnknown) {
        for (const name of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(contract.fields, name)) {
            issues.push(issue(propertyPath(path, name), 'Unknown property'));
          }
        }
      }
      return issues;
    }

    case 'optional':
      return [issue(path, context.objectProperty ? 'Expected optional value' : 'Optional is only valid for object properties')];

    case 'nullable':
      return value === null ? [] : inspect(contract.inner, value, path, context);

    default:
      throw new TypeError(`Unknown schema kind: ${String(contract.kind)}`);
  }
}

function validate(contract, value) {
  const issues = inspect(contract, value, '');
  return issues.length === 0 ? { ok: true, value } : { ok: false, issues };
}

const positiveInteger = schema.integer({ min: 1 });
const idString = schema.string({ pattern: /^[1-9]\d*$/ });
const phoneString = schema.string({ minLength: 1, maxLength: 32 });
const contactName = schema.string({ maxLength: 255 });

const contact = schema.object({
  id: positiveInteger,
  phone: phoneString,
  name: schema.nullable(contactName),
  opted_in: schema.optional(schema.boolean()),
  archived_at: schema.optional(schema.nullable(schema.isoDateTime())),
});

const contracts = Object.freeze({
  loginRequest: schema.object({
    pin: schema.string({ minLength: 1, maxLength: 64 }),
  }),
  loginResponse: schema.object({
    token: schema.string({ minLength: 1, maxLength: 8192 }),
  }),
  idParams: schema.object({
    id: idString,
  }),
  contact,
  contactList: schema.array(contact),
  createContactRequest: schema.object({
    name: contactName,
    phone: phoneString,
  }),
  updateContactRequest: schema.object({
    name: schema.optional(contactName),
    phone: schema.optional(phoneString),
  }, { minProperties: 1 }),
  archiveRequest: schema.object({
    archived: schema.boolean(),
  }),
});

module.exports = { schema, validate, contracts };
