import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { listMyProjects, listProjects } from "@/lib/api"
import { ProjectCard } from "@/components/projects/ProjectCard"
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

interface ProjectListProps {
  scope: "all" | "mine"
  search?: string
  sort?: "newest" | "active"
}

export function ProjectList({ scope, search = "", sort = "newest" }: ProjectListProps) {
  const fetchPage = scope === "mine" ? listMyProjects : listProjects

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["projects", scope, sort, search],
    queryFn: ({ pageParam }) => fetchPage({ cursor: pageParam, search, sort }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading projects...</p>
  }

  const projects = data?.pages.flatMap((page) => page.projects) ?? []

  if (projects.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        description={
          scope === "mine"
            ? "Start a project and let the community vote on what you build next."
            : "No projects match your search yet. Be the first to start one."
        }
        action={
          <ProjectFormDialog trigger={<Button>+ Create your first project</Button>} />
        }
      />
    )
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((proj) => (
          <ProjectCard key={proj.id} project={proj} />
        ))}
      </div>
      <div ref={sentinelRef} />
      {isFetchingNextPage && <p className="mt-4 text-sm text-muted-foreground">Loading more...</p>}
    </div>
  )
}