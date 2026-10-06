import { describe, expect, test } from 'vitest';
import { parseArgs } from './args.js';
import { deletionMode } from './deletion-mode.js';

describe('deletionMode', () => {
  test('defaults to dry-run when no flag is given', () => {
    // Arrange
    const args = parseArgs([]);

    // Act
    const mode = deletionMode(args);

    // Assert
    expect(mode).toBe('dry-run');
  });

  test('returns dry-run for an explicit --dry-run', () => {
    // Arrange
    const args = parseArgs(['--dry-run']);

    // Act
    const mode = deletionMode(args);

    // Assert
    expect(mode).toBe('dry-run');
  });

  test('returns execute for --execute alone', () => {
    // Arrange
    const args = parseArgs(['--execute']);

    // Act
    const mode = deletionMode(args);

    // Assert
    expect(mode).toBe('execute');
  });

  test('lets --dry-run win when both flags are passed', () => {
    // Arrange
    const args = parseArgs(['--execute', '--dry-run']);

    // Act
    const mode = deletionMode(args);

    // Assert
    expect(mode).toBe('dry-run');
  });
});
