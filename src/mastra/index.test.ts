import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { OtelExporter } from '@mastra/otel-exporter';
import { afterEach, describe, expect, test } from 'vitest';
import { clearRawTextRegistry, registerRawText } from '../observability/raw-text-registry.js';
import { CapturingExporter } from '../test-support/capturing-exporter.js';
import {
  AGENTS,
  ARCHIVE_VECTOR_NAME,
  createMastra,
  createObservabilityConfig,
  createOtelExporter,
  mastra,
  SERVICE_NAME,
  WORKFLOWS,
} from './index.js';
import { createMockTaskModel } from './model.js';

const CV_PATH = fileURLToPath(
  new URL('../observability/fixtures/fictional-cv.md', import.meta.url),
);
const cvText = readFileSync(CV_PATH, 'utf8');

const LIVE_ENV = {
  MODEL_MODE: 'live',
  PROXY_API_KEY: 'sk-card',
  MLFLOW_OTLP_ENDPOINT: 'https://ws.test/otel/v1/traces',
};

afterEach(() => clearRawTextRegistry());

describe('observability config', () => {
  test('mock mode: only the in-memory TestExporter, masking processor present', () => {
    const config = createObservabilityConfig({ MODEL_MODE: 'mock' });
    expect(config.serviceName).toBe(SERVICE_NAME);
    expect(config.exporters.map((e) => e.name)).toEqual(['test-exporter']);
    expect(config.spanOutputProcessors.map((p) => p.name)).toEqual(['cv-masking']);
  });

  test('live mode: one OtelExporter to the gateway, masking processor first', () => {
    const config = createObservabilityConfig(LIVE_ENV);
    expect(config.exporters).toHaveLength(1);
    expect(config.exporters[0]).toBeInstanceOf(OtelExporter);
    expect(
      createObservabilityConfig(
        { MODEL_MODE: 'mock' },
        { exporters: [new CapturingExporter()] },
      ).exporters.map((e) => e.name),
    ).toEqual(['capture']);
    expect(config.spanOutputProcessors[0]?.name).toBe('cv-masking');
  });

  test('live mode without key or with a wrong endpoint fails with the fix', () => {
    expect(() => createOtelExporter({ ...LIVE_ENV, PROXY_API_KEY: '' })).toThrow('your card');
    expect(() => createOtelExporter({ ...LIVE_ENV, MLFLOW_OTLP_ENDPOINT: 'https://x' })).toThrow(
      '/v1/traces',
    );
  });
});

describe('mastra instance', () => {
  test('registers the archive vector store, the four agents and the plan workflow', () => {
    expect(mastra.getVector(ARCHIVE_VECTOR_NAME)).toBeDefined();
    expect(Object.keys(mastra.listVectors() ?? {})).toEqual([ARCHIVE_VECTOR_NAME]);
    expect(Object.keys(AGENTS)).toEqual(['profile', 'ranker', 'tip', 'planner']);
    expect(mastra.getAgent('profile').id).toBe('profile-agent');
    expect(mastra.getAgent('ranker').id).toBe('ranker-agent');
    expect(mastra.getAgent('planner').id).toBe('planner-agent');
    expect(Object.keys(WORKFLOWS)).toEqual(['plan']);
    expect(mastra.getWorkflow('plan').id).toBe('plan');
  });

  test('every exported span carries the hash marker, never the CV text', async () => {
    // Arrange
    const capture = new CapturingExporter();
    const agent = new Agent({
      id: 'probe-agent',
      name: 'probe',
      instructions: 'Extract a profile.',
      model: createMockTaskModel(() => JSON.stringify({ role: 'architect' })),
    });
    const instance = createMastra(
      { MODEL_MODE: 'mock' },
      { exporters: [capture], agents: { probe: agent } },
    );
    const handle = registerRawText(cvText);

    // Act
    const result = await instance.getAgent('probe').generate(cvText, {
      tracingOptions: { metadata: { participantId: 'otter-42', kind: 'profile' } },
    });
    await instance.shutdown();

    // Assert
    expect(result.text).toBe('{"role":"architect"}');
    expect(capture.spans.length).toBeGreaterThanOrEqual(3);
    const exported = JSON.stringify(capture.spans);
    expect(exported).toContain(handle.marker);
    expect(exported).not.toContain('Femke');
    expect(exported).not.toContain('Kanaalwerk Digital');
    expect(exported).not.toContain('voorbeeld-mail');
    expect(exported).toContain('"participantId":"otter-42"');
  });
});
