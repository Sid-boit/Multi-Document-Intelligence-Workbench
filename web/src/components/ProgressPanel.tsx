import { Check, CircleX } from 'lucide-react';
import type { AnalysisStatus, AnalysisView, DocumentProgress } from '@workbench/shared';
import { cx, Spinner } from './ui';

const STAGES: { key: AnalysisStatus; label: string }[] = [
  { key: 'planning', label: 'Plan' },
  { key: 'extracting', label: 'Extract per document' },
  { key: 'comparing', label: 'Verify & compare' },
  { key: 'synthesising', label: 'Synthesise' },
];

const ORDER: AnalysisStatus[] = ['queued', 'planning', 'extracting', 'comparing', 'synthesising', 'completed'];

const DOC_STATE: Record<DocumentProgress, string> = {
  pending: 'waiting',
  running: 'analysing…',
  done: 'done',
  fallback: 'done (rule-based fallback)',
  failed: 'failed',
};

export function ProgressPanel({ analysis }: { analysis: AnalysisView }) {
  const current = ORDER.indexOf(analysis.status);
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <ol className="flex flex-wrap items-center gap-2">
        {STAGES.map((s, i) => {
          const idx = ORDER.indexOf(s.key);
          const done = current > idx;
          const active = current === idx;
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className={cx(
                  'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                  done ? 'bg-emerald-600 text-white' : active ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500',
                )}
              >
                {done ? <Check className="size-3.5" /> : active ? <Spinner className="size-3.5" /> : i + 1}
              </span>
              <span className={cx('text-sm', active ? 'font-medium text-slate-900' : 'text-slate-500')}>{s.label}</span>
              {i < STAGES.length - 1 && <span className="mx-1 h-px w-6 bg-slate-300" />}
            </li>
          );
        })}
      </ol>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {analysis.documents.map((d) => {
          const state = analysis.progress.perDocument[d.id] ?? 'pending';
          return (
            <li key={d.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
              {state === 'running' ? (
                <Spinner className="text-indigo-600" />
              ) : state === 'failed' ? (
                <CircleX className="size-4 text-rose-600" />
              ) : state === 'done' || state === 'fallback' ? (
                <Check className={cx('size-4', state === 'fallback' ? 'text-amber-600' : 'text-emerald-600')} />
              ) : (
                <span className="size-4 rounded-full border-2 border-slate-300" />
              )}
              <span className="font-mono text-xs text-slate-500">{d.alias}</span>
              <span className="truncate text-slate-700">{d.name}</span>
              <span className="ml-auto text-xs whitespace-nowrap text-slate-500">{DOC_STATE[state]}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">Local AI models can take a minute or two per document. You can keep working; results appear automatically.</p>
    </div>
  );
}
