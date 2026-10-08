// Every user-facing string goes through t(); zh-TW is the default and complete first.
import { createContext, useContext, type ReactNode } from 'react';
import en from './en.json' with { type: 'json' };
import zhTW from './zh-TW.json' with { type: 'json' };
import type { Locale } from '../api.ts';

export type MessageKey = keyof typeof zhTW;
const catalogs: Record<Locale, Record<MessageKey, string>> = {
  'zh-TW': zhTW,
  en,
};

export type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

export function translator(locale: Locale): Translate {
  const catalog = catalogs[locale];
  return (key, vars) =>
    catalog[key].replace(/\{(\w+)\}/g, (match, name: string) =>
      vars && name in vars ? String(vars[name]) : match,
    );
}

const I18n = createContext<{ locale: Locale; t: Translate }>({
  locale: 'zh-TW',
  t: translator('zh-TW'),
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <I18n.Provider value={{ locale, t: translator(locale) }}>
      {children}
    </I18n.Provider>
  );
}

export const useI18n = () => useContext(I18n);
