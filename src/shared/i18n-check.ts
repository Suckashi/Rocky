import ts from 'typescript';

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

export interface HardcodedText {
  line: number;
  text: string;
}

const LETTERS = /[\p{L}]/u;
const TEXT_ATTRIBUTES = new Set(['aria-label', 'alt', 'placeholder', 'title']);

/**
 * User-facing text written straight into a component instead of going through t():
 * JSX text between tags, and literal aria-label / alt / placeholder / title values.
 * Parsed with the TypeScript compiler, so generics and comparisons are not mistaken for JSX.
 */
export function findHardcodedText(
  source: string,
  allow: string[] = [],
): HardcodedText[] {
  const file = ts.createSourceFile(
    'component.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: HardcodedText[] = [];
  const report = (node: ts.Node, text: string) => {
    const trimmed = text.trim();
    if (!LETTERS.test(trimmed) || allow.includes(trimmed)) return;
    found.push({
      line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      text: trimmed,
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) report(node, node.text);
    if (
      ts.isJsxAttribute(node) &&
      TEXT_ATTRIBUTES.has(node.name.getText(file)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      report(node, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
