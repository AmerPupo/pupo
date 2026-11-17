import { Typewriter } from "@/components/Typewriter";
import { SITE } from "@/site.config";

const BUTTON =
  "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium transition-colors duration-200 ease-out-soft";
const PRIMARY = `${BUTTON} bg-foreground text-background hover:bg-foreground/85`;
const SECONDARY = `${BUTTON} border border-border hover:border-muted hover:bg-card`;

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-page px-6 py-section">
      <h1 className="text-display font-semibold">
        <Typewriter text={SITE.name} />
      </h1>
      <p className="mt-4 font-mono text-lg text-accent">{SITE.role}</p>
      <p className="mt-6 max-w-prose text-lg leading-relaxed text-muted">{SITE.bio}</p>
      <div className="mt-10 flex flex-wrap gap-3">
        <a href={SITE.cv} download className={PRIMARY}>
          Download CV
        </a>
        <a href={`mailto:${SITE.email}`} className={SECONDARY}>
          {SITE.email}
        </a>
        <a href={SITE.github} className={SECONDARY} target="_blank">
          GitHub
        </a>
        <a href={SITE.linkedin} className={SECONDARY} target="_blank">
          LinkedIn
        </a>
      </div>
    </main>
  );
}
