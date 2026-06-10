import { tool } from 'ai';
import { z } from 'zod';
import type { SceneQuery } from '@/model/scene/query';

/**
 * AI SDK tool palette over the scene. The model calls these during
 * `generateText({ tools, maxSteps })` to inspect the current scene before
 * emitting new source. All tools are read-only.
 *
 * Descriptions are written for the model — keep them tight and operational.
 */
export function buildSceneTools(query: SceneQuery, selectionId: string | null) {
  return {
    getSelection: tool({
      description:
        'Returns the currently selected scene node, or null if nothing is selected. ' +
        'Call this first whenever the user references "the selection", "this one", "it", or similar.',
      // `.nullable()` because some models (notably Llama on Groq) emit
      // `arguments: null` for zero-arg tool calls instead of `{}`.
      parameters: z.object({}).nullable(),
      execute: async () => (selectionId ? query.summarize(selectionId) : null),
    }),

    listNodes: tool({
      description:
        'Lists every node in the scene with id, type, params, aabb, center, size. ' +
        'Pass an optional `type` filter (cabinet, panel, shelf, door, drawer) to narrow the result.',
      parameters: z
        .object({
          type: z
            .enum(['cabinet', 'panel', 'shelf', 'door', 'drawer'])
            .optional()
            .describe('Optional type filter.'),
        })
        .nullable(),
      execute: async (args) => query.listAll(args?.type),
    }),

    getNode: tool({
      description:
        'Returns the full summary (params, aabb, center, size, parentId) for one node by id.',
      parameters: z.object({ id: z.string().describe('Node id from listNodes/getSelection, e.g. "cabinet@142" or "panel@142:left". Treat as opaque; do not parse.') }),
      execute: async ({ id }) => query.summarize(id),
    }),

    getNeighbors: tool({
      description:
        "Returns nodes axis-adjacent to the given node, with the gap in millimetres and which side " +
        "(min/max) of which axis they're on. Use this to find 'the back shelf', 'the panel above', etc.",
      parameters: z.object({ id: z.string().describe('Node id to find neighbors of.') }),
      execute: async ({ id }) => query.neighbors(id),
    }),
  } as const;
}
