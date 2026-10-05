import { describe, expect, it } from 'vitest';
import { checkCatalogs } from '../../src/shared/i18n-check.ts';

describe('checkCatalogs', () => {
  it('accepts catalogs with the same non-empty keys', () => {
    expect(
      checkCatalogs('zh-TW', { 'zh-TW': { a: '甲' }, en: { a: 'A' } }),
    ).toEqual([]);
  });

  it('reports keys missing from either side', () => {
    expect(
      checkCatalogs('zh-TW', { 'zh-TW': { a: '甲' }, en: { b: 'B' } }),
    ).toEqual([
      { locale: 'zh-TW', key: 'b', problem: 'missing' },
      { locale: 'en', key: 'a', problem: 'missing' },
    ]);
  });

  it('reports blank translations', () => {
    expect(
      checkCatalogs('zh-TW', { 'zh-TW': { a: '甲' }, en: { a: '  ' } }),
    ).toEqual([{ locale: 'en', key: 'a', problem: 'empty' }]);
  });

  it('rejects an unknown reference locale', () => {
    expect(() => checkCatalogs('ja', { en: {} })).toThrow(/ja/);
  });
});
