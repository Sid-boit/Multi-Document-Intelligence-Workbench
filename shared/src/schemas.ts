import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export const DocumentFormat = z.enum(['pdf', 'png', 'jpeg', 'csv', 'txt', 'md']);
export type DocumentFormat = z.infer<typeof DocumentFormat>;

export const DocumentStatus = z.enum(['ready', 'partial', 'failed', 'rejected']);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const ExtractionMethod = z.enum(['text-layer', 'ocr', 'native']);
export type ExtractionMethod = z.infer<typeof ExtractionMethod>;

export const DocumentSummary = z.object({
  id: z.string(),
  displayName: z.string(),
  format: DocumentFormat.nullable(),
  sizeBytes: z.number().int().nonnegative(),
  status: DocumentStatus,
  statusReason: z.string().nullable(),
  extractionMethod: ExtractionMethod.nullable(),
  pageCount: z.number().int().nullable(),
  charCount: z.number().int(),
  warnings: z.array(z.string()),
  createdAt: z.string(),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

export const PageText = z.object({
  documentId: z.string(),
  pageNo: z.number().int(),
  pageCount: z.number().int(),
  text: z.string(),
});
export type PageText = z.infer<typeof PageText>;

/** Statuses whose documents can be included in an analysis. */
export const ANALYSABLE_STATUSES: readonly DocumentStatus[] = ['ready', 'partial'];

/* ------------------------------------------------------------------ */
/* Analysis plan                                                       */
/* ------------------------------------------------------------------ */

export const ValueType = z.enum([
  'person_name',
  'organisation',
  'address',
  'date',
  'money',
  'identifier',
  'number',
  'text',
]);
export type ValueType = z.infer<typeof ValueType>;

export const PlanAttribute = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,48}$/),
  label: z.string().min(1).max(80),
  valueType: ValueType,
  required: z.boolean(),
  /** Alternative labels used by deterministic matching (form labels, CSV headers). */
  synonyms: z.array(z.string()),
});
export type PlanAttribute = z.infer<typeof PlanAttribute>;

export const AnalysisPlan = z.object({
  source: z.enum(['template', 'llm', 'fallback']),
  templateId: z.string().nullable(),
  attributes: z.array(PlanAttribute).min(1).max(20),
});
export type AnalysisPlan = z.infer<typeof AnalysisPlan>;

export const AnalysisTemplate = z.object({
  id: z.string(),
  label: z.string(),
  instruction: z.string(),
});
export type AnalysisTemplate = z.infer<typeof AnalysisTemplate>;

/* ------------------------------------------------------------------ */
/* Evidence & findings                                                 */
/* ------------------------------------------------------------------ */

/**
 * extracted      – value read verbatim from a document, quote verified in code
 * derived        – computed deterministically by a rule from extracted values
 * interpretation – judgement produced by the language model
 */
export const Tier = z.enum(['extracted', 'derived', 'interpretation']);
export type Tier = z.infer<typeof Tier>;

export const Verification = z.enum(['exact', 'fuzzy', 'unverified']);
export type Verification = z.infer<typeof Verification>;

export const Evidence = z.object({
  handle: z.string(), // "E7" – the only way findings reference evidence
  documentId: z.string(),
  documentName: z.string(),
  alias: z.string(), // "D2"
  pageNo: z.number().int(),
  charStart: z.number().int().nullable(), // offsets within the page text
  charEnd: z.number().int().nullable(),
  quote: z.string(),
  verification: Verification,
  source: z.enum(['deterministic', 'llm']),
  attribute: z.string().nullable(),
  value: z.string().nullable(),
});
export type Evidence = z.infer<typeof Evidence>;

export const EvidenceRole = z.enum(['supports', 'contradicts', 'expected_in']);
export type EvidenceRole = z.infer<typeof EvidenceRole>;

export const Severity = z.enum(['info', 'low', 'medium', 'high']);
export type Severity = z.infer<typeof Severity>;

