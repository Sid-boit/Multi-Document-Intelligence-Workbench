import { Upload } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { SUPPORTED_EXTENSIONS } from '@workbench/shared';
import { precheckFiles } from '../lib/text';
import { cx, Spinner } from './ui';

export function UploadZone({
  onFiles,
  uploading,
  limits,
  onRejected,
}: {
  onFiles: (files: File[]) => void;
  uploading: boolean;
  limits: { maxFileMb: number; maxFiles: number };
  onRejected: (msg: string) => void;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: true,
    disabled: uploading,
    // No `accept` filter on purpose: unsupported files are sent to the server so the
    // user gets a recorded, specific rejection reason for every file.
    onDrop: (files) => {
      const { accepted, rejected } = precheckFiles(files, limits);
      if (rejected.length > 0) onRejected(rejected.map((r) => `${r.name}: ${r.reason}`).join('; '));
      if (accepted.length > 0) onFiles(accepted);
    },
  });

  return (
    <div
      {...getRootProps()}
      className={cx(
        'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition',
        isDragActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50',
        uploading && 'cursor-wait opacity-70',
      )}
    >
      <input {...getInputProps()} aria-label="Upload documents" data-testid="file-input" />
      {uploading ? <Spinner className="size-6 text-indigo-600" /> : <Upload aria-hidden className="size-6 text-indigo-600" />}
      <p className="text-sm font-medium text-slate-700">{uploading ? 'Uploading and extracting…' : isDragActive ? 'Drop to upload' : 'Drop documents here or click to browse'}</p>
      <p className="text-xs text-slate-500">
        {SUPPORTED_EXTENSIONS.join(' ').replace(/\./g, '').toUpperCase()} · up to {limits.maxFileMb} MB each · {limits.maxFiles} per upload
      </p>
    </div>
  );
}
