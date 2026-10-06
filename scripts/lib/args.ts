/** Tiny flag parser: --name value, --flag (boolean), positional. No dependency needed. */
export interface ParsedArgs {
  readonly flags: Readonly<Record<string, string | true>>;
  readonly positional: readonly string[];
}

/** Flags that never take a value, so `--dry-run extra` keeps `extra` positional. */
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'dry-run',
  'execute',
  'render-only',
  'static',
  'help',
]);

export const parseArgs = (
  argv: readonly string[],
  booleanFlags: ReadonlySet<string> = BOOLEAN_FLAGS,
): ParsedArgs => {
  const consumedValues = new Set<number>();
  const initial: ParsedArgs = { flags: {}, positional: [] };
  return argv.reduce<ParsedArgs>((acc, arg, index) => {
    if (consumedValues.has(index)) return acc;
    if (!arg.startsWith('--')) return { ...acc, positional: [...acc.positional, arg] };
    const name = arg.slice(2);
    const next = argv[index + 1];
    const takesValue = !booleanFlags.has(name) && next !== undefined && !next.startsWith('--');
    if (takesValue) consumedValues.add(index + 1);
    return { ...acc, flags: { ...acc.flags, [name]: takesValue ? (next as string) : true } };
  }, initial);
};

export const flagNumber = (args: ParsedArgs, name: string, fallback: number): number => {
  const raw = args.flags[name];
  if (raw === undefined || raw === true) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number, got ${raw}`);
  return value;
};
