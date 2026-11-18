export function TechTags({ tech }: { tech: string[] }) {
  return (
    <ul aria-label="Technologies" className="flex flex-wrap gap-2">
      {tech.map((tag, i) => (
        <li key={i} className="rounded-full bg-card px-3 py-1 text-sm text-muted wrap-anywhere">
          {tag}
        </li>
      ))}
    </ul>
  );
}
