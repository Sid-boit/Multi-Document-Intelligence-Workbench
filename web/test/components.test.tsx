import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSummary } from '@workbench/shared';
import { ComparisonMatrix } from '../src/components/ComparisonMatrix';
import { Composer } from '../src/components/Composer';
import { CopyMenu } from '../src/components/CopyMenu';
import { DocumentList } from '../src/components/DocumentList';
import { EvidenceDrawer } from '../src/components/EvidenceDrawer';
import { ExportTxtButton } from '../src/components/ExportTxtButton';
import { FindingCard } from '../src/components/FindingCard';
import { ProgressPanel } from '../src/components/ProgressPanel';
import { Results } from '../src/components/Results';
import { TierBadge } from '../src/components/TierBadge';
import { analysis, discrepancy, missing, result } from './fixtures';

afterEach(() => vi.restoreAllMocks());

function withQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('TierBadge', () => {
  it('distinguishes extracted facts, rule-derived findings and AI interpretation', () => {
    render(
      <>
        <TierBadge tier="extracted" />
        <TierBadge tier="derived" />
        <TierBadge tier="interpretation" />
      </>,
    );
    expect(screen.getByText('Extracted fact')).toBeInTheDocument();
    expect(screen.getByText('Derived (rule)')).toBeInTheDocument();
    expect(screen.getByText('AI interpretation')).toHaveAttribute('title', expect.stringMatching(/AI model/));
  });
});

