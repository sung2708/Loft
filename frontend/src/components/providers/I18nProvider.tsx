"use client";

import { useLayoutEffect } from "react";
import { useI18nStore } from "@/lib/i18n/useTranslation";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const initLocale = useI18nStore((state) => state.initLocale);
  useLayoutEffect(() => initLocale(), [initLocale]);
  return children;
}
