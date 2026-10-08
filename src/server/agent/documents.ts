// Document tools: read any of the six formats as Markdown, create one from Markdown, and
// edit Office files in place. Creating and editing produce the exact bytes before the gate
// decides; the approval binds to them, and the tool writes those same bytes.
import { existsSync, readFileSync } from 'node:fs';
import { tool } from 'langchain';
import { z } from 'zod';
import { fromMarkdown } from '../documents/create.ts';
import {
  editDocument,
  EditError,
  type EditRequest,
} from '../documents/edit.ts';
import { formatOf, isBinary } from '../documents/formats.ts';
import { toMarkdown } from '../documents/read.ts';
import type { Executor } from '../effects/execute.ts';
import type { Effect } from '../effects/types.ts';
import { currentEffect, currentPass } from './backend.ts';
import { resolveVirtual, type ToolEffect } from './workspace.ts';

export const DOCUMENT_WRITE_TOOLS = new Set([
  'create_document',
  'edit_document',
]);
const READ_LIMIT = 80_000;

const FORMATS = 'pdf, docx, xlsx, pptx, md or html';

async function currentMarkdown(path: string): Promise<string | undefined> {
  const format = formatOf(path);
  if (!format || !existsSync(path)) return undefined;
  try {
    return await toMarkdown(new Uint8Array(readFileSync(path)), format);
  } catch {
    return undefined;
  }
}

/** The write a document tool call would make, computed once for the gate and the tool. */
export async function documentEffect(
  name: string,
  args: Record<string, unknown>,
  root: string,
): Promise<ToolEffect> {
  try {
    const path = resolveVirtual(root, String(args['file_path'] ?? ''));
    const format = formatOf(path);
    if (!format) return { error: `Error: unsupported format; use ${FORMATS}.` };
    let bytes: Uint8Array;
    if (name === 'create_document') {
      bytes = await fromMarkdown(
        String(args['markdown'] ?? ''),
        format,
        String(args['title'] ?? ''),
      );
    } else {
      if (!existsSync(path))
        return { error: `Error: file not found: ${String(args['file_path'])}` };
      bytes = await editDocument(
        new Uint8Array(readFileSync(path)),
        format,
        args as EditRequest,
      );
    }
    const binary = isBinary(format);
    const before = await currentMarkdown(path);
    const effect: Effect = {
      kind: 'write',
      path,
      operation: existsSync(path) ? 'edit' : 'create',
      content: Buffer.from(bytes).toString(binary ? 'base64' : 'utf8'),
      ...(binary
        ? {
            encoding: 'base64' as const,
            preview: await toMarkdown(bytes, format),
          }
        : {}),
    };
    return { effect, ...(before !== undefined ? { before } : {}) };
  } catch (error) {
    if (error instanceof EditError) return { error: `Error: ${error.message}` };
    if (error instanceof Error && error.message === 'no-cjk-font')
      return {
        error:
          'Error: no Chinese font was found for the PDF. Tell the user to set ROCKY_PDF_FONT to a .ttf/.ttc font file.',
      };
    if (error instanceof Error && error.message === 'xlsx-needs-table')
      return {
        error:
          'Error: an xlsx needs at least one Markdown table (a "## Sheet name" heading before it names the sheet).',
      };
    return {
      error: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function createDocumentTools(root: string, executor: Executor) {
  const write = (verb: string) => () => {
    const pass = currentPass.getStore();
    const effect = currentEffect.getStore();
    if (!pass || effect?.kind !== 'write')
      return 'Error: no approval for this document.';
    executor.write(pass, effect);
    return `${verb} ${effect.path}.`;
  };
  return [
    tool(
      async (input) => {
        const path = resolveVirtual(root, input.file_path);
        const format = formatOf(path);
        if (!format) return `Error: unsupported format; use ${FORMATS}.`;
        if (!existsSync(path))
          return `Error: file not found: ${input.file_path}`;
        const text = await toMarkdown(
          new Uint8Array(readFileSync(path)),
          format,
        );
        if (format === 'pdf' && !text.replace(/## Page \d+/g, '').trim())
          return 'No text was found in this PDF. It may be a scanned image or use a font Rocky cannot read; say so to the user.';
        return text.length > READ_LIMIT
          ? `${text.slice(0, READ_LIMIT)}\n\n[truncated: ${text.length - READ_LIMIT} more characters]`
          : text;
      },
      {
        name: 'read_document',
        description: `Read a document (${FORMATS}) as Markdown. Use it for pdf, docx, xlsx and pptx, which read_file cannot read.`,
        schema: z.object({
          file_path: z
            .string()
            .describe('Project path, e.g. "/docs/report.docx"'),
        }),
      },
    ),
    tool(write('Created'), {
      name: 'create_document',
      description:
        `Create (or replace) a document from Markdown; the format comes from the extension (${FORMATS}). ` +
        'docx/pdf: headings, paragraphs, lists, tables. pptx: each # or ## heading starts a slide. ' +
        'xlsx: each Markdown table becomes a sheet named by the heading before it; cells starting with "=" are formulas.',
      schema: z.object({
        file_path: z.string(),
        markdown: z.string().max(200_000),
        title: z.string().max(200).optional(),
      }),
    }),
    tool(write('Edited'), {
      name: 'edit_document',
      description:
        'Edit a docx, pptx, xlsx, md or html file in place, keeping its formatting. replacements: exact text to find and replace ' +
        '(works across formatting runs). cells (xlsx only): set a cell by address, e.g. {"sheet": "銷售", "cell": "B3", "value": "120"}; "=SUM(B2:B4)" sets a formula. PDFs cannot be edited.',
      schema: z.object({
        file_path: z.string(),
        replacements: z
          .array(z.object({ find: z.string().min(1), replace: z.string() }))
          .optional(),
        cells: z
          .array(
            z.object({
              sheet: z.string().optional(),
              cell: z.string(),
              value: z.string(),
            }),
          )
          .optional(),
      }),
    }),
  ];
}
