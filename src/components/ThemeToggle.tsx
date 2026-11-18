"use client";

// The script in layout.tsx sets data-theme on <html> before first paint, from localStorage "theme" or else the system theme.
// Choosing the theme the system already has clears the stored choice, so the page follows the system again.
function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  const system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  try {
    if (next === system) localStorage.removeItem("theme");
    else localStorage.setItem("theme", next);
  } catch {
    // Storage blocked (private mode, disabled cookies): the switch still works for this page.
  }
  const apply = () => {
    root.dataset.theme = next;
  };
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) apply();
  else document.startViewTransition(apply); // a crossfade between the two themes
}

// The label can't name the target theme: the server doesn't know the visitor's theme, so the HTML would not match.
export function ThemeToggle() {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle dark theme"
      title="Toggle dark theme"
      className="-mr-2.5 inline-flex size-11 items-center justify-center rounded-full text-muted transition-colors duration-300 ease-out-soft hover:bg-card hover:text-foreground"
    >
      {/* Moon in light mode, sun in dark mode. */}
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] dark:hidden" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="hidden size-[18px] dark:block" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  );
}
