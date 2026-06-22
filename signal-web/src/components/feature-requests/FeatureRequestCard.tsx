import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { DeleteFeatureRequestDialog } from "@/components/feature-requests/DeleteFeatureRequestDialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/context/AuthContext"
import { ApiError, unvoteFeatureRequest, updateFeatureRequestStatus, voteFeatureRequest } from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"

interface FeatureRequestCardProps {
  featureRequest: FeatureRequest
  projectOwnerId: string
}

const statusLabels: Record<string, string> = {
  open: "open",
  planned: "planned",
  in_progress: "in progress",
  completed: "completed",
  rejected: "rejected",
}

export function FeatureRequestCard({ featureRequest, projectOwnerId }: FeatureRequestCardProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const isAuthor = user?.id === featureRequest.createdBy
  const isProjectOwner = user?.id === projectOwnerId
  const canUpvote = !isAuthor
  const canEdit = isAuthor && featureRequest.upvoteCount === 0
  const canDelete = isAuthor || isProjectOwner

  const voteMutation = useMutation({
    mutationFn: () =>
      featureRequest.viewerHasVoted
        ? unvoteFeatureRequest(featureRequest.id)
        : voteFeatureRequest(featureRequest.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] }),
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateFeatureRequestStatus(featureRequest.id, status),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] }),
  })

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        {canUpvote && (
          <Button
            type="button"
            variant={featureRequest.viewerHasVoted ? "default" : "outline"}
            size="sm"
            aria-label={featureRequest.viewerHasVoted ? "Remove upvote" : "Upvote"}
            disabled={voteMutation.isPending}
            onClick={() => voteMutation.mutate()}
            className="flex h-auto flex-col px-3 py-1"
          >
            <span aria-hidden>▲</span>
            <span>{featureRequest.upvoteCount}</span>
          </Button>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold">{featureRequest.title}</h3>
            {isProjectOwner ? (
              <Select
                value={featureRequest.status}
                onValueChange={(status) => statusMutation.mutate(status)}
                disabled={statusMutation.isPending}
              >
                <SelectTrigger aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {statusLabels[featureRequest.status] ?? featureRequest.status}
              </span>
            )}
            {!canUpvote && (
              <span className="text-xs text-muted-foreground">{featureRequest.upvoteCount} upvotes</span>
            )}
          </div>
          {statusMutation.isError && (
            <p className="mt-1 text-xs text-destructive">
              {statusMutation.error instanceof ApiError ? statusMutation.error.message : "something went wrong"}
            </p>
          )}
          {featureRequest.description && (
            <p className="mt-1 text-sm text-muted-foreground">{featureRequest.description}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{featureRequest.createdByName}</p>
          {(canEdit || canDelete) && (
            <div className="mt-3 flex gap-2">
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate(`/feature-requests/${featureRequest.id}/edit`, { state: { featureRequest } })
                  }
                >
                  Edit
                </Button>
              )}
              {canDelete && (
                <DeleteFeatureRequestDialog
                  featureRequest={featureRequest}
                  trigger={
                    <Button variant="destructive" size="sm">
                      Delete
                    </Button>
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
