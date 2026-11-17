"use client";

import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { SECONDARY } from "@/components/buttonStyles";
import { scrollPosition, type ScrollPosition } from "@/lib/scrollPosition";

const ARROW = `${SECONDARY} min-w-11 justify-center disabled:pointer-events-none disabled:opacity-40`;

// Swipe, arrow keys and Tab are the browser's own: the track is a scroll-snap list, focusable so the arrow keys work on it.
// Only the prev/next buttons need script, and without it they stay hidden and the track still scrolls.
// The scrollbar is hidden: the buttons are the mouse's way along, and an overlay bar sat on the cards' bottom edge on phones.
export function ProjectCarousel({ children }: { children: ReactNode }) {
  const track = useRef<HTMLUListElement>(null);
  // Unknown until the browser has laid the track out, so the server HTML and the first client render match.
  const [position, setPosition] = useState<ScrollPosition | null>(null);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () => setPosition(scrollPosition(el));
    // A ResizeObserver also reports once when it starts observing, which sets the first position.
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  // One card plus the gap: the track snaps, so this lands on the next card. It is smooth only when the CSS allows it.
  function step(direction: 1 | -1) {
    const el = track.current;
    const card = el?.firstElementChild;
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    el.scrollBy({ left: direction * (card.getBoundingClientRect().width + gap) });
  }

  // Tabbing to the next card that peeks in doesn't scroll it into view in Chrome, which leaves a keyboard user on a card that is mostly cut off.
  function revealFocused(event: FocusEvent<HTMLUListElement>) {
    if (!event.target.matches(":focus-visible")) return; // a tap or click is about to navigate, so don't scroll for it
    event.target.closest("li")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  const canPrev = position === "middle" || position === "end";
  const canNext = position === "start" || position === "middle";
  const overflows = position !== null && position !== "fits";

  return (
    <section aria-labelledby="projects-title" className="mt-section">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 id="projects-title" className="text-2xl font-semibold tracking-tight">
          Projects
        </h2>
        {/* Hidden, not removed, when nothing scrolls, so the heading row keeps its height. */}
        <div className={`flex gap-2 ${overflows ? "" : "invisible"}`}>
          <button type="button" aria-label="Previous project" disabled={!canPrev} onClick={() => step(-1)} className={ARROW}>
            <span aria-hidden="true">←</span>
          </button>
          <button type="button" aria-label="Next project" disabled={!canNext} onClick={() => step(1)} className={ARROW}>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      <ul
        ref={track}
        tabIndex={0}
        aria-labelledby="projects-title"
        onFocus={revealFocused}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain [scrollbar-width:none] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
    </section>
  );
}
