import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SITE } from "@/site.config";
import "./globals.css";

// latin-ext carries š, ć, Đ and đ, which the name and the bio use.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: SITE.name,
  description: SITE.bio,
};

// Runs before first paint, so a stored theme never flashes the other one. ThemeToggle writes the same "theme" key.
const THEME_SCRIPT = `(function(){var m=matchMedia("(prefers-color-scheme: dark)");function a(){var t;try{t=localStorage.getItem("theme")}catch(e){}document.documentElement.dataset.theme=t==="light"||t==="dark"?t:m.matches?"dark":"light"}a();m.addEventListener("change",a)})()`;

const NAV_LINK = "link-draw inline-block py-3 text-sm text-muted hover:text-foreground";
const FOOTER_LINK = "link-draw inline-flex items-center py-2 gap-1.5 hover:text-accent";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: THEME_SCRIPT sets data-theme on <html> before React hydrates.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex min-h-14 w-full max-w-page items-center justify-between gap-4 px-6">
            <Link href="/" className="text-sm font-semibold tracking-tight whitespace-nowrap sm:text-base">
              {SITE.name}
              <span className="text-accent">.</span>
            </Link>
            <div className="flex items-center gap-4 sm:gap-8">
              <nav aria-label="Main" className="flex gap-4 sm:gap-8">
                <Link href="/#work" className={NAV_LINK}>
                  Work
                </Link>
                <a href="#contact" className={NAV_LINK}>
                  Contact
                </a>
                {/* Hidden on phones to leave room for the theme button; the hero and the footer both offer the CV. */}
                <a href={SITE.cv} download={SITE.cvFileName} className={`${NAV_LINK} max-sm:hidden`}>
                  CV
                </a>
              </nav>
              <ThemeToggle />
            </div>
          </div>
          {/* Fills as the page scrolls; see .scroll-progress in globals.css. */}
          <div aria-hidden="true" className="scroll-progress absolute inset-x-0 -bottom-px h-0.5 bg-accent" />
        </header>

        {children}

        <footer id="contact" className="mt-auto border-t border-border bg-card">
          <div className="reveal-on-scroll mx-auto grid w-full max-w-page gap-10 px-6 py-20 md:grid-cols-2 md:items-end">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Get in touch</h2>
              <a
                href={`mailto:${SITE.email}`}
                className="link-draw mt-4 inline-block text-lg text-accent wrap-anywhere sm:text-xl"
              >
                {SITE.email}
              </a>
            </div>
            <ul className="flex flex-wrap gap-x-8 gap-y-3 md:justify-end">
              <li>
                <a href={SITE.github} className={FOOTER_LINK} target="_blank">
                  GitHub <span aria-hidden="true">↗</span>
                </a>
              </li>
              <li>
                <a href={SITE.linkedin} className={FOOTER_LINK} target="_blank">
                  LinkedIn <span aria-hidden="true">↗</span>
                </a>
              </li>
              <li>
                <a href={SITE.cv} download={SITE.cvFileName} className={FOOTER_LINK}>
                  Download CV <span aria-hidden="true">↓</span>
                </a>
              </li>
            </ul>
          </div>
          <div className="border-t border-border">
            <div className="mx-auto flex w-full max-w-page flex-wrap items-center justify-between gap-4 px-6 py-5 text-sm text-muted">
              <p>
                © {new Date().getFullYear()} {SITE.name}
              </p>
              {/* #top needs no target: the HTML spec scrolls to the top of the page for it. */}
              <a href="#top" className={NAV_LINK}>
                Back to top <span aria-hidden="true">↑</span>
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