export const FindingCategory = z.enum([
  'summary_point',
  'discrepancy',
  'missing_information',
  'key_value',
  'observation',
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const Finding = z
  .object({
    id: z.string(),
    category: FindingCategory,
    tier: Tier,
    title: z.string(),
    detail: z.string(),
    attribute: z.string().nullable(),
    severity: Severity,
    rule: z.string().nullable(),
    verdict: z.enum(['confirmed', 'benign', 'needs_review']).nullable(),
    verdictNote: z.string().nullable(),
    /** Documents this finding is about. Always at least one. */
    documentIds: z.array(z.string()).min(1),
    evidence: z.array(z.object({ handle: z.string(), role: EvidenceRole })),
  })
  .superRefine((f, ctx) => {
    // Every finding must be traceable to evidence. The only exception is a
    // missing-information finding, whose "support" is the documents searched.
    if (f.category !== 'missing_information' && f.evidence.length === 0) {
      ctx.addIssue({ code: 'custom', message: `Finding ${f.id} has no evidence`, path: ['evidence'] });
    }
  });
export type Finding = z.infer<typeof Finding>;

export const CellStatus = z.enum(['match', 'equivalent', 'mismatch', 'missing']);
export type CellStatus = z.infer<typeof CellStatus>;

export const ComparisonCell = z.object({
  documentId: z.string(),
  value: z.string().nullable(),
  evidenceHandle: z.string().nullable(),
  status: CellStatus,
});
export type ComparisonCell = z.infer<typeof ComparisonCell>;

export const RowStatus = z.enum(['consistent', 'inconsistent', 'partial', 'not_found']);
export type RowStatus = z.infer<typeof RowStatus>;

export const ComparisonRow = z.object({
  attribute: z.string(),
  label: z.string(),
  valueType: ValueType,
  rowStatus: RowStatus,
  cells: z.array(ComparisonCell),
});
export type ComparisonRow = z.infer<typeof ComparisonRow>;

export const AnalysedDocument = z.object({ id: z.string(), alias: z.string(), name: z.string() });
export type AnalysedDocument = z.infer<typeof AnalysedDocument>;

export const AnalysisResult = z
  .object({
    documents: z.array(AnalysedDocument).min(1),
    summary: z.string(),
    summaryPoints: z.array(Finding),
    comparison: z.array(ComparisonRow),
    discrepancies: z.array(Finding),
    missingInformation: z.array(Finding),
    keyValues: z.array(Finding),
    perDocument: z.array(z.object({ documentId: z.string(), findings: z.array(Finding) })),
    evidence: z.record(z.string(), Evidence),
    warnings: z.array(z.string()),
    meta: z.object({
      provider: z.string(),
      model: z.string().nullable(),
      promptVersion: z.string(),
      planSource: z.enum(['template', 'llm', 'fallback']),
      durationMs: z.number(),
    }),
  })
  .superRefine((r, ctx) => {
    // Provenance invariant: every evidence handle referenced by a finding must
    // exist and must belong to one of the analysed documents.
    const docIds = new Set(r.documents.map((d) => d.id));
    const all = [
      ...r.summaryPoints,
      ...r.discrepancies,
      ...r.missingInformation,
      ...r.keyValues,
      ...r.perDocument.flatMap((p) => p.findings),
    ];
    for (const f of all) {
      for (const e of f.evidence) {
        const ev = r.evidence[e.handle];
        if (!ev) {
          ctx.addIssue({ code: 'custom', message: `Unknown evidence ${e.handle} in ${f.id}` });
        } else if (!docIds.has(ev.documentId)) {
          ctx.addIssue({ code: 'custom', message: `Evidence ${e.handle} is outside the analysed documents` });
        }
      }
      for (const d of f.documentIds) {
        if (!docIds.has(d)) ctx.addIssue({ code: 'custom', message: `Finding ${f.id} references unknown document` });
      }
    }
  });
export type AnalysisResult = z.infer<typeof AnalysisResult>;

/* ------------------------------------------------------------------ */
/* Analyses API                                                        */
/* ------------------------------------------------------------------ */

export const AnalysisStatus = z.enum([
  'queued',
  'planning',
  'extracting',
  'comparing',
  'synthesising',
  'completed',
  'failed',
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

export const DocumentProgress = z.enum(['pending', 'running', 'done', 'fallback', 'failed']);
export type DocumentProgress = z.infer<typeof DocumentProgress>;

export const AnalysisProgress = z.object({
  perDocument: z.record(z.string(), DocumentProgress),
});
export type AnalysisProgress = z.infer<typeof AnalysisProgress>;

export const AnalysisView = z.object({
  id: z.string(),
  instruction: z.string(),
  templateId: z.string().nullable(),
  status: AnalysisStatus,
  progress: AnalysisProgress,
  documents: z.array(AnalysedDocument),
  plan: AnalysisPlan.nullable(),
  result: AnalysisResult.nullable(),
  error: z.string().nullable(),
  provider: z.string(),
  model: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type AnalysisView = z.infer<typeof AnalysisView>;

export const AnalysisListItem = AnalysisView.pick({
  id: true,
  instruction: true,
  status: true,
  createdAt: true,
  completedAt: true,
});
export type AnalysisListItem = z.infer<typeof AnalysisListItem>;

export const CreateAnalysisRequest = z.object({
  instruction: z.string().trim().min(3, 'Instruction is too short').max(2000, 'Instruction is too long'),
  documentIds: z.array(z.string().min(1)).min(1, 'Select at least one document').max(10, 'At most 10 documents'),
  templateId: z.string().nullish(),
});
export type CreateAnalysisRequest = z.infer<typeof CreateAnalysisRequest>;

export const HealthResponse = z.object({
  ok: z.boolean(),
  db: z.enum(['ok', 'error']),
  llm: z.object({ provider: z.string(), model: z.string().nullable(), reachable: z.boolean() }),
  limits: z.object({ maxFileMb: z.number(), maxFiles: z.number(), formats: z.array(z.string()) }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'FILE_REJECTED',
  'PAYLOAD_TOO_LARGE',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'LLM_UNAVAILABLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), details: z.unknown().optional() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/** Extensions accepted by the upload endpoint (mirrored in the web pre-check). */
export const SUPPORTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.csv', '.txt', '.md'] as const;
