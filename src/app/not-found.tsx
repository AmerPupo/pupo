import type { Metadata } from "next";
import Link from "next/link";
import { PRIMARY } from "@/components/buttonStyles";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-page px-6 py-section">
      <p className="font-mono text-lg text-accent">404</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Page not found</h1>
      <p className="mt-4 max-w-prose text-lg text-muted">Nothing lives at this address.</p>
      <div className="mt-10">
        <Link href="/" className={PRIMARY}>
          Back to home
        </Link>
      </div>
    </main>
  );
}
