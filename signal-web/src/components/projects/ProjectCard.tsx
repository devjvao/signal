import { Pencil, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog"
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import type { Project } from "@/lib/api"

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const createdAt = new Date(project.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const isOwner = user?.id === project.ownerId

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/projects/${project.id}`)}
      onKeyDown={(event) => {
        // Only treat Space/Enter as activation when the card itself is focused.
        // Events bubbling up from descendants — including the edit/delete dialogs,
        // which render in a portal but still propagate through the React tree —
        // must not trigger navigation.
        if (event.target !== event.currentTarget) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          navigate(`/projects/${project.id}`)
        }
      }}
      className={cn(
        "relative flex h-full cursor-pointer flex-col rounded-lg border border-border bg-card p-5 pl-6 text-left ring-offset-background transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:rounded-l-lg",
        isOwner
          ? "before:bg-gradient-to-b before:from-primary before:to-accent"
          : "before:bg-border"
      )}
    >
      {isOwner && (
        <div className="absolute right-3 top-3 flex gap-1" onClick={(event) => event.stopPropagation()}>
          <ProjectFormDialog
            project={project}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit project"
                className="h-8 w-8 rounded-md border border-border bg-card text-primary hover:bg-primary/10 hover:text-primary dark:border-primary [&_svg]:size-3"
              >
                <Pencil />
              </Button>
            }
          />
          <DeleteProjectDialog
            project={project}
            trigger={
              <Button variant="ghost" size="icon" aria-label="Delete project" className="h-8 w-8 rounded-md border border-destructive bg-card text-destructive hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3">
                <Trash2 />
              </Button>
            }
          />
        </div>
      )}
      <h3 className="pr-14 font-display text-lg font-semibold">{project.name}</h3>
      {project.description && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{project.description}</p>
      )}
      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-1 pt-4">
        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
          {isOwner ? "You" : project.ownerName} &middot; {createdAt}
        </span>
        <span className="whitespace-nowrap font-mono text-xs font-medium text-primary">
          ▲ {project.voteCount} &middot; {project.requestCount} requests
        </span>
      </div>
    </div>
  )
}
