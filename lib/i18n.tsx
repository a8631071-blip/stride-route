import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { setStrideWidgetLocale } from "@/modules/stride-widget";
import {
  formatDate,
  formatNumber,
  LANGUAGE_OPTIONS,
  readLanguageSetting,
  resolveLanguage,
  setCurrentLocale,
  translate,
  writeLanguageSetting,
  type AppLanguage,
  type ResolvedLocale,
} from "./i18n-core";

type I18nContextValue = {
  language: AppLanguage;
  locale: ResolvedLocale;
  ready: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatNumber: (value: number) => string;
  formatDate: (value: number | Date, options: Intl.DateTimeFormatOptions) => string;
  setLanguage: (language: AppLanguage) => Promise<void>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export { LANGUAGE_OPTIONS };
export type { AppLanguage };

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>("system");
  const [ready, setReady] = useState(false);
  const locale = resolveLanguage(language);

  useEffect(() => {
    let active = true;
    void readLanguageSetting().then((saved) => {
      if (!active) return;
      setLanguageState(saved);
      const resolved = resolveLanguage(saved);
      setCurrentLocale(resolved);
      void setStrideWidgetLocale(resolved).catch(() => false);
      setReady(true);
    }).catch(() => setReady(true));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setCurrentLocale(locale);
    void setStrideWidgetLocale(locale).catch(() => false);
  }, [locale]);

  const setLanguage = useCallback(async (next: AppLanguage) => {
    await writeLanguageSetting(next);
    setLanguageState(next);
    const resolved = resolveLanguage(next);
    setCurrentLocale(resolved);
    await setStrideWidgetLocale(resolved).catch(() => false);
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    locale,
    ready,
    t: (key, vars) => translate(key, vars, locale),
    formatNumber: (value) => formatNumber(value, locale),
    formatDate: (value, options) => formatDate(value, options, locale),
    setLanguage,
  }), [language, locale, ready, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
