import type { Project } from "@/lib/api"

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  const createdAt = new Date(project.createdAt).toLocaleDateString()

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <h3 className="font-display text-lg font-semibold">{project.name}</h3>
      {project.description && (
        <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {project.ownerName} &middot; {createdAt}
      </p>
    </div>
  )
}
