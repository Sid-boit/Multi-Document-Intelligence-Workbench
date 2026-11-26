import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Cpu, FileText, RotateCcw, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ANALYSABLE_STATUSES, type AnalysisTemplate, type DocumentSummary } from '@workbench/shared';
import { Composer } from './components/Composer';
import { DocumentList } from './components/DocumentList';
import { EvidenceDrawer } from './components/EvidenceDrawer';
import { ProgressPanel } from './components/ProgressPanel';
import { Results } from './components/Results';
import { UploadZone } from './components/UploadZone';
import { Button, Card, cx, EmptyState, Pill, Spinner } from './components/ui';
import { api, ApiError } from './lib/api';

const FINAL = new Set(['completed', 'failed']);

export function App() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [instruction, setInstruction] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [analysisId, setAnalysisIdState] = useState<string | null>(() => new URLSearchParams(window.location.search).get('analysis'));
  // Keep the open analysis in the URL so a result can be reloaded or linked to.
  const setAnalysisId = useCallback((id: string | null) => {
    setAnalysisIdState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('analysis', id);
    else url.searchParams.delete('analysis');
    window.history.replaceState(null, '', url);
  }, []);
  const [evidenceHandle, setEvidenceHandle] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'error' } | null>(null);

  const notify = useCallback((msg: string, tone: 'ok' | 'error' = 'ok') => setToast({ msg, tone }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 15_000 });
  const documents = useQuery({ queryKey: ['documents'], queryFn: api.listDocuments });
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates, staleTime: Infinity });
  const history = useQuery({ queryKey: ['analyses'], queryFn: api.listAnalyses });
  const analysis = useQuery({
    queryKey: ['analysis', analysisId],
    queryFn: () => api.getAnalysis(analysisId!),
    enabled: analysisId !== null,
    refetchInterval: (q) => (q.state.data && FINAL.has(q.state.data.status) ? false : 1500),
  });

  // Refresh history when an analysis finishes.
  const status = analysis.data?.status;
  useEffect(() => {
    if (status && FINAL.has(status)) void qc.invalidateQueries({ queryKey: ['analyses'] });
  }, [status, qc]);

  const limits = health.data?.limits ?? { maxFileMb: 15, maxFiles: 10, formats: [] };

  const upload = useMutation({
    mutationFn: api.uploadDocuments,
    onSuccess: (docs) => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      setSelected((prev) => new Set([...prev, ...docs.filter((d) => ANALYSABLE_STATUSES.includes(d.status)).map((d) => d.id)]));
      const bad = docs.filter((d) => !ANALYSABLE_STATUSES.includes(d.status)).length;
      notify(bad > 0 ? `${docs.length - bad} uploaded, ${bad} could not be processed — see reasons in the list` : `${docs.length} document(s) ready`, bad > 0 ? 'error' : 'ok');
    },
    onError: (e) => notify(e instanceof ApiError ? e.message : 'Upload failed', 'error'),
  });

  const remove = useMutation({
    mutationFn: (doc: DocumentSummary) => api.deleteDocument(doc.id),
    onSuccess: (_r, doc) => {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (e) => notify(e instanceof ApiError ? e.message : 'Delete failed', 'error'),
  });

  const create = useMutation({
    mutationFn: () => api.createAnalysis({ instruction: instruction.trim(), documentIds: orderedSelection, templateId }),
    onSuccess: (id) => {
      setAnalysisId(id);
      setEvidenceHandle(null);
      void qc.invalidateQueries({ queryKey: ['analyses'] });
    },
    onError: (e) => notify(e instanceof ApiError ? e.message : 'Could not start the analysis', 'error'),
  });

  // Oldest first, so the first uploaded document (e.g. the application form) is D1 / the reference.
  const docs = documents.data ?? [];
  const orderedSelection = useMemo(
    () =>
      [...docs]
        .reverse()
        .filter((d) => selected.has(d.id))
        .map((d) => d.id),
    [docs, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chooseTemplate = (t: AnalysisTemplate) => {
    setInstruction(t.instruction);
    setTemplateId(t.id);
  };

  const result = analysis.data?.result ?? null;
  const evidence = evidenceHandle && result ? result.evidence[evidenceHandle] : undefined;
  const readyCount = docs.filter((d) => ANALYSABLE_STATUSES.includes(d.status)).length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3">
          <FileText className="size-6 text-indigo-600" aria-hidden />
          <div>
            <h1 className="text-base font-semibold text-slate-900">Document Intelligence Workbench</h1>
            <p className="text-xs text-slate-500">Compare documents with traceable, evidence-backed findings</p>
          </div>
          <div className="ml-auto">
            {health.isLoading ? (
              <Spinner />
            ) : health.data?.llm.reachable ? (
              <Pill tone="green" title={`${health.data.llm.provider}${health.data.llm.model ? ` · ${health.data.llm.model}` : ''}`}>
                {health.data.llm.provider === 'mock' ? <Cpu className="size-3" /> : <Wifi className="size-3" />}
                AI: {health.data.llm.provider === 'mock' ? 'offline mock' : health.data.llm.model}
              </Pill>
            ) : (
              <Pill tone="red" title="Analyses will fall back to rule-based extraction">
                <WifiOff className="size-3" /> {health.isError ? 'Server unreachable' : 'AI offline'}
              </Pill>
            )}
          </div>
        </div>
      </header>

      {health.data && !health.data.llm.reachable && (
        <div className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          The local AI model ({health.data.llm.model}) is not reachable. Start Ollama (<code>ollama serve</code>, <code>ollama pull {health.data.llm.model}</code>) — analyses
          will still run with rule-based extraction only.
        </div>
      )}

      <main className="mx-auto grid max-w-[1400px] gap-4 px-4 py-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card title={`Documents${docs.length > 0 ? ` (${readyCount} ready)` : ''}`}>
            <div className="flex flex-col gap-3">
              <UploadZone onFiles={(f) => upload.mutate(f)} uploading={upload.isPending} limits={limits} onRejected={(m) => notify(m, 'error')} />
              {documents.isLoading ? (
                <Spinner />
              ) : documents.isError ? (
                <p className="text-sm text-rose-700">Could not load documents: {(documents.error as Error).message}</p>
              ) : (
                <DocumentList documents={docs} selected={selected} onToggle={toggle} onDelete={(d) => remove.mutate(d)} />
              )}
            </div>
          </Card>

          {(history.data?.length ?? 0) > 0 && (
            <Card title="Recent analyses">
              <ul className="flex flex-col gap-1">
                {history.data!.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setAnalysisId(h.id);
                        setEvidenceHandle(null);
                      }}
                      className={cx('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50', h.id === analysisId && 'bg-indigo-50')}
                    >
                      <Clock className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                      <span className="line-clamp-2 flex-1 text-slate-700">{h.instruction}</span>
                      <span className={cx('text-xs', h.status === 'failed' ? 'text-rose-600' : h.status === 'completed' ? 'text-slate-400' : 'text-indigo-600')}>{h.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Analysis instruction">
            <Composer
              instruction={instruction}
              onInstruction={(v) => {
                setInstruction(v);
                setTemplateId(templates.data?.find((t) => t.instruction === v)?.id ?? null);
              }}
              templateId={templateId}
              onTemplate={chooseTemplate}
              templates={templates.data ?? []}
              selectedCount={orderedSelection.length}
              submitting={create.isPending}
              onSubmit={() => create.mutate()}
            />
          </Card>

          <Card title={analysis.data ? <span className="font-normal text-slate-600">“{analysis.data.instruction}”</span> : 'Results'}>
            {!analysisId ? (
              <EmptyState icon={<FileText className="size-8 text-slate-300" />} title="No analysis yet">
                Upload documents, pick or write an instruction, and press <strong>Analyse</strong>. Each document is analysed on its own first; findings are then compared across
                documents and every finding links back to its source.
              </EmptyState>
            ) : analysis.isLoading ? (
              <Spinner />
            ) : analysis.isError ? (
              <p className="text-sm text-rose-700">Could not load the analysis: {(analysis.error as Error).message}</p>
            ) : analysis.data?.status === 'failed' ? (
              <div className="flex flex-col items-start gap-3">
                <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{analysis.data.error ?? 'The analysis failed.'}</p>
                <Button onClick={() => create.mutate()} disabled={orderedSelection.length === 0}>
                  <RotateCcw className="size-4" /> Try again
                </Button>
              </div>
            ) : analysis.data && analysis.data.status !== 'completed' ? (
              <ProgressPanel analysis={analysis.data} />
            ) : analysis.data?.result ? (
              <Results analysis={analysis.data} onOpenEvidence={setEvidenceHandle} notify={(m) => notify(m)} />
            ) : null}
          </Card>
        </div>
      </main>

      {evidence && <EvidenceDrawer evidence={evidence} onClose={() => setEvidenceHandle(null)} />}

      {toast && (
        <div
          role="status"
          className={cx(
            'fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg',
            toast.tone === 'error' ? 'bg-rose-600' : 'bg-slate-900',
          )}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
