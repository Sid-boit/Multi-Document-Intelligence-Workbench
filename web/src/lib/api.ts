import { z } from 'zod';
import {
  AnalysisListItem,
  AnalysisTemplate,
  AnalysisView,
  ApiErrorBody,
  DocumentSummary,
  HealthResponse,
  PageText,
  type CreateAnalysisRequest,
} from '@workbench/shared';

/** Error carrying the server's user-facing message and code. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 'NETWORK', 0);
  }
  if (!res.ok) {
    const body = ApiErrorBody.safeParse(await res.json().catch(() => null));
    throw new ApiError(body.success ? body.data.error.message : `Request failed (${res.status})`, body.success ? body.data.error.code : 'HTTP', res.status);
  }
  if (res.status === 204) return undefined as T;
  // Every response is validated against the shared contract.
  return schema.parse(await res.json());
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request('/health', HealthResponse),

  listDocuments: () => request('/documents', z.object({ documents: z.array(DocumentSummary) })).then((r) => r.documents),

  uploadDocuments: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return request('/documents', z.object({ documents: z.array(DocumentSummary) }), { method: 'POST', body: form }).then((r) => r.documents);
  },

  deleteDocument: (id: string) => request(`/documents/${id}`, z.undefined(), { method: 'DELETE' }),

  getPage: (documentId: string, pageNo: number) => request(`/documents/${documentId}/pages/${pageNo}`, PageText),

  templates: () => request('/templates', z.object({ templates: z.array(AnalysisTemplate) })).then((r) => r.templates),

  createAnalysis: (body: CreateAnalysisRequest) => request('/analyses', z.object({ id: z.string() }), json(body)).then((r) => r.id),

  getAnalysis: (id: string) => request(`/analyses/${id}`, z.object({ analysis: AnalysisView })).then((r) => r.analysis),

  listAnalyses: () => request('/analyses', z.object({ analyses: z.array(AnalysisListItem) })).then((r) => r.analyses),
};
