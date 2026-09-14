"use client";

import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/useUIStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      const stored = localStorage.getItem("loft.theme");
      if (
        (stored === "system" || stored === "light" || stored === "dark") &&
        stored !== theme
      ) {
        setTheme(stored);
        return;
      }
    }
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      root.classList.remove("dark", "light");
      root.classList.add(resolved);
      root.dataset.theme = theme;
      localStorage.setItem("loft.theme", theme);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [setTheme, theme]);
  return children;
}
