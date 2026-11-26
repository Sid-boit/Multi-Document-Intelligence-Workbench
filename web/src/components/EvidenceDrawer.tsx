import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Evidence } from '@workbench/shared';
import { api } from '../lib/api';
import { splitForHighlight } from '../lib/text';
import { Button, Spinner } from './ui';

const VERIFY_TEXT: Record<Evidence['verification'], { text: string; cls: string }> = {
  exact: { text: 'Verified: the quote was found verbatim in the document.', cls: 'bg-emerald-50 text-emerald-800' },
  fuzzy: { text: 'Verified approximately (e.g. OCR noise): the closest matching text is highlighted.', cls: 'bg-amber-50 text-amber-800' },
  unverified: { text: 'Not verified: this quote could not be found in the document. Treat it with caution.', cls: 'bg-rose-50 text-rose-800' },
};

/** Side panel showing the cited page with the evidence span highlighted. */
export function EvidenceDrawer({ evidence, onClose }: { evidence: Evidence; onClose: () => void }) {
  const page = useQuery({
    queryKey: ['page', evidence.documentId, evidence.pageNo],
    queryFn: () => api.getPage(evidence.documentId, evidence.pageNo),
  });
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    markRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [page.data, evidence.handle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parts = page.data ? splitForHighlight(page.data.text, evidence.charStart, evidence.charEnd, evidence.quote) : null;
  const v = VERIFY_TEXT[evidence.verification];

  return (
    <aside
      role="dialog"
      aria-label={`Evidence ${evidence.handle}`}
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl"
    >
      <header className="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500">
            Evidence <span className="font-mono">{evidence.handle}</span> · {evidence.source === 'deterministic' ? 'rule-based extraction' : 'AI extraction'}
          </p>
          <h3 className="truncate font-semibold text-slate-900">
            <span className="font-mono text-indigo-700">{evidence.alias}</span> {evidence.documentName}
          </h3>
          <p className="text-xs text-slate-500">
            Page {evidence.pageNo}
            {page.data ? ` of ${page.data.pageCount}` : ''}
            {evidence.attribute ? ` · ${evidence.attribute.replace(/_/g, ' ')}` : ''}
            {evidence.value ? ` = “${evidence.value}”` : ''}
          </p>
        </div>
        <Button variant="ghost" className="px-1.5" onClick={onClose} aria-label="Close evidence">
          <X className="size-5" />
        </Button>
      </header>
      <div className={`px-4 py-2 text-xs ${v.cls}`}>{v.text}</div>
      <blockquote className="mx-4 mt-3 border-l-4 border-amber-300 bg-amber-50/50 px-3 py-2 text-sm text-slate-700 italic">“{evidence.quote}”</blockquote>
      <div className="mt-3 min-h-0 flex-1 overflow-auto px-4 pb-6">
        {page.isLoading && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner /> Loading page…
          </p>
        )}
        {page.error && <p className="text-sm text-rose-700">Could not load the page: {(page.error as Error).message}</p>}
        {page.data && (
          <pre className="rounded-lg bg-slate-50 p-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-slate-800" data-testid="page-text">
            {parts ? (
              <>
                {parts.before}
                <mark ref={markRef} className="evidence-highlight">
                  {parts.match}
                </mark>
                {parts.after}
              </>
            ) : (
              page.data.text
            )}
          </pre>
        )}
      </div>
    </aside>
  );
}
