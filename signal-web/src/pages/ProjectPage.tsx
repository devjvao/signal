import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { AppHeader } from "@/components/layout/AppHeader"
import { FeatureRequestFormDialog } from "@/components/feature-requests/FeatureRequestFormDialog"
import { FeatureRequestList } from "@/components/feature-requests/FeatureRequestList"
import { Button } from "@/components/ui/button"
import { FilterChips } from "@/components/ui/filter-chips"
import { SortSelect } from "@/components/ui/sort-select"
import { statusDisplayOptions } from "@/components/ui/status-badge"
import { getProject } from "@/lib/api"

const featureRequestSortOptions = [
  { value: "votes", label: "Most votes" },
  { value: "newest", label: "Newest" },
]

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [status, setStatus] = useState<string | null>(null)
  const [sort, setSort] = useState("votes")

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
    <div className="flex min-h-screen flex-col bg-muted/50 dark:bg-background">
      <AppHeader />
      <header className="bg-gradient-to-br from-ink via-deep to-[#2563EB] text-white">
        <div className="relative mx-auto max-w-7xl overflow-hidden px-6 py-10">
          <svg
            aria-hidden
            viewBox="0 0 64 64"
            fill="none"
            stroke="currentColor"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute -right-6 -top-10 h-64 w-64 text-white/10"
          >
            <polyline points="14,50 32,38 50,50" />
            <polyline points="14,38 32,26 50,38" />
            <polyline points="14,26 32,14 50,26" />
          </svg>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="relative font-mono text-xs uppercase tracking-widest text-white/70 hover:text-white"
          >
            ← All projects
          </button>
          <div className="relative mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl font-extrabold tracking-tight">{project.name}</h1>
              {project.description && <p className="mt-1 text-sm text-white/80">{project.description}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/30 px-2.5 py-0.5 font-mono text-xs">
                  {project.requestCount} requests
                </span>
              </div>
            </div>
            <FeatureRequestFormDialog
              projectId={project.id}
              trigger={
                <Button className="gap-1.5">
                  <Plus className="h-4 w-4" /> New feature request
                </Button>
              }
            />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-8">
        {project.requestCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Filter</span>
              <FilterChips value={status} onChange={setStatus} options={statusDisplayOptions} />
            </div>
            <SortSelect value={sort} onChange={setSort} options={featureRequestSortOptions} label="Sort feature requests" />
          </div>
        )}
        <FeatureRequestList
          projectId={project.id}
          projectOwnerId={project.ownerId}
          status={status}
          sort={sort as "votes" | "newest"}
        />
      </main>
    </div>
  )
}
