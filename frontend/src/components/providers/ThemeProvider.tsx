"use client";

import { useLayoutEffect, useRef } from "react";
import { useUIStore } from "@/stores/useUIStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const initialized = useRef(false);
  useLayoutEffect(() => {
    let activeTheme = theme;
    if (!initialized.current) {
      initialized.current = true;
      const stored = localStorage.getItem("loft.theme");
      if (
        stored === "system" || stored === "light" || stored === "dark"
      ) {
        activeTheme = stored;
        if (stored !== theme) setTheme(stored);
      }
    }
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        activeTheme === "system" ? (media.matches ? "dark" : "light") : activeTheme;
      root.classList.remove("dark", "light");
      root.classList.add(resolved);
      root.dataset.theme = activeTheme;
      localStorage.setItem("loft.theme", activeTheme);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [setTheme, theme]);
  return children;
}
