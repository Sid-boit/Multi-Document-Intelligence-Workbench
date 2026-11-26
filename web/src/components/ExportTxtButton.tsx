import { FileDown } from 'lucide-react';
import type { AnalysisResult } from '@workbench/shared';
import { downloadText, exportFileName, toPlainText, type ExportSection } from '../lib/export';
import { Button } from './ui';

/** Downloads the result (or one section of it) as a plain .txt file, with citations. */
export function ExportTxtButton({
  result,
  section,
  instruction,
  label = 'Export .txt',
  onExported,
}: {
  result: AnalysisResult;
  section: ExportSection;
  instruction?: string;
  label?: string;
  onExported?: (msg: string) => void;
}) {
  const exportTxt = () => {
    try {
      const name = exportFileName(section);
      downloadText(toPlainText(result, section, instruction), name);
      onExported?.(`Downloaded ${name}`);
    } catch {
      onExported?.('Export failed');
    }
  };
  return (
    <Button onClick={exportTxt} aria-label={`${label} (plain text file)`}>
      <FileDown className="size-4" />
      {label}
    </Button>
  );
}
