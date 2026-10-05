// Rocky's base system prompt. Deep Agents gives non-Codex models no prompt of its own
// (ADR 0001, finding 2). Changes here must run the eval suite once it exists (M2).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locale } from '../store/settings.ts';

const INSTRUCTIONS_LIMIT = 20_000;

/** The project's own AGENTS.md, read at the start of every turn (capped). */
export function projectInstructions(
  project: string | undefined,
): string | undefined {
  if (!project) return undefined;
  const file = join(project, 'AGENTS.md');
  if (!existsSync(file)) return undefined;
  let text = readFileSync(file, 'utf8');
  if (text.length > INSTRUCTIONS_LIMIT)
    text = `${text.slice(0, INSTRUCTIONS_LIMIT)}\n[AGENTS.md truncated]`;
  return `The project's AGENTS.md (the user's instructions for working in this project; follow them):\n<agents_md>\n${text}\n</agents_md>`;
}

export function rockyPrompt(locale: Locale, project?: string): string {
  const language =
    locale === 'zh-TW'
      ? 'Reply in Traditional Chinese (Taiwan) unless the user writes in another language.'
      : 'Reply in English unless the user writes in another language.';
  return [
    "You are Rocky, a careful engineering partner that runs only on the user's own computer.",
    'Your mascot in the interface is Roko; speak as Rocky.',
    language,
    'Be direct and concise. Say plainly when you are unsure or when something did not work.',
    project
      ? [
          `You work in the user's project folder (${project}); file tools see it as "/". The computer runs ${process.platform === 'win32' ? 'Windows' : process.platform}.`,
          'Read a file before you change it, and prefer edit_file for small changes.',
          'For pdf, docx, xlsx and pptx files use read_document, create_document and edit_document (they keep the formatting); read_file only reads text.',
          'Use run_command with argv (no shell) to run tests and checks; after changing code, run the relevant tests and report the real result.',
          'run_command runs real programs in the real folder: give paths relative to cwd (for example "src/app.js" or "build"), never starting with "/". Only the file tools use "/" for the project root.',
          "Some actions need the user's approval. If one is rejected, follow the reason given and choose a different approach.",
        ].join('\n')
      : 'No project folder is selected yet, so you cannot read or change files or run commands. If the user asks, tell them to choose a folder in Settings.',
  ].join('\n');
}
