import { Check, ChevronDown, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from '@workbench/shared';
import { copyText, toJson, toMarkdown, type ExportSection } from '../lib/export';
import { Button } from './ui';

/** "Copy" split button: Markdown (with citations) or JSON. */
export function CopyMenu({ result, section, instruction, label = 'Copy', onCopied }: { result: AnalysisResult; section: ExportSection; instruction?: string; label?: string; onCopied?: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const copy = async (format: 'markdown' | 'json') => {
    setOpen(false);
    try {
      await copyText(format === 'markdown' ? toMarkdown(result, section, instruction) : toJson(result, section));
      setDone(true);
      setTimeout(() => setDone(false), 1500);
      onCopied?.(`Copied ${format === 'markdown' ? 'Markdown' : 'JSON'} to clipboard`);
    } catch {
      onCopied?.('Copy failed — your browser blocked clipboard access');
    }
  };

  return (
    <div className="relative inline-flex" ref={ref}>
      <Button className="rounded-r-none" onClick={() => void copy('markdown')} aria-label={`${label} as Markdown`}>
        {done ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        {label}
      </Button>
      <Button className="rounded-l-none border-l-0 px-1.5" onClick={() => setOpen((o) => !o)} aria-label="More copy formats" aria-expanded={open}>
        <ChevronDown className="size-4" />
      </Button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-20 mt-1 w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => void copy('markdown')}>
            Copy as Markdown
          </button>
          <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => void copy('json')}>
            Copy as JSON
          </button>
        </div>
      )}
    </div>
  );
}
