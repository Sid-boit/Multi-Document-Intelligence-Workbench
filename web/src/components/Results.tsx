import { Info, TriangleExclamationPoint } from 'lucide-react';
import { useState } from 'react';
import type { AnalysisView } from '@workbench/shared';
import type { ExportSection } from '../lib/export';
import { ComparisonMatrix } from './ComparisonMatrix';
import { CopyMenu } from './CopyMenu';
import { ExportTxtButton } from './ExportTxtButton';
import { FindingList } from './FindingCard';
import { TierLegend } from './TierBadge';
import { cx } from './ui';

type Tab = Exclude<ExportSection, 'all'> | 'warnings';

export function Results({ analysis, onOpenEvidence, notify }: { analysis: AnalysisView; onOpenEvidence: (handle: string) => void; notify: (msg: string) => void }) {
  const result = analysis.result!;
  const [tab, setTab] = useState<Tab>('overview');
  const high = result.discrepancies.filter((d) => d.severity === 'high').length;
  const evidence = Object.values(result.evidence);
  const verified = evidence.filter((e) => e.verification !== 'unverified').length;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'comparison', label: 'Comparison', count: result.comparison.length },
    { id: 'discrepancies', label: 'Discrepancies', count: result.discrepancies.length },
    { id: 'missing', label: 'Missing info', count: result.missingInformation.length },
    { id: 'keyValues', label: 'Key values', count: result.keyValues.length },
    { id: 'perDocument', label: 'Per document', count: result.perDocument.length },
    ...(result.warnings.length > 0 ? [{ id: 'warnings' as const, label: 'Warnings', count: result.warnings.length }] : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TierLegend />
        <div className="flex items-center gap-2">
          <CopyMenu result={result} section="all" instruction={analysis.instruction} label="Copy all" onCopied={notify} />
          <ExportTxtButton result={result} section="all" instruction={analysis.instruction} label="Export all .txt" onExported={notify} />
        </div>
      </div>

      {result.warnings.length > 0 && (
        <button type="button" onClick={() => setTab('warnings')} className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 ring-1 ring-amber-200">
          <TriangleExclamationPoint className="size-4 shrink-0" />
          {result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'} — review before relying on these results.
        </button>
      )}

      <div role="tablist" aria-label="Result sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm transition',
              tab === t.id ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="min-h-40">
        {tab !== 'warnings' && (
          <div className="mb-3 flex justify-end gap-2">
            <CopyMenu result={result} section={tab} instruction={analysis.instruction} onCopied={notify} />
            <ExportTxtButton result={result} section={tab} instruction={analysis.instruction} onExported={notify} />
          </div>
        )}

        {tab === 'overview' && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Documents" value={result.documents.length} />
              <Stat label="Discrepancies" value={result.discrepancies.length} sub={high > 0 ? `${high} high` : undefined} tone={high > 0 ? 'red' : undefined} />
              <Stat label="Missing items" value={result.missingInformation.length} />
              <Stat label="Evidence verified" value={`${evidence.length === 0 ? 100 : Math.round((verified / evidence.length) * 100)}%`} sub={`${verified}/${evidence.length} quotes`} />
            </dl>
            <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-violet-700">
                <Info className="size-3.5" /> Consolidated summary — AI interpretation
                {result.meta.provider === 'mock' && ' (offline mock)'}
              </p>
              <p className="text-sm whitespace-pre-line text-slate-800">{result.summary}</p>
            </div>
            <FindingList findings={result.summaryPoints} result={result} empty="No key points." onOpenEvidence={onOpenEvidence} />
          </div>
        )}
        {tab === 'comparison' && <ComparisonMatrix result={result} onOpenEvidence={onOpenEvidence} />}
        {tab === 'discrepancies' && <FindingList findings={result.discrepancies} result={result} empty="No discrepancies found." onOpenEvidence={onOpenEvidence} />}
        {tab === 'missing' && <FindingList findings={result.missingInformation} result={result} empty="No missing information detected." onOpenEvidence={onOpenEvidence} />}
        {tab === 'keyValues' && <FindingList findings={result.keyValues} result={result} empty="No key values extracted." onOpenEvidence={onOpenEvidence} />}
        {tab === 'perDocument' && (
          <div className="flex flex-col gap-5">
            {result.perDocument.map((p) => {
              const d = result.documents.find((x) => x.id === p.documentId);
              return (
                <section key={p.documentId}>
                  <h4 className="mb-2 text-sm font-semibold text-slate-800">
                    <span className="font-mono text-indigo-700">{d?.alias}</span> {d?.name}
                  </h4>
                  <FindingList findings={p.findings} result={result} empty="Nothing extracted from this document." onOpenEvidence={onOpenEvidence} />
                </section>
              );
            })}
          </div>
        )}
        {tab === 'warnings' && (
          <ul className="flex flex-col gap-1.5">
            {result.warnings.map((w, i) => (
              <li key={i} className="flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <TriangleExclamationPoint className="mt-0.5 size-4 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-right text-xs text-slate-400">
        {result.meta.provider}
        {result.meta.model ? ` · ${result.meta.model}` : ''} · plan: {result.meta.planSource} · prompt {result.meta.promptVersion} · {(result.meta.durationMs / 1000).toFixed(1)}s
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string | undefined; tone?: 'red' | undefined }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={cx('text-xl font-semibold', tone === 'red' ? 'text-rose-600' : 'text-slate-900')}>{value}</dd>
      {sub && <dd className="text-xs text-slate-500">{sub}</dd>}
    </div>
  );
}
