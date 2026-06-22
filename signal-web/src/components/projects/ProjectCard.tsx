import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog"
import { useAuth } from "@/context/AuthContext"
import type { Project } from "@/lib/api"

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const createdAt = new Date(project.createdAt).toLocaleDateString()
  const isOwner = user?.id === project.ownerId

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/projects/${project.id}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          navigate(`/projects/${project.id}`)
        }
      }}
      className="cursor-pointer rounded-md border border-border bg-background p-4 text-left"
    >
      <h3 className="font-display text-lg font-semibold">{project.name}</h3>
      {project.description && (
        <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {project.ownerName} &middot; {createdAt}
      </p>
      {isOwner && (
        <div className="mt-3 flex gap-2" onClick={(event) => event.stopPropagation()}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/projects/${project.id}/edit`, { state: { project } })}
          >
            Edit
          </Button>
          <DeleteProjectDialog
            project={project}
            trigger={
              <Button variant="destructive" size="sm">
                Delete
              </Button>
            }
          />
        </div>
      )}
    </div>
  )
}