describe('FindingCard', () => {
  it('shows severity, rule, verdict and clickable source chips for each document', async () => {
    const onOpen = vi.fn();
    render(<FindingCard finding={discrepancy} result={result} onOpenEvidence={onOpen} />);
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('identifier.transposition')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
    const chips = screen.getAllByRole('button', { name: /Open evidence/ });
    expect(chips).toHaveLength(2);
    expect(chips[1]).toHaveAccessibleName(/E2 from cert\.png, page 1, verified \(approximate/);
    await userEvent.click(chips[1]!);
    expect(onOpen).toHaveBeenCalledWith('E2');
  });

  it('for missing information without quotes, names the documents that were checked', () => {
    render(<FindingCard finding={missing} result={result} onOpenEvidence={vi.fn()} />);
    expect(screen.getByText(/checked D1, D2 — not stated in any/)).toBeInTheDocument();
  });
});

describe('ComparisonMatrix', () => {
  it('renders one column per document with match / conflict / not-found cells', async () => {
    const onOpen = vi.fn();
    render(<ComparisonMatrix result={result} onOpenEvidence={onOpen} />);
    expect(screen.getByRole('columnheader', { name: /D1 form\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Licence number in D2: LIC-48231 (conflicts)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Company name not found in D2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Licence number in D1/ }));
    expect(onOpen).toHaveBeenCalledWith('E1');
  });

  it('can filter to inconsistent rows only', async () => {
    render(<ComparisonMatrix result={result} onOpenEvidence={vi.fn()} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    await userEvent.click(screen.getByLabelText('Inconsistent only'));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByText('Company name')).not.toBeInTheDocument();
  });
});

describe('CopyMenu', () => {
  it('copies Markdown by default and JSON from the menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onCopied = vi.fn();
    render(<CopyMenu result={result} section="discrepancies" onCopied={onCopied} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy as Markdown' }));
    expect(writeText.mock.calls[0]![0]).toContain('## Discrepancies');
    expect(onCopied).toHaveBeenLastCalledWith('Copied Markdown to clipboard');

    await userEvent.click(screen.getByRole('button', { name: 'More copy formats' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy as JSON' }));
    expect(JSON.parse(writeText.mock.calls[1]![0] as string).discrepancies).toHaveLength(1);
    expect(onCopied).toHaveBeenLastCalledWith('Copied JSON to clipboard');
  });
});

describe('DocumentList', () => {
  const doc = (over: Partial<DocumentSummary>): DocumentSummary => ({
    id: 'x',
    displayName: 'a.pdf',
    format: 'pdf',
    sizeBytes: 2048,
    status: 'ready',
    statusReason: null,
    extractionMethod: 'text-layer',
    pageCount: 2,
    charCount: 100,
    warnings: [],
    createdAt: '',
    ...over,
  });

  it('shows status, reasons for rejected files and only lets usable documents be selected', async () => {
    const onToggle = vi.fn();
    render(
      <DocumentList
        documents={[
          doc({ id: 'ok', displayName: 'form.pdf' }),
          doc({ id: 'bad', displayName: 'fake.pdf', status: 'rejected', statusReason: 'File content does not match its .pdf extension', pageCount: null }),
          doc({ id: 'ocr', displayName: 'cert.png', format: 'png', status: 'partial', extractionMethod: 'ocr', warnings: ['Low OCR confidence (55%).'] }),
        ]}
        selected={new Set(['ok'])}
        onToggle={onToggle}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('File content does not match its .pdf extension')).toBeInTheDocument();
    expect(screen.getByText('Low OCR confidence (55%).')).toBeInTheDocument();
    expect(screen.getByTitle('Text was read with OCR')).toHaveTextContent('OCR');
    expect(screen.getByLabelText('Include fake.pdf in analysis')).toBeDisabled();
    expect(screen.getByLabelText('Include form.pdf in analysis')).toBeChecked();
    await userEvent.click(screen.getByLabelText('Include cert.png in analysis'));
    expect(onToggle).toHaveBeenCalledWith('ocr');
  });
});

describe('Composer', () => {
  const templates = [{ id: 't1', label: 'Compare all', instruction: 'Compare the information across all uploaded documents.' }];

  it('fills the instruction from a template chip and submits', async () => {
    const onTemplate = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Composer instruction="" onInstruction={vi.fn()} templateId={null} onTemplate={onTemplate} templates={templates} selectedCount={2} submitting={false} onSubmit={onSubmit} />,
    );
    expect(screen.getByRole('button', { name: /Analyse/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Compare all' }));
    expect(onTemplate).toHaveBeenCalledWith(templates[0]);

    rerender(
      <Composer instruction={templates[0]!.instruction} onInstruction={vi.fn()} templateId="t1" onTemplate={onTemplate} templates={templates} selectedCount={2} submitting={false} onSubmit={onSubmit} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Analyse/ }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('explains why it cannot run without documents', () => {
    render(<Composer instruction="Compare these" onInstruction={vi.fn()} templateId={null} onTemplate={vi.fn()} templates={[]} selectedCount={0} submitting={false} onSubmit={vi.fn()} />);
    expect(screen.getByText(/Select at least one ready document/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Analyse/ })).toBeDisabled();
  });
});

describe('ProgressPanel', () => {
  it('shows the current stage and per-document progress', () => {
    render(<ProgressPanel analysis={{ ...analysis, status: 'extracting', result: null, progress: { perDocument: { d1: 'done', d2: 'running' } } }} />);
    expect(screen.getByText('Extract per document')).toHaveClass('font-medium');
    const items = screen.getAllByRole('listitem').filter((li) => within(li).queryByText(/form\.pdf|cert\.png/));
    expect(within(items[0]!).getByText('done')).toBeInTheDocument();
    expect(within(items[1]!).getByText('analysing…')).toBeInTheDocument();
  });
});

describe('Results', () => {
  it('shows the summary as AI interpretation and switches between sections', async () => {
    render(<Results analysis={analysis} onOpenEvidence={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText(/Consolidated summary — AI interpretation/)).toBeInTheDocument();
    expect(screen.getByText('The documents disagree on the licence number.')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument(); // 2 of 3 evidence quotes verified

    await userEvent.click(screen.getByRole('tab', { name: /Discrepancies/ }));
    expect(screen.getByText('Licence number: possible transposed characters')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Warnings/ }));
    expect(screen.getByText(/Low OCR confidence/)).toBeInTheDocument();
  });
});

describe('EvidenceDrawer', () => {
  it('loads the cited page and highlights the evidence span', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ documentId: 'd1', pageNo: 1, pageCount: 2, text: 'Existing licence number: LIC-48213\nOther text' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    withQuery(<EvidenceDrawer evidence={result.evidence.E1!} onClose={vi.fn()} />);
    expect(screen.getByText(/Verified: the quote was found verbatim/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('page-text')).toBeInTheDocument());
    const mark = screen.getByTestId('page-text').querySelector('mark');
    expect(mark?.textContent).toBe('LIC-48213');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/documents/d1/pages/1', undefined);
  });

  it('warns clearly when evidence is unverified', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ documentId: 'd1', pageNo: 1, pageCount: 1, text: 'x' })));
    withQuery(<EvidenceDrawer evidence={result.evidence.E3!} onClose={vi.fn()} />);
    expect(screen.getByText(/Not verified/)).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ documentId: 'd1', pageNo: 1, pageCount: 1, text: 'x' })));
    const onClose = vi.fn();
    withQuery(<EvidenceDrawer evidence={result.evidence.E1!} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ExportTxtButton', () => {
  it('downloads the current section as a .txt file and confirms it', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const onExported = vi.fn();
    render(<ExportTxtButton result={result} section="discrepancies" onExported={onExported} />);
    await userEvent.click(screen.getByRole('button', { name: /Export \.txt/ }));
    expect(click).toHaveBeenCalled();
    expect(await (createObjectURL.mock.calls[0]![0] as Blob).text()).toMatch(/^DISCREPANCIES/);
    expect(onExported).toHaveBeenCalledWith(expect.stringMatching(/^Downloaded analysis-discrepancies-\d{4}-\d{2}-\d{2}\.txt$/));
  });

  it('sits beside the Copy menu in the results', () => {
    render(<Results analysis={analysis} onOpenEvidence={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Export all \.txt/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Export \.txt/ })).toBeInTheDocument();
  });
});
