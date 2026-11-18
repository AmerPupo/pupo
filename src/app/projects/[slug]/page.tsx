import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PRIMARY, SECONDARY } from "@/components/buttonStyles";
import { TechTags } from "@/components/TechTags";
import { getPublishedProjects } from "@/lib/projects";

// Static export: only the slugs returned below get a page, and every other slug is a 404.
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getPublishedProjects()).map((project) => ({ slug: project.slug }));
}

async function findProject(slug: string) {
  const projects = await getPublishedProjects();
  const index = projects.findIndex((p) => p.slug === slug);
  if (index === -1) notFound();
  return { projects, index, project: projects[index] };
}

export async function generateMetadata({ params }: PageProps<"/projects/[slug]">): Promise<Metadata> {
  const { project } = await findProject((await params).slug);
  return { title: project.name, description: project.tagline };
}

export default async function ProjectPage({ params }: PageProps<"/projects/[slug]">) {
  const { projects, index, project } = await findProject((await params).slug);
  const next = projects.length > 1 ? projects[(index + 1) % projects.length] : undefined;
  const paragraphs = project.description
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <main className="mx-auto w-full max-w-page px-6">
      <article className="pt-10 sm:pt-14">
        <Link href="/#work" className="link-draw inline-block py-3 text-sm text-muted hover:text-foreground">
          <span aria-hidden="true">←</span> All work
        </Link>
        <header className="mt-10 motion-safe:animate-rise">
          <p className="font-mono text-sm text-accent">
            {String(index + 1).padStart(2, "0")} / {String(projects.length).padStart(2, "0")}
          </p>
          <h1 className="mt-3 text-5xl font-semibold tracking-tighter wrap-anywhere sm:text-7xl">{project.name}</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted text-pretty wrap-anywhere sm:text-xl sm:leading-relaxed">
            {project.tagline}
          </p>
        </header>

        <div
          className="mt-14 grid gap-12 border-t border-border pt-10 pb-section motion-safe:animate-rise md:grid-cols-12"
          style={{ animationDelay: "150ms" }}
        >
          <aside className="space-y-8 md:sticky md:top-24 md:col-span-4 md:self-start">
            <div>
              <h2 className="eyebrow">Stack</h2>
              <div className="mt-3">
                <TechTags tech={project.tech} />
              </div>
            </div>
            <div>
              <h2 className="eyebrow">Links</h2>
              <div className="mt-3 flex flex-wrap gap-3">
                <a href={project.repoUrl} className={PRIMARY} target="_blank">
                  View on GitHub <span aria-hidden="true">↗</span>
                </a>
                {project.demoUrl && (
                  <a href={project.demoUrl} className={SECONDARY} target="_blank">
                    Live demo <span aria-hidden="true">↗</span>
                  </a>
                )}
              </div>
            </div>
          </aside>
          <div className="max-w-prose space-y-6 leading-relaxed wrap-anywhere md:col-span-8 md:col-start-5 md:text-lg md:leading-relaxed">
            {paragraphs.map((paragraph, i) => (
              <p key={i} className={i === 0 ? "text-lg md:text-xl" : "text-muted"}>
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </article>

      {next && (
        <nav aria-label="Next project" className="reveal-on-scroll border-t border-border">
          <Link href={`/projects/${next.slug}`} className="group block py-16">
            <span className="eyebrow">Next project</span>
            <span className="mt-2 flex items-center justify-between gap-6 text-3xl font-semibold tracking-tight transition-colors duration-300 ease-out-soft group-hover:text-accent sm:text-5xl">
              <span className="wrap-anywhere">{next.name}</span>
              <span
                aria-hidden="true"
                className="transition-transform duration-500 ease-out-soft group-hover:translate-x-2"
              >
                →
              </span>
            </span>
          </Link>
        </nav>
      )}
    </main>
  );
}
