import { CircleCheck, CircleX, FileImage, FileSpreadsheet, FileText, ScanText, Trash, TriangleExclamationPoint } from 'lucide-react';
import { ANALYSABLE_STATUSES, type DocumentStatus, type DocumentSummary } from '@workbench/shared';
import { formatBytes } from '../lib/text';
import { Button, cx, EmptyState, Pill } from './ui';

const STATUS: Record<DocumentStatus, { tone: 'green' | 'amber' | 'red'; label: string; icon: typeof CircleCheck }> = {
  ready: { tone: 'green', label: 'Ready', icon: CircleCheck },
  partial: { tone: 'amber', label: 'Partial', icon: TriangleExclamationPoint },
  failed: { tone: 'red', label: 'Failed', icon: CircleX },
  rejected: { tone: 'red', label: 'Rejected', icon: CircleX },
};

function FormatIcon({ format }: { format: DocumentSummary['format'] }) {
  const Icon = format === 'csv' ? FileSpreadsheet : format === 'png' || format === 'jpeg' ? FileImage : FileText;
  return <Icon aria-hidden className="size-5 shrink-0 text-slate-400" />;
}

export function DocumentList({
  documents,
  selected,
  onToggle,
  onDelete,
}: {
  documents: DocumentSummary[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onDelete: (doc: DocumentSummary) => void;
}) {
  if (documents.length === 0) {
    return <EmptyState icon={<FileText className="size-8 text-slate-300" />} title="No documents yet">Upload the files in <code>samples/</code> to try the workbench.</EmptyState>;
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Documents">
      {documents.map((d) => {
        const s = STATUS[d.status];
        const StatusIcon = s.icon;
        const analysable = ANALYSABLE_STATUSES.includes(d.status);
        return (
          <li key={d.id} className={cx('rounded-lg border p-2.5', analysable ? 'border-slate-200 bg-white' : 'border-rose-200 bg-rose-50/40')}>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 accent-indigo-600"
                checked={selected.has(d.id)}
                disabled={!analysable}
                onChange={() => onToggle(d.id)}
                aria-label={`Include ${d.displayName} in analysis`}
              />
              <FormatIcon format={d.format} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-slate-800" title={d.displayName}>
                    {d.displayName}
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <Pill tone={s.tone}>
                    <StatusIcon aria-hidden className="size-3" />
                    {s.label}
                  </Pill>
                  <span>{formatBytes(d.sizeBytes)}</span>
                  {d.pageCount !== null && <span>· {d.pageCount} page{d.pageCount === 1 ? '' : 's'}</span>}
                  {d.extractionMethod === 'ocr' && (
                    <span className="inline-flex items-center gap-0.5" title="Text was read with OCR">
                      · <ScanText aria-hidden className="size-3" /> OCR
                    </span>
                  )}
                </div>
                {!analysable && d.statusReason && <p className="mt-1 text-xs text-rose-700">{d.statusReason}</p>}
                {d.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                    {d.warnings.map((w) => (
                      <li key={w} className="flex gap-1">
                        <TriangleExclamationPoint aria-hidden className="mt-0.5 size-3 shrink-0" />
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Button variant="ghost" className="px-1.5" onClick={() => onDelete(d)} aria-label={`Delete ${d.displayName}`}>
                <Trash className="size-4" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
