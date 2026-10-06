import { describe, expect, test } from 'vitest';
import { describeNetworkError, TLS_REASON } from './network-error.js';

const TIMEOUT_MS = 3_000;

/** The shapes below were observed with Node 22 on 26 Sep 2026 (see the module comment). */
const fetchFailed = (cause: Record<string, unknown>): Error =>
  Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(), cause) });

describe('describeNetworkError', () => {
  test('reduces an OpenSSL handshake failure to one short reason', () => {
    // Arrange
    const error = fetchFailed({
      code: 'ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE',
      reason: 'ssl/tls alert handshake failure',
      message:
        'C0A0D50202000000:error:0A000410:SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:908:SSL alert number 40',
    });

    // Act
    const reason = describeNetworkError(error, TIMEOUT_MS);

    // Assert
    expect(reason).toBe(TLS_REASON);
    expect(reason).not.toContain('openssl');
  });

  test('prefers the cause code for DNS and connection errors', () => {
    expect(
      describeNetworkError(
        fetchFailed({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND ws.example' }),
        TIMEOUT_MS,
      ),
    ).toBe('ENOTFOUND');
    expect(
      describeNetworkError(fetchFailed({ code: 'ECONNREFUSED', message: 'connect' }), TIMEOUT_MS),
    ).toBe('ECONNREFUSED');
  });

  test('names the timeout in seconds', () => {
    // Arrange
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });

    // Act / Assert
    expect(describeNetworkError(timeout, TIMEOUT_MS)).toBe('no answer within 3 s');
  });

  test('falls back to the first segment of the cause message, capped at 60 characters', () => {
    expect(describeNetworkError(fetchFailed({ message: 'bad port' }), TIMEOUT_MS)).toBe('bad port');
    const long = fetchFailed({ message: `${'x'.repeat(80)}: second segment` });
    const reason = describeNetworkError(long, TIMEOUT_MS);
    expect(reason.length).toBeLessThanOrEqual(60);
    expect(reason.endsWith('…')).toBe(true);
  });

  test('never throws on non-error input', () => {
    expect(describeNetworkError('boom', TIMEOUT_MS)).toBe('boom');
    expect(describeNetworkError(undefined, TIMEOUT_MS)).toBe('unknown error');
    expect(describeNetworkError(new Error(''), TIMEOUT_MS)).toBe('unknown error');
  });
});
