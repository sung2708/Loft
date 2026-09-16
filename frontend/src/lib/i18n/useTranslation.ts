"use client";

import { create } from "zustand";
import { useEffect } from "react";
import type { Locale, TranslationDictionary } from "./types";
import { vi } from "./dictionaries/vi";
import { en } from "./dictionaries/en";

const dictionaries: Record<Locale, TranslationDictionary> = { vi, en };

interface I18nStore {
  locale: Locale;
  t: TranslationDictionary;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  initLocale: () => void;
}

export const useI18nStore = create<I18nStore>((set, _get, api) => {
  api.getInitialState = () => api.getState();
  return {
    locale: "vi",
    t: vi,
  setLocale: (locale: Locale) => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
    try {
      localStorage.setItem("loft.locale", locale);
    } catch {
      // Ignore storage errors in restricted contexts
    }
    set({ locale, t: dictionaries[locale] });
  },
  toggleLocale: () => {
    set((state) => {
      const next: Locale = state.locale === "vi" ? "en" : "vi";
      if (typeof document !== "undefined") document.documentElement.lang = next;
      try {
        localStorage.setItem("loft.locale", next);
      } catch {
        // Ignore storage errors
      }
      return { locale: next, t: dictionaries[next] };
    });
  },
  initLocale: () => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem("loft.locale");
      if (saved === "en" || saved === "vi") {
        document.documentElement.lang = saved;
        set({ locale: saved, t: dictionaries[saved] });
      }
    } catch {
      // Ignore storage errors
    }
  },
  };
});

export function useTranslation() {
  const { locale, t, setLocale, toggleLocale, initLocale } = useI18nStore();

  useEffect(() => {
    initLocale();
  }, [initLocale]);

  return { locale, t, setLocale, toggleLocale };
}
