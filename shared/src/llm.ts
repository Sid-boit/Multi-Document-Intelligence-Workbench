import { z } from 'zod';
import { ValueType } from './schemas.js';

/**
 * Compact schemas that the language model fills in.
 *
 * They deliberately use short handles only – document aliases ("D2"), chunk refs
 * ("p1-c2") and evidence handles ("E7") – never database ids, so the model can
 * neither see nor invent identifiers. The server maps them back.
 */

export const LlmPlan = z.object({
  attributes: z
    .array(
      z.object({
        key: z.string().describe('snake_case identifier, e.g. "licence_number"'),
        label: z.string().describe('Human readable label'),
        valueType: ValueType,
        required: z.boolean().describe('true if the instruction implies the value must be present'),
      }),
    )
    .max(15),
});
export type LlmPlan = z.infer<typeof LlmPlan>;

export const LlmDocExtraction = z.object({
  values: z.array(
    z.object({
      attribute: z.string().describe('attribute key from the list provided'),
      status: z.enum(['found', 'not_found']),
      value: z.string().nullable().describe('value exactly as written in the document'),
      chunkRef: z.string().nullable().describe('ref of the chunk containing the value'),
      quote: z.string().nullable().describe('short verbatim quote (max 200 chars) containing the value'),
    }),
  ),
  observations: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        chunkRef: z.string(),
        quote: z.string().describe('short verbatim quote supporting the observation'),
      }),
    )
    .max(8),
});
export type LlmDocExtraction = z.infer<typeof LlmDocExtraction>;

export const LlmSynthesis = z.object({
  summary: z.string().describe('3-6 sentence consolidated answer to the instruction'),
  summaryPoints: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        evidence: z.array(z.string()).describe('evidence handles such as "E3"'),
      }),
    )
    .max(8),
  assessments: z.array(
    z.object({
      findingId: z.string().describe('id of a derived finding, e.g. "F2"'),
      verdict: z.enum(['confirmed', 'benign', 'needs_review']),
      explanation: z.string(),
    }),
  ),
  additionalFindings: z
    .array(
      z.object({
        category: z.enum(['discrepancy', 'missing_information']),
        title: z.string(),
        detail: z.string(),
        severity: z.enum(['low', 'medium', 'high']),
        evidence: z.array(z.string()),
      }),
    )
    .max(8),
});
export type LlmSynthesis = z.infer<typeof LlmSynthesis>;
