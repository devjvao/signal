import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"

import { FeatureRequestList } from "@/components/feature-requests/FeatureRequestList"
import { Button } from "@/components/ui/button"
import { getProject } from "@/lib/api"

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading, isError } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id as string),
    enabled: Boolean(id),
  })

  if (isLoading) {
    return <p className="px-6 py-8 text-sm text-muted-foreground">Loading project...</p>
  }

  if (isError || !data) {
    return <p className="px-6 py-8 text-sm text-destructive">Project not found.</p>
  }

  const project = data.project

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
        <div>
          <Button variant="link" className="h-auto px-0" onClick={() => navigate("/")}>
            ← Back to projects
          </Button>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex justify-end">
          <Button onClick={() => navigate(`/projects/${project.id}/feature-requests/new`)}>
            New feature request
          </Button>
        </div>
        <FeatureRequestList projectId={project.id} projectOwnerId={project.ownerId} />
      </main>
    </div>
  )
}
