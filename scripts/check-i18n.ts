import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCatalogs, type Catalog } from '../src/shared/i18n-check.ts';

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
if (problems.length > 0) process.exit(1);
console.log(`i18n: ${Object.keys(catalogs).join(', ')} consistent`);
