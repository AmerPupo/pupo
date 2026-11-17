export function TechTags({ tech }: { tech: string[] }) {
  return (
    <ul aria-label="Technologies" className="flex flex-wrap gap-2">
      {tech.map((tag, i) => (
        <li
          key={i}
          className="rounded-full border border-border bg-card px-3 py-1 font-mono text-sm text-muted wrap-anywhere"
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}
