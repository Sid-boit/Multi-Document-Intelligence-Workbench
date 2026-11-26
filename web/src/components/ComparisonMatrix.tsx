import { Check, Circle, Equal, Minus, X } from 'lucide-react';
import { useState } from 'react';
import type { AnalysisResult, CellStatus, RowStatus } from '@workbench/shared';
import { cx } from './ui';

const CELL: Record<CellStatus, { icon: typeof Check; cls: string; label: string }> = {
  match: { icon: Check, cls: 'bg-emerald-50 text-emerald-900', label: 'matches' },
  equivalent: { icon: Equal, cls: 'bg-emerald-50/60 text-emerald-900', label: 'equivalent' },
  mismatch: { icon: X, cls: 'bg-rose-50 text-rose-900', label: 'conflicts' },
  missing: { icon: Minus, cls: 'text-slate-400', label: 'not found' },
  reported: { icon: Circle, cls: 'text-slate-900', label: 'reported' },
};

const ROW_LABEL: Record<RowStatus, string> = {
  consistent: 'Consistent',
  inconsistent: 'Inconsistent',
  partial: 'Partly found',
  not_found: 'Not found',
  compared: 'Side by side',
};

export function ComparisonMatrix({ result, onOpenEvidence }: { result: AnalysisResult; onOpenEvidence: (handle: string) => void }) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const sideBySide = result.meta.comparisonMode === 'side_by_side';
  const rows = onlyIssues ? result.comparison.filter((r) => r.rowStatus === 'inconsistent') : result.comparison;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {sideBySide
            ? 'Side-by-side comparison: the documents describe different entities, so differences are expected and are not reported as discrepancies.'
            : 'Values are normalised before comparison (e.g. “£1.18m” ≈ “1,180,000”).'}{' '}
          Click a value to see where it appears in the document.
        </p>
        {!sideBySide && (
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} className="accent-indigo-600" />
          Inconsistent only
        </label>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 font-semibold">
                Attribute
              </th>
              {result.documents.map((d) => (
                <th key={d.id} scope="col" className="px-3 py-2 font-semibold" title={d.name}>
                  <span className="font-mono">{d.alias}</span> <span className="font-normal text-slate-500">{d.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.attribute}>
                <th scope="row" className="sticky left-0 bg-white px-3 py-2 text-left align-top font-medium text-slate-800">
                  {row.label}
                  <div className={cx('text-xs font-normal', row.rowStatus === 'inconsistent' ? 'text-rose-600' : 'text-slate-400')}>{ROW_LABEL[row.rowStatus]}</div>
                </th>
                {result.documents.map((d) => {
                  const c = row.cells.find((x) => x.documentId === d.id);
                  const status = c?.status ?? 'missing';
                  const s = CELL[status];
                  const Icon = s.icon;
                  const ev = c?.evidenceHandle ? result.evidence[c.evidenceHandle] : undefined;
                  return (
                    <td key={d.id} className={cx('px-3 py-2 align-top', s.cls)} data-status={status}>
                      {c?.value ? (
                        <button
                          type="button"
                          className="flex items-start gap-1.5 text-left hover:underline focus-visible:outline-2 focus-visible:outline-indigo-500"
                          onClick={() => c.evidenceHandle && onOpenEvidence(c.evidenceHandle)}
                          aria-label={`${row.label} in ${d.alias}: ${c.value} (${s.label})`}
                          title={ev ? `“${ev.quote}” — ${ev.verification}` : undefined}
                        >
                          <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                          <span>{c.value}</span>
                          {ev?.verification === 'unverified' && <span className="text-rose-600">?</span>}
                        </button>
                      ) : (
                        <span className="flex items-center gap-1.5" aria-label={`${row.label} not found in ${d.alias}`}>
                          <Icon aria-hidden className="size-3.5" /> not found
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={result.documents.length + 1} className="px-3 py-6 text-center text-slate-500">
                  {onlyIssues ? 'No inconsistent attributes.' : 'No attributes were compared.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
        {(Object.keys(CELL) as CellStatus[]).filter((k) => (sideBySide ? k === 'reported' || k === 'missing' : k !== 'reported')).map((k) => {
          const Icon = CELL[k].icon;
          return (
            <span key={k} className="inline-flex items-center gap-1">
              <Icon aria-hidden className="size-3" /> {CELL[k].label}
            </span>
          );
        })}
      </p>
    </div>
  );
}
