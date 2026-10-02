/**
 * coerceArgsToSchema — repair the shape slips small models make in tool args.
 *
 * A 4B model will send `"groups": "Deities:: Quetzalcoatl, Tlaloc"` where the
 * schema says an array of strings, or a single `{ name, ... }` where it says an
 * array of objects. The tools all read those as `(groups || []).map(...)`, and a
 * string has no .map: the call failed with "(i || []).map is not a function",
 * which tells the model nothing it can act on, so it retried the same call.
 *
 * Walks the tool's JSON schema alongside the args:
 *   - array expected, one value of the item type given → wrapped in an array
 *   - array expected, a JSON array written as a string → parsed
 *   - anything else is left as it was, for the tool to handle: several tools
 *     deliberately drop a malformed list and carry on with the rest of the call,
 *     and refusing the whole call here would turn that into a failure.
 * Objects and array items are walked recursively, so nested specs
 * (layers[].definition.groups) get the same treatment.
 *
 * Returns a new args object; the input is not mutated.
 *
 * ⚠️ Imported (via tools/index.js) by redstring-mcp-server.js — console.error only.
 */

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object' | 'undefined'
}

/** Does `value` fit the item schema well enough to be wrapped as a one-item array? */
function fitsItem(value, itemSchema) {
  const want = itemSchema?.type;
  const got = typeOf(value);
  if (!want) return got === 'string' || got === 'object';
  if (want === 'integer') return got === 'number';
  return want === got;
}

function coerceValue(value, schema) {
  if (value === undefined || value === null || !schema) return value;

  if (schema.type === 'array') {
    let arr = value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('[')) {
        try { arr = JSON.parse(trimmed); } catch { /* fall through */ }
      }
    }
    if (!Array.isArray(arr)) {
      if (!fitsItem(arr, schema.items)) return value;
      arr = [arr];
    }
    return arr.map((item) => coerceValue(item, schema.items));
  }

  if (schema.type === 'object' && typeOf(value) === 'object' && schema.properties) {
    return coerceObject(value, schema);
  }

  return value;
}

function coerceObject(obj, schema) {
  const out = { ...obj };
  for (const [key, propSchema] of Object.entries(schema.properties || {})) {
    if (key in out) out[key] = coerceValue(out[key], propSchema);
  }
  return out;
}

export function coerceArgsToSchema(args, parametersSchema) {
  if (!args || typeOf(args) !== 'object' || !parametersSchema?.properties) return args;
  return coerceObject(args, parametersSchema);
}
