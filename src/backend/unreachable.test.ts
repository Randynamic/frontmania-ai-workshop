import { describe, expect, test } from 'vitest';
import { nextStepFor, shortCause } from './unreachable.js';

const TIMEOUT_MS = 3_000;
const socketError = (code: string, message: string): Error =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });

describe('shortCause', () => {
  test.each([
    ['ENOTFOUND', 'getaddrinfo ENOTFOUND ws.example.upgraide.nl', 'host not found'],
    ['ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:8080', 'connection refused'],
    ['ETIMEDOUT', 'connect ETIMEDOUT 10.0.0.1:443', 'connection timed out'],
    [
      'EPROTO',
      'write EPROTO 00F8:error:0A00010B:SSL routines::wrong version number',
      'TLS handshake failed',
    ],
    [
      'ECONNRESET',
      'Client network socket disconnected before secure TLS connection was established',
      'TLS handshake failed',
    ],
    ['ECONNRESET', 'socket hang up', 'connection reset'],
    [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'unable to verify the first certificate',
      'TLS handshake failed',
    ],
  ])('%s (%s) reads as "%s"', (code, message, expected) => {
    expect(shortCause(socketError(code, message), TIMEOUT_MS)).toBe(expected);
  });

  test('a timeout names the wait', () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    expect(shortCause(timeout, TIMEOUT_MS)).toBe('no answer within 3 s');
  });

  test('an unknown cause keeps only its first line, cut short', () => {
    const cause = shortCause(new Error(`${'x'.repeat(120)}\nsecond line`), TIMEOUT_MS);
    expect(cause).not.toContain('second line');
    expect(cause.length).toBeLessThanOrEqual(83);
  });

  test('a non-error value still gives a reason', () => {
    expect(shortCause('boom', TIMEOUT_MS)).toBe('boom');
  });
});

describe('nextStepFor', () => {
  test('names the mock rerun of the running script, with run for pnpm built-ins', () => {
    expect(nextStepFor('ask')).toBe('run MODEL_MODE=mock pnpm ask and tell the floater');
    expect(nextStepFor('profile')).toBe(
      'run MODEL_MODE=mock pnpm run profile and tell the floater',
    );
  });

  test('check scripts point to their offline layer, doctor only to the floater', () => {
    expect(nextStepFor('check:03')).toBe('run pnpm check:03 --static and tell the floater');
    expect(nextStepFor('doctor')).toBe('tell the floater');
  });

  test('outside pnpm it still says what to do', () => {
    expect(nextStepFor(undefined)).toContain('MODEL_MODE=mock');
  });
});
