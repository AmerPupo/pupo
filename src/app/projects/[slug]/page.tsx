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
  const project = (await getPublishedProjects()).find((p) => p.slug === slug);
  if (!project) notFound();
  return project;
}

export async function generateMetadata({ params }: PageProps<"/projects/[slug]">): Promise<Metadata> {
  const project = await findProject((await params).slug);
  return { title: project.name, description: project.tagline };
}

export default async function ProjectPage({ params }: PageProps<"/projects/[slug]">) {
  const project = await findProject((await params).slug);
  const paragraphs = project.description
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <main className="mx-auto w-full max-w-page px-6 py-section">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted transition-colors duration-200 ease-out-soft hover:text-foreground"
      >
        <span aria-hidden="true">←</span> Home
      </Link>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight wrap-anywhere sm:text-5xl">
        {project.name}
      </h1>
      <p className="mt-4 max-w-prose text-lg text-muted wrap-anywhere">{project.tagline}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <a href={project.repoUrl} className={PRIMARY} target="_blank">
          View on GitHub
        </a>
        {project.demoUrl && (
          <a href={project.demoUrl} className={SECONDARY} target="_blank">
            Live demo
          </a>
        )}
      </div>
      <div className="mt-8">
        <TechTags tech={project.tech} />
      </div>
      <div className="mt-10 max-w-prose space-y-5 text-lg leading-relaxed wrap-anywhere">
        {paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </main>
  );
}
