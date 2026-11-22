import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Loads the published event schemas from docs/api/events. */
const dir = join(__dirname, '../../../docs/api/events');
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv as never); // ajv-formats may resolve a second ajv copy in the workspace
const schemas: Record<string, ReturnType<Ajv['compile']>> = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.schema.json'))) {
  schemas[f.replace('.schema.json', '')] = ajv.compile(JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

/** Returns validation errors (empty when valid). Throws if no schema exists for the name. */
export function contractErrors(name: string, data: unknown): string[] {
  const validate = schemas[name];
  if (!validate) throw new Error(`No published schema for ${name}`);
  return validate(data) ? [] : (validate.errors ?? []).map((e) => `${name}${e.instancePath} ${e.message}`);
}

export const schemaNames = () => Object.keys(schemas);
