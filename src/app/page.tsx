import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { PRIMARY, SECONDARY } from "@/components/buttonStyles";
import { shownOnHome } from "@/lib/admin/order";
import { getPublishedProjects } from "@/lib/projects";
import { SITE } from "@/site.config";

const ROW_TECH = 3; // the project page lists every technology

// Staggers the hero's entrance; motion-safe: means that under prefers-reduced-motion everything shows at once.
const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

export default async function Home() {
  const projects = shownOnHome(await getPublishedProjects());
  const words = SITE.name.split(" ");

  return (
    <main className="mx-auto w-full max-w-page px-6">
      <section className="pt-20 pb-section sm:pt-32">
        <p className="flex items-center gap-3 text-sm font-medium text-accent motion-safe:animate-rise">
          <span aria-hidden="true" className="h-px w-8 bg-accent" />
          {SITE.role}
        </p>
        {/* Each word slides up out of its own clipping box. The padding and negative margin leave room for the j's descender. */}
        <h1 className="mt-6 text-display font-semibold tracking-tighter">
          {words.map((word, i) => (
            <span key={i}>
              {i > 0 && " "}
              <span className="-mb-[0.15em] inline-block overflow-hidden pb-[0.15em] align-bottom">
                <span className="inline-block motion-safe:animate-reveal" style={delay(100 + i * 120)}>
                  {word}
                  {i === words.length - 1 && <span className="text-accent">.</span>}
                </span>
              </span>
            </span>
          ))}
        </h1>
        <p
          className="mt-8 max-w-2xl text-lg leading-relaxed text-muted text-pretty motion-safe:animate-rise sm:text-xl sm:leading-relaxed"
          style={delay(450)}
        >
          {SITE.bio}
        </p>
        <div className="mt-10 flex flex-wrap gap-3 motion-safe:animate-rise" style={delay(550)}>
          <a href={SITE.cv} download={SITE.cvFileName} className={PRIMARY}>
            Download CV <span aria-hidden="true">↓</span>
          </a>
          <a href={`mailto:${SITE.email}`} className={SECONDARY}>
            Email me
          </a>
        </div>
      </section>

      {projects.length > 0 && (
        <section id="work" aria-labelledby="work-title" className="scroll-mt-20 pb-section">
          <div className="flex items-baseline justify-between gap-4 pb-6">
            <h2 id="work-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Selected work
            </h2>
            <p className="eyebrow">{projects.length} projects</p>
          </div>
          <ol className="-mx-4 border-b border-border">
            {projects.map((project, i) => (
              <li key={project.slug} className="reveal-on-scroll">
                {/* Named by its title and described by its tagline, so a screen reader doesn't read the number and tags as link text.
                    isolate keeps the -z-10 fill above the page background. */}
                <Link
                  href={`/projects/${project.slug}`}
                  aria-labelledby={`project-${project.slug}-title`}
                  aria-describedby={`project-${project.slug}-summary`}
                  className="group relative isolate grid gap-x-8 gap-y-2 border-t border-border px-4 py-8 transition-colors duration-500 ease-out-soft hover:text-white focus-visible:text-white md:grid-cols-[2.5rem_minmax(0,4fr)_minmax(0,6fr)_1.5rem] md:items-baseline"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 origin-left scale-x-0 bg-accent-fill transition-transform duration-500 ease-out-soft group-hover:scale-x-100 group-focus-visible:scale-x-100"
                  />
                  <span
                    aria-hidden="true"
                    className="font-mono text-sm text-muted transition-colors duration-500 group-hover:text-accent-soft group-focus-visible:text-accent-soft"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3
                    id={`project-${project.slug}-title`}
                    className="text-2xl font-semibold tracking-tight wrap-anywhere sm:text-3xl"
                  >
                    {project.name}
                  </h3>
                  <div>
                    <p
                      id={`project-${project.slug}-summary`}
                      className="text-muted wrap-anywhere transition-colors duration-500 group-hover:text-accent-soft group-focus-visible:text-accent-soft"
                    >
                      {project.tagline}
                    </p>
                    <p
                      aria-hidden="true"
                      className="mt-2 font-mono text-xs text-muted transition-colors duration-500 group-hover:text-accent-soft group-focus-visible:text-accent-soft"
                    >
                      {project.tech.slice(0, ROW_TECH).join(" · ")}
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="hidden text-xl transition-transform duration-500 ease-out-soft group-hover:translate-x-1 md:block"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <figure className="reveal-on-scroll relative mx-auto mt-20 w-72 pt-6 sm:w-96">
            {/* unoptimized: the static export has no image server. */}
            <Image src="/canvas.webp" alt="A cat in a shirt and tie typing on a laptop" width={574} height={603} unoptimized />
            {/* Sits in the transparent space above the laptop, its tail pointing at the cat's head. */}
            <a
              href={SITE.github}
              target="_blank"
              className="pop-on-scroll absolute top-0 left-[40%] w-[60%] rounded-2xl bg-accent-fill px-4 py-3 text-sm leading-snug font-medium text-white shadow-lg shadow-black/10 transition-[translate,background-color] duration-300 ease-out-soft hover:-translate-y-1 hover:bg-accent-fill-hover sm:text-base sm:leading-snug"
            >
              For more of my work, check out my <span className="whitespace-nowrap">GitHub <span aria-hidden="true">↗</span></span>
              <span
                aria-hidden="true"
                className="absolute -bottom-1.5 left-5 size-3.5 rotate-45 rounded-br-sm bg-inherit"
              />
            </a>
          </figure>
        </section>
      )}
    </main>
  );
}
