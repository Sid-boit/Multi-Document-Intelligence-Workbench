import type { AnalysisResult, Finding } from '@workbench/shared';
import { EvidenceChip } from './EvidenceChip';
import { SeverityBadge, TierBadge } from './TierBadge';

const RULE_HELP: Record<string, string> = {
  'identifier.transposition': 'Two adjacent characters swapped',
  'name.spelling_variant': 'Names differ by 1–2 characters',
  'address.house_number': 'House numbers differ',
  'address.postcode': 'Postcodes differ',
  'money.mismatch': 'Amounts differ by more than 1%',
  'date.expired': 'Expiry date has passed',
  'form.blank_field': 'Form field left blank',
  'attribute.not_found': 'Not stated in any document',
};

const VERDICT_STYLE = {
  confirmed: 'text-rose-700',
  needs_review: 'text-amber-700',
  benign: 'text-emerald-700',
} as const;

export function FindingCard({ finding, result, onOpenEvidence }: { finding: Finding; result: AnalysisResult; onOpenEvidence: (handle: string) => void }) {
  const docsChecked = finding.documentIds.map((id) => result.documents.find((d) => d.id === id)?.alias ?? '?');
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs" aria-label={finding.title}>
      <div className="flex flex-wrap items-center gap-2">
        {finding.severity !== 'info' && <SeverityBadge severity={finding.severity} />}
        <h4 className="font-medium text-slate-900">{finding.title}</h4>
        <span className="ml-auto">
          <TierBadge tier={finding.tier} />
        </span>
      </div>
      <p className="mt-1.5 text-sm whitespace-pre-line text-slate-700">{finding.detail}</p>

      {(finding.rule && RULE_HELP[finding.rule]) || finding.verdict ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {finding.rule && RULE_HELP[finding.rule] && (
            <span>
              Rule: <code className="text-slate-600">{finding.rule}</code> — {RULE_HELP[finding.rule]}
            </span>
          )}
          {finding.verdict && (
            <span>
              AI review: <span className={`font-medium ${VERDICT_STYLE[finding.verdict]}`}>{finding.verdict.replace('_', ' ')}</span>
              {finding.verdictNote && <> — {finding.verdictNote}</>}
            </span>
          )}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500">Sources:</span>
        {finding.evidence.length > 0 ? (
          finding.evidence.map((e) => <EvidenceChip key={`${e.handle}-${e.role}`} evidence={result.evidence[e.handle]} role={e.role} onOpen={onOpenEvidence} />)
        ) : (
          <span className="text-xs text-slate-600">checked {docsChecked.join(', ')} — not stated in any</span>
        )}
      </div>
    </article>
  );
}

export function FindingList({ findings, result, empty, onOpenEvidence }: { findings: Finding[]; result: AnalysisResult; empty: string; onOpenEvidence: (h: string) => void }) {
  if (findings.length === 0) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <div className="flex flex-col gap-2">
      {findings.map((f) => (
        <FindingCard key={f.id} finding={f} result={result} onOpenEvidence={onOpenEvidence} />
      ))}
    </div>
  );
}
