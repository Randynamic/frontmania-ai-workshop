import type { Mastra } from '@mastra/core';
import type { TracingContext } from '@mastra/core/observability';
import { createTool, isValidationError } from '@mastra/core/tools';
import type { LibSQLVector } from '@mastra/libsql';
import { embed } from 'ai';
import { z } from 'zod';
import { ARCHIVE_INDEX, ArchiveRowMetadata, archiveVector } from '../../data/archive.js';
import type { EmbeddingModelV4 } from '../../data/embedding.js';
import { embeddingModel } from '../model.js';

/**
 * searchArchive: semantic search over the earlier-edition abstracts in
 * data/archive.db (one abstract = one row = one embedding). Exercise 2
 * step 3 calls it from the tip step; exercise 3 hands it to the planner
 * agent as one of its three tools.
 *
 * Built with `createTool` from @mastra/core (tools/tool.d.ts: `createTool({
 * id, description, inputSchema, outputSchema, execute(input, context) })`),
 * `embed` from ai 7 and `LibSQLVector.query({ indexName, queryVector, topK,
 * filter })` (@mastra/libsql 1.23.3, vector/index.d.ts line 62). It is not
 * `createVectorQueryTool` from @mastra/rag 2.6.4 (no longer a dependency): that tool embeds through
 * its vendored AI SDK v4/v5/v6 paths and rejects the ai 7 (spec `v4`)
 * embedding models this repo uses; observed on 26 Sep 2026:
 * `AI_UnsupportedModelVersionError: AI SDK 4 only supports models that
 * implement specification version "v1"`, and `MastraEmbeddingModel` in
 * @mastra/core 1.71.0 (vector/vector.d.ts) admits V1 to V3 only. The input
 * shape is the same as the rag tool's (queryText, topK, JSON `filter`).
 */
export const SEARCH_ARCHIVE_ID = 'searchArchive';
export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;

export const SearchArchiveInput = z.object({
  queryText: z
    .string()
    .min(1)
    .describe('What to look for: a talk title, a topic, or the attendee interests'),
  topK: z
    .number()
    .int()
    .min(1)
    .max(MAX_TOP_K)
    .default(DEFAULT_TOP_K)
    .describe(`How many archive talks to return, 1 to ${MAX_TOP_K}`),
  filter: z
    .string()
    .optional()
    .describe('Optional JSON metadata filter, for example {"year":{"$gte":2024}}'),
});
export type SearchArchiveInput = z.infer<typeof SearchArchiveInput>;

/** One archive talk as the tool returns it: the stored metadata plus the similarity score. */
export const ArchiveHit = ArchiveRowMetadata.extend({ score: z.number() });
export type ArchiveHit = z.infer<typeof ArchiveHit>;

export const SearchArchiveOutput = z.object({ hits: z.array(ArchiveHit) });
export type SearchArchiveOutput = z.infer<typeof SearchArchiveOutput>;

export interface SearchArchiveDeps {
  readonly vectorStore?: LibSQLVector;
  readonly model?: EmbeddingModelV4;
}

/** What LibSQL accepts as a metadata filter; the JSON from the caller is validated by the store at query time. */
type VectorFilter = NonNullable<Parameters<LibSQLVector['query']>[0]['filter']>;

/** A JSON object, or a clear error; the tool never swallows a bad filter. */
export const parseFilter = (filter: string | undefined): Record<string, unknown> | undefined => {
  if (filter === undefined || filter.trim() === '' || filter.trim() === '{}') return undefined;
  const parsed = (() => {
    try {
      return JSON.parse(filter) as unknown;
    } catch {
      throw new Error(`searchArchive: filter is not JSON: ${filter}`);
    }
  })();
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`searchArchive: filter must be a JSON object, got ${filter}`);
  }
  return parsed as Record<string, unknown>;
};

const buildTool = (deps: SearchArchiveDeps) =>
  createTool({
    id: SEARCH_ARCHIVE_ID,
    description:
      'Finds recorded talks from earlier Frontmania editions that are close to a query: a talk title, a topic or the attendee interests. Returns id, year, title, speakers and abstract per hit, best match first.',
    inputSchema: SearchArchiveInput,
    outputSchema: SearchArchiveOutput,
    execute: async (input) => {
      const filter = parseFilter(input.filter);
      const model = deps.model ?? embeddingModel();
      const vectorStore = deps.vectorStore ?? archiveVector();
      const { embedding } = await embed({ model, value: input.queryText });
      const results = await vectorStore.query({
        indexName: ARCHIVE_INDEX,
        queryVector: embedding,
        topK: input.topK,
        ...(filter ? { filter: filter as VectorFilter } : {}),
      });
      return {
        hits: results.map((result) => ({
          ...ArchiveRowMetadata.parse(result.metadata),
          score: result.score,
        })),
      };
    },
  });

type CreatedTool = ReturnType<typeof buildTool>;

/** What a direct caller (a workflow step) passes; an agent fills in the rest of ToolExecutionContext itself. */
export interface SearchArchiveContext {
  readonly mastra?: Mastra;
  readonly tracingContext?: TracingContext;
}

/**
 * The tool with `execute` guaranteed and a context a step can supply.
 * ToolExecutionContext in @mastra/core 1.71.0 declares `observe` as
 * required (tools/types.d.ts), but the Tool wrapper fills a missing
 * context itself (`context || {}`), so a step may pass only what it has.
 */
export type SearchArchiveTool = Omit<CreatedTool, 'execute'> & {
  readonly execute: (input: SearchArchiveInput, context?: SearchArchiveContext) => Promise<unknown>;
};

/** Builds the tool; deps default to the committed index and the MODEL_MODE embedding, resolved on first call. */
export const createSearchArchiveTool = (deps: SearchArchiveDeps = {}): SearchArchiveTool => {
  const tool = buildTool(deps);
  if (!tool.execute) throw new Error('createTool returned no execute function');
  return tool as unknown as SearchArchiveTool;
};

export const searchArchive = createSearchArchiveTool();

/**
 * The typed hits of one tool call. Mastra validates tool input and returns
 * a ValidationError object instead of throwing, so this is where a bad call
 * becomes an error a participant can read.
 */
export const searchArchiveHits = (result: unknown): readonly ArchiveHit[] => {
  if (isValidationError(result)) throw new Error(result.message);
  const parsed = SearchArchiveOutput.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `searchArchive returned an unexpected shape at ${parsed.error.issues[0]?.path.join('.') || '<root>'}`,
    );
  }
  return parsed.data.hits;
};
