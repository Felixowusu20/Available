"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const current = root.dataset.theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const root = document.documentElement;
    const current = root.dataset.theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode: the choice just won't persist */
    }
  }

  return (
    <button type="button" onClick={toggle} className="btn btn-ghost !min-h-11 !px-3 !py-1 text-sm" aria-label="Switch between light and dark theme">
      <Icon name={theme === "light" ? "moon" : "sun"} className="size-4" />
      <span className="sr-only">Theme</span>
    </button>
  );
}
