/**
 * Turns a failed fetch into something a participant can act on: a short
 * cause instead of the raw Node or OpenSSL reason, and the next step for
 * the script that is running. Node's fetch throws `TypeError('fetch failed')`
 * with the socket error as `cause` (code ENOTFOUND, ECONNREFUSED, EPROTO,
 * ...); a timeout rejects with a `TimeoutError` (AbortSignal.timeout).
 */
const MAX_CAUSE_LENGTH = 80;
const MS_PER_SECOND = 1000;
const TLS_PATTERN = /\b(SSL|TLS|EPROTO|CERT|certificate|self[- ]signed)/i;
const SHORT_CAUSES: Readonly<Record<string, string>> = {
  ENOTFOUND: 'host not found',
  EAI_AGAIN: 'host not found',
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EPIPE: 'connection reset',
  ETIMEDOUT: 'connection timed out',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
};
/** pnpm built-ins that shadow our scripts; they need `pnpm run`. */
const SHADOWED_SCRIPTS = new Set(['profile', 'doctor']);

interface ErrorLike {
  readonly name?: unknown;
  readonly message?: unknown;
  readonly code?: unknown;
  readonly cause?: unknown;
}

const asErrorLike = (value: unknown): ErrorLike | undefined =>
  value && typeof value === 'object' ? (value as ErrorLike) : undefined;

const firstLine = (text: string): string => {
  const line = text.split('\n')[0]?.trim() ?? '';
  return line.length > MAX_CAUSE_LENGTH ? `${line.slice(0, MAX_CAUSE_LENGTH)}...` : line;
};

/** "host not found", "TLS handshake failed", "no answer within 3 s", ... */
export const shortCause = (error: unknown, timeoutMs: number): string => {
  const outer = asErrorLike(error);
  if (outer?.name === 'TimeoutError' || outer?.name === 'AbortError') {
    return `no answer within ${timeoutMs / MS_PER_SECOND} s`;
  }
  const inner = asErrorLike(outer?.cause) ?? outer;
  const code = typeof inner?.code === 'string' ? inner.code : '';
  const message = typeof inner?.message === 'string' ? inner.message : String(error);
  if (TLS_PATTERN.test(code) || TLS_PATTERN.test(message)) return 'TLS handshake failed';
  const known = SHORT_CAUSES[code];
  if (known) return known;
  return firstLine(message) || 'network error';
};

/** What to do next, for the pnpm script that is running (npm_lifecycle_event). */
export const nextStepFor = (script: string | undefined): string => {
  if (!script) return 'run the command again with MODEL_MODE=mock in front and tell the floater';
  if (script.startsWith('check:')) return `run pnpm ${script} --static and tell the floater`;
  if (script === 'doctor') return 'tell the floater';
  const command = SHADOWED_SCRIPTS.has(script) ? `pnpm run ${script}` : `pnpm ${script}`;
  return `run MODEL_MODE=mock ${command} and tell the floater`;
};
