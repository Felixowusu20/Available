"use client";

export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const current = root.dataset.theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode: the choice just won't persist */
    }
  }
  return (
    <button type="button" onClick={toggle} className="btn btn-ghost !min-h-9 !px-3 !py-1 text-sm" aria-label="Switch between light and dark theme">
      Theme
    </button>
  );
}
