// The six document formats Rocky reads, creates and (for Office files) edits in place.
import { extname } from 'node:path';

export type Format = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'md' | 'html';

export function formatOf(path: string): Format | undefined {
  const ext = extname(path).toLowerCase().slice(1);
  if (ext === 'markdown') return 'md';
  if (ext === 'htm') return 'html';
  return (['pdf', 'docx', 'xlsx', 'pptx', 'md', 'html'] as const).find(
    (f) => f === ext,
  );
}

/** Formats stored as bytes (written base64-encoded); md and html are text. */
export const isBinary = (format: Format) =>
  format !== 'md' && format !== 'html';
