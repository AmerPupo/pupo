import { PRIMARY, SECONDARY } from "@/components/buttonStyles";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectCarousel } from "@/components/ProjectCarousel";
import { Typewriter } from "@/components/Typewriter";
import { getPublishedProjects } from "@/lib/projects";
import { SITE } from "@/site.config";

export default async function Home() {
  const projects = await getPublishedProjects();

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
      {projects.length > 0 && (
        <ProjectCarousel>
          {projects.map((project) => (
            <ProjectCard key={project.slug} project={project} />
          ))}
        </ProjectCarousel>
      )}
    </main>
  );
}
