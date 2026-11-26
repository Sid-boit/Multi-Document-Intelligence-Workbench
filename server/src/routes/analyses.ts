import { Router } from 'express';
import { z } from 'zod';
import { ANALYSABLE_STATUSES, CreateAnalysisRequest } from '@workbench/shared';
import { AppError } from '../errors.js';
import { runAnalysis, type PipelineDeps } from '../analysis/pipeline.js';
import { PROMPT_VERSION } from '../analysis/prompts.js';
import { findTemplateId, TEMPLATES } from '../analysis/templates.js';

const IdParam = z.object({ id: z.string().uuid('Invalid analysis id') });

export interface AnalysesRouterDeps extends PipelineDeps {
  /** Called with the background job promise (lets tests await completion). */
  onJob?: (job: Promise<void>) => void;
}

export function analysesRouter(deps: AnalysesRouterDeps): Router {
  const { repo, llm } = deps;
  const router = Router();

  router.post('/', (req, res) => {
    const body = CreateAnalysisRequest.parse(req.body);
    const documentIds = [...new Set(body.documentIds)];
    const problems: string[] = [];
    for (const id of documentIds) {
      const doc = repo.getDocument(id);
      if (!doc) problems.push(`Document ${id} does not exist.`);
      else if (!ANALYSABLE_STATUSES.includes(doc.status)) problems.push(`"${doc.displayName}" cannot be analysed (status: ${doc.status}).`);
    }
    if (problems.length > 0) throw AppError.validation(problems[0]!, problems);

    const id = repo.createAnalysis({
      instruction: body.instruction,
      templateId: findTemplateId(body.instruction, body.templateId),
      documentIds,
      provider: llm.name,
      model: llm.model,
      promptVersion: PROMPT_VERSION,
    });
    // Runs in the background; progress is persisted and polled by the client.
    const job = runAnalysis(deps, id);
    deps.onJob?.(job);
    res.status(202).json({ id });
  });

  router.get('/', (_req, res) => {
    res.json({ analyses: repo.listAnalyses() });
  });

  router.get('/:id', (req, res) => {
    const { id } = IdParam.parse(req.params);
    const analysis = repo.getAnalysis(id);
    if (!analysis) throw AppError.notFound('Analysis');
    res.json({ analysis });
  });

  return router;
}

export function templatesRouter(): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({ templates: TEMPLATES });
  });
  return router;
}
