import type { Metadata } from "next";
import Link from "next/link";
import { PRIMARY } from "@/components/buttonStyles";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-page px-6 py-section motion-safe:animate-rise">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="mt-3 text-5xl font-semibold tracking-tighter sm:text-7xl">
        Page not found<span className="text-accent">.</span>
      </h1>
      <p className="mt-6 max-w-prose text-lg text-muted">Nothing lives at this address.</p>
      <div className="mt-10">
        <Link href="/" className={PRIMARY}>
          <span aria-hidden="true">←</span> Back to home
        </Link>
      </div>
    </main>
  );
}
