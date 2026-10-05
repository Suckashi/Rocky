export type Catalog = Record<string, string>;

export interface CatalogProblem {
  locale: string;
  key: string;
  problem: 'missing' | 'empty';
}

/** Every locale must define the same keys as the reference locale, with non-empty text. */
export function checkCatalogs(
  reference: string,
  catalogs: Record<string, Catalog>,
): CatalogProblem[] {
  const base = catalogs[reference];
  if (!base) throw new Error(`Reference locale ${reference} not found`);
  const allKeys = new Set(Object.values(catalogs).flatMap(Object.keys));
  const problems: CatalogProblem[] = [];
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const key of [...allKeys].sort()) {
      const text = catalog[key];
      if (text === undefined)
        problems.push({ locale, key, problem: 'missing' });
      else if (text.trim() === '')
        problems.push({ locale, key, problem: 'empty' });
    }
  }
  return problems;
}
