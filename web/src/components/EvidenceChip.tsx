import { Check, CircleX, FileQuestionMark } from 'lucide-react';
import type { Evidence, EvidenceRole } from '@workbench/shared';
import { cx } from './ui';

const VERIFY = {
  exact: { icon: Check, cls: 'text-emerald-600', label: 'verified (exact match)' },
  fuzzy: { icon: Check, cls: 'text-amber-600', label: 'verified (approximate match, e.g. OCR noise)' },
  unverified: { icon: FileQuestionMark, cls: 'text-rose-600', label: 'NOT verified — quote not found in the document' },
} as const;

const ROLE_STYLE: Record<EvidenceRole, string> = {
  supports: 'ring-slate-300 bg-white',
  contradicts: 'ring-rose-300 bg-rose-50',
  expected_in: 'ring-amber-300 bg-amber-50',
};

/** A clickable source citation: "D2 · p1 · E7 ✓". Opens the evidence viewer. */
export function EvidenceChip({ evidence, role = 'supports', onOpen }: { evidence: Evidence | undefined; role?: EvidenceRole; onOpen: (handle: string) => void }) {
  if (!evidence) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-rose-600 ring-1 ring-rose-200">
        <CircleX className="size-3" /> missing evidence
      </span>
    );
  }
  const v = VERIFY[evidence.verification];
  const Icon = v.icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(evidence.handle)}
      title={`${evidence.documentName}, page ${evidence.pageNo} — ${v.label}\n“${evidence.quote}”`}
      aria-label={`Open evidence ${evidence.handle} from ${evidence.documentName}, page ${evidence.pageNo}, ${v.label}`}
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-slate-700 ring-1 transition hover:ring-indigo-400 focus-visible:outline-2 focus-visible:outline-indigo-500',
        ROLE_STYLE[role],
      )}
    >
      <span className="font-semibold">{evidence.alias}</span>
      <span className="text-slate-400">·</span>
      <span>p{evidence.pageNo}</span>
      <span className="text-slate-400">·</span>
      <span>{evidence.handle}</span>
      <Icon aria-hidden className={cx('size-3', v.cls)} />
    </button>
  );
}
