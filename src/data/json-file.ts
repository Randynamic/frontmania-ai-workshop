import { readFileSync } from 'node:fs';
import type { z } from 'zod';

/** Reads and validates a JSON file; the error names the file and the first schema issue. */
export const readJsonFile = <T extends z.ZodType>(path: string, schema: T): z.infer<T> => {
  const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? ` at ${first.path.join('.') || '<root>'}: ${first.message}` : '';
    throw new Error(`${path} does not match its schema${where}`);
  }
  return parsed.data;
};
