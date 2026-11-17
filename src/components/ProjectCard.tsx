import Link from "next/link";
import { TechTags } from "@/components/TechTags";
import type { Project } from "@/lib/projects";

const CARD_TAGS = 4; // keeps the cards about the same height; the detail page lists every tag

// The whole card is one link, named by its title and described by its tagline, so a screen reader doesn't read the tags as link text.
// The focus ring is drawn inside the card (negative offset) because the scrolling track would clip an outer one.
export function ProjectCard({ project }: { project: Project }) {
  const title = `project-${project.slug}-title`;
  const summary = `project-${project.slug}-summary`;

  return (
    <li className="flex shrink-0 basis-[85%] snap-start md:basis-[calc(50%_-_0.5rem)] lg:basis-[calc((100%_-_2rem)/3)]">
      <Link
        href={`/projects/${project.slug}`}
        aria-labelledby={title}
        aria-describedby={summary}
        className="flex w-full flex-col rounded-lg border border-border bg-card p-6 transition-colors duration-200 ease-out-soft hover:border-muted focus-visible:-outline-offset-2"
      >
        <h3 id={title} className="text-xl font-semibold tracking-tight wrap-anywhere">
          {project.name}
        </h3>
        <p id={summary} className="mt-2 text-muted wrap-anywhere">
          {project.tagline}
        </p>
        <div className="mt-auto pt-6">
          <TechTags tech={project.tech.slice(0, CARD_TAGS)} />
        </div>
      </Link>
    </li>
  );
}
