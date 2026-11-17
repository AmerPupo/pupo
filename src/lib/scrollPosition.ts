export type ScrollPosition = "fits" | "start" | "middle" | "end";

// 1px of slack on each edge: high-DPI screens report a fractional scrollLeft, which would otherwise leave "next" enabled at the very end.
export function scrollPosition(el: { scrollLeft: number; clientWidth: number; scrollWidth: number }): ScrollPosition {
  const maxScroll = el.scrollWidth - el.clientWidth;
  if (maxScroll <= 1) return "fits";
  if (el.scrollLeft <= 1) return "start";
  if (el.scrollLeft >= maxScroll - 1) return "end";
  return "middle";
}
