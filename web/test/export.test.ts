import { afterEach, describe, expect, it, vi } from 'vitest';
import { citation, copyText, downloadText, exportFileName, toJson, toMarkdown, toPlainText } from '../src/lib/export';
import { result } from './fixtures';

describe('toMarkdown', () => {
  it('exports everything with documents, a comparison table and source citations', () => {
    const md = toMarkdown(result, 'all', 'Highlight discrepancies');
    expect(md).toContain('# Document analysis');
    expect(md).toContain('> Highlight discrepancies');
    expect(md).toContain('- D1: form.pdf');
    expect(md).toContain('| Attribute | D1 form.pdf | D2 cert.png | Status |');
    expect(md).toContain('| Licence number | ✓ LIC-48213 (E1) | ✗ LIC-48231 (E2) | inconsistent |');
    expect(md).toContain('| Company name | ✓ Northwind Ltd (E3) | – | partial |');
    expect(md).toContain('**Licence number: possible transposed characters** (high) _Derived (rule)_');
    expect(md).toContain('[D1 · p1 · E1✓] [D2 · p1 · E2~]');
    expect(md).toContain('AI verdict: confirmed');
    expect(md).toContain('[checked: D1, D2]'); // missing info names the documents searched
    expect(md).toContain('## Warnings');
  });

  it('exports a single section only', () => {
    const md = toMarkdown(result, 'discrepancies');
    expect(md.startsWith('## Discrepancies')).toBe(true);
    expect(md).not.toContain('## Comparison');
    expect(md).not.toContain('# Document analysis');
  });

  it('labels facts and AI interpretation distinctly', () => {
    expect(toMarkdown(result, 'overview')).toContain('_AI interpretation_');
    expect(toMarkdown(result, 'keyValues')).toContain('_Extracted fact_');
  });

  it('escapes table pipes in values', () => {
    const r = structuredClone(result);
    r.comparison[0]!.cells[0]!.value = 'A|B';
    expect(toMarkdown(r, 'comparison')).toContain('A\\|B');
  });
});

describe('toJson', () => {
  it('exports the full result', () => {
    expect(JSON.parse(toJson(result))).toEqual(result);
  });

  it('exports a section together with only the evidence it cites', () => {
    const parsed = JSON.parse(toJson(result, 'discrepancies'));
    expect(parsed.discrepancies).toHaveLength(1);
    expect(Object.keys(parsed.evidence).sort()).toEqual(['E1', 'E2']);
    expect(parsed.documents).toHaveLength(2);
  });
});

describe('citation', () => {
  it('shows alias, page, handle and verification state', () => {
    expect(citation(result.evidence.E3!)).toBe('[D1 · p1 · E3?]');
  });
});

describe('copyText', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await copyText('hello');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the Clipboard API is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    await copyText('fallback');
    expect(exec).toHaveBeenCalledWith('copy');
  });
});

describe('toPlainText (Export .txt)', () => {
  it('turns Markdown into readable plain text while keeping tables and citations', () => {
    const txt = toPlainText(result, 'all', 'Highlight discrepancies');
    expect(txt).toContain('DOCUMENT ANALYSIS\n=================');
    expect(txt).toContain('DISCREPANCIES\n-------------');
    expect(txt).toContain('Highlight discrepancies');
    expect(txt).not.toMatch(/^#/m);
    expect(txt).not.toContain('**');
    expect(txt).toContain('Licence number: possible transposed characters (high) Derived (rule)');
    expect(txt).toContain('[D1 · p1 · E1✓] [D2 · p1 · E2~]');
    expect(txt).toContain('| Licence number | ✓ LIC-48213 (E1) | ✗ LIC-48231 (E2) | inconsistent |');
  });

  it('exports a single section', () => {
    const txt = toPlainText(result, 'missing');
    expect(txt.startsWith('MISSING INFORMATION')).toBe(true);
    expect(txt).not.toContain('DISCREPANCIES');
  });
});

describe('exportFileName', () => {
  it('names the file after the section and date', () => {
    const d = new Date('2026-11-26T10:00:00Z');
    expect(exportFileName('all', d)).toBe('analysis-full-2026-11-26.txt');
    expect(exportFileName('discrepancies', d)).toBe('analysis-discrepancies-2026-11-26.txt');
  });
});

describe('downloadText', () => {
  it('downloads a UTF-8 text blob with the given file name', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadText('hello', 'a.txt');
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(await blob.text()).toBe('hello');
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('a.txt');
  });
});

describe('side-by-side export', () => {
  it('uses the side-by-side legend and the • marker', () => {
    const sbs = structuredClone(result);
    sbs.meta.comparisonMode = 'side_by_side';
    sbs.comparison[0]!.cells = sbs.comparison[0]!.cells.map((c) => ({ ...c, status: 'reported' as const }));
    const md = toMarkdown(sbs);
    expect(md).toContain('Side-by-side comparison of different entities');
    expect(md).toContain('• LIC-48213 (E1)');
  });
});
