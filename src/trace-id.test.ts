import { describe, expect, test } from 'vitest';
import { isOtelTraceId, toMlflowTraceId, toOtelTraceId } from './trace-id.js';

describe('trace ids', () => {
  test('maps the observed OTel id to the observed MLflow id', () => {
    expect(toMlflowTraceId('446ae47eb395812155265a4e51014e75')).toBe(
      'tr-446ae47eb395812155265a4e51014e75',
    );
  });

  test('is idempotent, normalises case and whitespace, and rejects junk', () => {
    expect(toMlflowTraceId('tr-446ae47eb395812155265a4e51014e75')).toBe(
      'tr-446ae47eb395812155265a4e51014e75',
    );
    expect(toMlflowTraceId(' 446AE47EB395812155265A4E51014E75 ')).toBe(
      'tr-446ae47eb395812155265a4e51014e75',
    );
    expect(() => toMlflowTraceId('not-a-trace')).toThrow('32-hex');
    expect(isOtelTraceId('abc')).toBe(false);
  });

  test('strips the prefix on the way back', () => {
    expect(toOtelTraceId('tr-abc')).toBe('abc');
    expect(toOtelTraceId('abc')).toBe('abc');
  });
});
