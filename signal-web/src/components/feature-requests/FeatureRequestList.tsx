import { useInfiniteQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useEffect, useRef } from "react"

import { listFeatureRequests } from "@/lib/api"
import { FeatureRequestCard } from "@/components/feature-requests/FeatureRequestCard"
import { FeatureRequestFormDialog } from "@/components/feature-requests/FeatureRequestFormDialog"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

interface FeatureRequestListProps {
  projectId: string
  projectOwnerId: string
  status?: string | null
  sort?: "votes" | "newest"
}

export function FeatureRequestList({ projectId, projectOwnerId, status = null, sort = "votes" }: FeatureRequestListProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["featureRequests", projectId, status, sort],
    queryFn: ({ pageParam }) =>
      listFeatureRequests(projectId, { cursor: pageParam, status: status ?? undefined, sort }),
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
    return <p className="text-sm text-muted-foreground">Loading feature requests...</p>
  }

  const featureRequests = data?.pages.flatMap((page) => page.featureRequests) ?? []

  if (featureRequests.length === 0) {
    if (status) {
      return <p className="text-sm text-muted-foreground">No requests match this filter.</p>
    }
    return (
      <EmptyState
        title="No feature requests yet"
        description="Be the first to suggest an idea — the community votes the best ones up."
        action={
          <FeatureRequestFormDialog
            projectId={projectId}
            trigger={
              <Button className="gap-1.5">
                <Plus className="h-4 w-4" /> New feature request
              </Button>
            }
          />
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {featureRequests.map((fr) => (
        <FeatureRequestCard key={fr.id} featureRequest={fr} projectOwnerId={projectOwnerId} />
      ))}
      <div ref={sentinelRef} />
      {isFetchingNextPage && <p className="text-sm text-muted-foreground">Loading more...</p>}
    </div>
  )
}
