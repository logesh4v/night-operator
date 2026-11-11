// Minimal JSON Schema (draft 2020-12 subset) validator, dependency-free.
// shortcut: supports only the keywords episode.schema.json uses (type, const, enum, required,
// properties, additionalProperties:false, items, prefixItems, min/maxItems, minLength, pattern,
// minimum, maximum, oneOf, local $ref, format date-time); upgrade to Ajv if the contract grows.

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);

function resolve(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  return ref.slice(2).split('/').reduce((n, k) => n[k], root);
}

function check(root, schema, value, path, errors) {
  if (schema.$ref) return check(root, resolve(root, schema.$ref), value, path, errors);
  if (schema.oneOf) {
    const attempts = schema.oneOf.map((s) => { const e = []; check(root, s, value, path, e); return e; });
    const passing = attempts.filter((e) => e.length === 0).length;
    if (passing !== 1) {
      // Report the branch that matched `kind` best, otherwise the generic message.
      const kind = value && typeof value === 'object' ? value.kind : undefined;
      const idx = schema.oneOf.findIndex((s) => s.properties?.kind?.const === kind);
      if (idx >= 0 && passing === 0) errors.push(...attempts[idx]);
      else errors.push({ path, message: passing === 0 ? 'matches none of the allowed shapes' : 'matches more than one shape' });
    }
    return;
  }
  if ('const' in schema && value !== schema.const) errors.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.includes(value)) errors.push({ path, message: `must be one of ${schema.enum.join(', ')}` });
  if (schema.type && !isType(value, schema.type)) { errors.push({ path, message: `must be ${schema.type}` }); return; }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: 'must not be empty' });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path, message: `must match ${schema.pattern}` });
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push({ path, message: 'must be an ISO date-time' });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `must be >= ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `must be <= ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: `needs at least ${schema.minItems} item(s)` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, message: `allows at most ${schema.maxItems} item(s)` });
    const prefix = schema.prefixItems ?? [];
    value.forEach((item, i) => {
      const s = prefix[i] ?? schema.items;
      if (s) check(root, s, item, `${path}[${i}]`, errors);
    });
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push({ path: `${path}.${key}`, message: 'is required' });
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) check(root, props[key], v, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push({ path: `${path}.${key}`, message: 'is not allowed' });
    }
  }
}

export function validateAgainstSchema(schema, value) {
  const errors = [];
  check(schema, schema, value, '$', errors);
  return errors;
}
