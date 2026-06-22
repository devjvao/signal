import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { listMyProjects, listProjects } from "@/lib/api"
import { ProjectCard } from "@/components/projects/ProjectCard"

interface ProjectListProps {
  scope: "all" | "mine"
}

export function ProjectList({ scope }: ProjectListProps) {
  const fetchPage = scope === "mine" ? listMyProjects : listProjects

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["projects", scope],
    queryFn: ({ pageParam }) => fetchPage({ cursor: pageParam }),
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
    return <p className="text-sm text-muted-foreground">No projects yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {projects.map((proj) => (
        <ProjectCard key={proj.id} project={proj} />
      ))}
      <div ref={sentinelRef} />
      {isFetchingNextPage && <p className="text-sm text-muted-foreground">Loading more...</p>}
    </div>
  )
}