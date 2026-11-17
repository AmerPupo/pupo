import { describe, expect, it } from "vitest";
import { scrollPosition } from "./scrollPosition";

// A 300px-wide track holding 900px of cards, scrolled to `scrollLeft` (so it can scroll 600px in all).
const track = (scrollLeft: number) => ({ scrollLeft, clientWidth: 300, scrollWidth: 900 });

describe("scrollPosition", () => {
  it("is start at the left edge", () => {
    expect(scrollPosition(track(0))).toBe("start");
  });

  it("is middle between the edges", () => {
    expect(scrollPosition(track(250))).toBe("middle");
  });

  it("is end at the right edge", () => {
    expect(scrollPosition(track(600))).toBe("end");
  });

  it("counts a fraction of a pixel short of the right edge as the end, as high-DPI screens report it", () => {
    expect(scrollPosition(track(599.4))).toBe("end");
  });

  it("counts a fraction of a pixel past the left edge as the start", () => {
    expect(scrollPosition(track(0.4))).toBe("start");
  });

  // The slack is exactly 1px: these sit on its edge, and the next two just outside it.
  it("is start at exactly 1px from the left edge", () => {
    expect(scrollPosition(track(1))).toBe("start");
  });

  it("is end at exactly 1px from the right edge", () => {
    expect(scrollPosition(track(599))).toBe("end");
  });

  it("is middle just outside the 1px slack on either side", () => {
    expect(scrollPosition(track(1.5))).toBe("middle");
    expect(scrollPosition(track(598.5))).toBe("middle");
  });

  it("is fits when every card is already visible", () => {
    expect(scrollPosition({ scrollLeft: 0, clientWidth: 900, scrollWidth: 900 })).toBe("fits");
  });

  it("is fits when the overflow is one pixel of rounding", () => {
    expect(scrollPosition({ scrollLeft: 0, clientWidth: 900, scrollWidth: 901 })).toBe("fits");
  });

  it("is not fits when the overflow is 2px, so the arrows show", () => {
    expect(scrollPosition({ scrollLeft: 0, clientWidth: 900, scrollWidth: 902 })).toBe("start");
  });
});
