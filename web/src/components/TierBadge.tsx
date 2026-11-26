import { Calculator, FileText, Sparkles } from 'lucide-react';
import type { Severity, Tier } from '@workbench/shared';
import { TIER_LABELS } from '../lib/export';
import { cx, Pill } from './ui';

const TIER_STYLE: Record<Tier, { tone: 'slate' | 'blue' | 'violet'; icon: typeof FileText; help: string }> = {
  extracted: { tone: 'slate', icon: FileText, help: 'Read directly from the document; the quote was located in the source text.' },
  derived: { tone: 'blue', icon: Calculator, help: 'Computed by a deterministic rule from extracted values.' },
  interpretation: { tone: 'violet', icon: Sparkles, help: 'Judgement produced by the AI model — check the cited evidence.' },
};

export function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER_STYLE[tier];
  const Icon = s.icon;
  return (
    <Pill tone={s.tone} title={s.help}>
      <Icon aria-hidden className="size-3" />
      {TIER_LABELS[tier]}
    </Pill>
  );
}

export function TierLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500" aria-label="Legend">
      {(Object.keys(TIER_STYLE) as Tier[]).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <TierBadge tier={t} />
          <span className="hidden lg:inline">{TIER_STYLE[t].help.split(';')[0]}</span>
        </span>
      ))}
    </div>
  );
}

const SEVERITY: Record<Severity, string> = {
  high: 'bg-rose-600 text-white',
  medium: 'bg-amber-500 text-white',
  low: 'bg-sky-600 text-white',
  info: 'bg-slate-200 text-slate-700',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', SEVERITY[severity])}>{severity}</span>;
}
