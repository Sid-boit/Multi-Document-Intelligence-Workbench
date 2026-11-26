import { Sparkles } from 'lucide-react';
import type { AnalysisTemplate } from '@workbench/shared';
import { Button, cx, Spinner } from './ui';

const MAX = 2000;

export function Composer({
  instruction,
  onInstruction,
  templateId,
  onTemplate,
  templates,
  selectedCount,
  submitting,
  onSubmit,
}: {
  instruction: string;
  onInstruction: (v: string) => void;
  templateId: string | null;
  onTemplate: (t: AnalysisTemplate) => void;
  templates: AnalysisTemplate[];
  selectedCount: number;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const trimmed = instruction.trim();
  const tooShort = trimmed.length < 3;
  const disabled = submitting || tooShort || instruction.length > MAX || selectedCount === 0;
  const hint = selectedCount === 0 ? 'Select at least one ready document.' : tooShort ? 'Describe the analysis you need.' : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit();
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Example instructions">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTemplate(t)}
            className={cx(
              'rounded-full px-2.5 py-1 text-xs ring-1 transition',
              templateId === t.id ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:ring-indigo-400',
            )}
            title={t.instruction}
          >
            {t.label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="instruction">
        Analysis instruction
      </label>
      <textarea
        id="instruction"
        value={instruction}
        onChange={(e) => onInstruction(e.target.value)}
        rows={3}
        maxLength={MAX}
        placeholder="e.g. Identify inconsistencies between the application form and supporting documents."
        className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {hint ?? `${selectedCount} document${selectedCount === 1 ? '' : 's'} selected · each is analysed separately, then compared`}
          <span className="ml-2 text-slate-400">
            {instruction.length}/{MAX}
          </span>
        </p>
        <Button type="submit" variant="primary" disabled={disabled}>
          {submitting ? <Spinner /> : <Sparkles className="size-4" />}
          Analyse
        </Button>
      </div>
    </form>
  );
}
