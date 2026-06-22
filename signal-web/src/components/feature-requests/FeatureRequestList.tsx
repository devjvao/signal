import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { listFeatureRequests } from "@/lib/api"
import { FeatureRequestCard } from "@/components/feature-requests/FeatureRequestCard"

interface FeatureRequestListProps {
  projectId: string
  projectOwnerId: string
}

export function FeatureRequestList({ projectId, projectOwnerId }: FeatureRequestListProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["featureRequests", projectId],
    queryFn: ({ pageParam }) => listFeatureRequests(projectId, { cursor: pageParam }),
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
    return <p className="text-sm text-muted-foreground">No feature requests yet.</p>
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
