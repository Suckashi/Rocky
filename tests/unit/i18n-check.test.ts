import { describe, expect, it } from 'vitest';
import {
  checkCatalogs,
  findHardcodedText,
} from '../../src/shared/i18n-check.ts';

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

describe('findHardcodedText', () => {
  it('flags JSX text and literal labels, in any language', () => {
    const source = [
      '<button aria-label="Close">',
      '  <span>儲存</span>',
      '  <img alt="Roko waving" />',
      '</button>',
    ].join('\n');
    expect(findHardcodedText(source).map((f) => f.text)).toEqual([
      'Close',
      '儲存',
      'Roko waving',
    ]);
  });

  it('accepts text that goes through t(), empty alt text, symbols and allowed names', () => {
    const source = [
      "<button aria-label={t('chat.send')}>{t('chat.send')}</button>",
      '<img alt="" />',
      "<span>← {t('settings.back')}</span>",
      '<strong>Rocky</strong>',
      'const f = (a: Array<string>) => a.length > 0 && b < 1;',
    ].join('\n');
    expect(findHardcodedText(source, ['Rocky'])).toEqual([]);
  });
});
