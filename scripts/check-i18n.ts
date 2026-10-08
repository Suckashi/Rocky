import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkCatalogs,
  findHardcodedText,
  type Catalog,
} from '../src/shared/i18n-check.ts';

const dir = join(import.meta.dirname, '..', 'src', 'web', 'i18n');
const catalogs: Record<string, Catalog> = {};
for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
  catalogs[file.replace(/\.json$/, '')] = JSON.parse(
    readFileSync(join(dir, file), 'utf8'),
  ) as Catalog;
}

const problems = checkCatalogs('zh-TW', catalogs);
for (const { locale, key, problem } of problems) {
  console.error(`${locale}: ${key} is ${problem}`);
}
const web = join(import.meta.dirname, '..', 'src', 'web');
let hardcoded = 0;
for (const file of readdirSync(web, { recursive: true, encoding: 'utf8' })) {
  if (!file.endsWith('.tsx')) continue;
  for (const { line, text } of findHardcodedText(
    readFileSync(join(web, file), 'utf8'),
  )) {
    console.error(
      `src/web/${file.replaceAll('\\', '/')}:${line}: hardcoded UI text "${text}"`,
    );
    hardcoded++;
  }
}
if (problems.length > 0 || hardcoded > 0) process.exit(1);
console.log(`i18n: ${Object.keys(catalogs).join(', ')} consistent`);
