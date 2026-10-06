/**
 * Turns a failed fetch into one short reason for the doctor line.
 *
 * Observed shapes (Node 22 undici, 26 Sep 2026): a TLS failure carries
 * `cause.code = 'ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE'` and a 200-character
 * OpenSSL message; DNS carries `cause.code = 'ENOTFOUND'`; a bad port has only
 * `cause.message = 'bad port'`; `AbortSignal.timeout` throws a top-level
 * `TimeoutError` without a cause. Nobody in the room should read OpenSSL.
 */

const MAX_REASON_LENGTH = 60;
const MS_PER_SECOND = 1_000;
const TLS_CODE_PATTERN = /SSL|TLS|CERT/;
const TIMEOUT_NAMES = new Set(['TimeoutError', 'AbortError']);
export const TLS_REASON = 'TLS handshake failed';

interface ErrorLike {
  readonly name?: unknown;
  readonly message?: unknown;
  readonly cause?: unknown;
  readonly code?: unknown;
}

const asErrorLike = (value: unknown): ErrorLike =>
  typeof value === 'object' && value !== null ? (value as ErrorLike) : {};

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const cap = (text: string): string =>
  text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH - 1)}…` : text;

const firstSegment = (message: string): string => message.split(':')[0]?.trim() || message;

export const describeNetworkError = (error: unknown, timeoutMs: number): string => {
  const top = asErrorLike(error);
  if (typeof top.name === 'string' && TIMEOUT_NAMES.has(top.name)) {
    return `no answer within ${timeoutMs / MS_PER_SECOND} s`;
  }
  const cause = asErrorLike(top.cause);
  const code = nonEmptyString(cause.code) ?? nonEmptyString(top.code);
  if (code && TLS_CODE_PATTERN.test(code)) return TLS_REASON;
  if (code) return code;
  const message =
    nonEmptyString(cause.message) ??
    nonEmptyString(top.message) ??
    (typeof error === 'string' ? error : 'unknown error');
  return cap(firstSegment(message));
};
