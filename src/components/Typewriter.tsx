import type { CSSProperties } from "react";

// The typing effect lives in CSS (.typewriter in globals.css), not in state: the whole name is in
// the server HTML, so it needs no JS and nothing flashes on hydration.
export function Typewriter({ text }: { text: string }) {
  return (
    <span className="typewriter" style={{ "--chars": text.length } as CSSProperties}>
      {text}
    </span>
  );
}
