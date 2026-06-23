import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil, Trash2 } from "lucide-react"

import { DeleteFeatureRequestDialog } from "@/components/feature-requests/DeleteFeatureRequestDialog"
import { FeatureRequestFormDialog } from "@/components/feature-requests/FeatureRequestFormDialog"
import { StatusBadge, statusDisplayLabels } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { VoteControl } from "@/components/ui/vote-control"
import { useAuth } from "@/context/AuthContext"
import { useToast } from "@/context/ToastContext"
import { ApiError, unvoteFeatureRequest, updateFeatureRequestStatus, voteFeatureRequest } from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"

interface FeatureRequestCardProps {
  featureRequest: FeatureRequest
  projectOwnerId: string
}

export function FeatureRequestCard({ featureRequest, projectOwnerId }: FeatureRequestCardProps) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()

  const isAuthor = user?.id === featureRequest.createdBy
  const isProjectOwner = user?.id === projectOwnerId
  const canEdit = isAuthor && featureRequest.upvoteCount === 0
  const canDelete = isAuthor || isProjectOwner
  const voteState: "votable" | "voted" | "own" = isAuthor
    ? "own"
    : featureRequest.viewerHasVoted
      ? "voted"
      : "votable"
  const createdAt = new Date(featureRequest.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

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
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] })
      showToast({
        title: "Status updated",
        description: `"${featureRequest.title}" → ${statusDisplayLabels[status] ?? status}`,
      })
    },
    onError: (err) =>
      showToast({
        variant: "error",
        title: "Couldn't update status",
        description: err instanceof ApiError ? err.message : "something went wrong",
      }),
  })

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-4">
        <VoteControl
          count={featureRequest.upvoteCount}
          state={voteState}
          disabled={voteMutation.isPending}
          onClick={voteState === "own" ? undefined : () => voteMutation.mutate()}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-lg font-semibold">{featureRequest.title}</h3>
            {isProjectOwner ? (
              <StatusBadge
                status={featureRequest.status}
                editable
                onStatusChange={(status) => statusMutation.mutate(status)}
                disabled={statusMutation.isPending}
              />
            ) : (
              <StatusBadge status={featureRequest.status} />
            )}
          </div>
          {featureRequest.description && (
            <p className="mt-1 text-sm text-muted-foreground">{featureRequest.description}</p>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="font-mono text-xs text-muted-foreground">
              {isAuthor ? "You" : featureRequest.createdByName} &middot; {createdAt}
              {isAuthor ? ` · ${featureRequest.upvoteCount} upvotes` : ""}
            </p>
            {(canEdit || canDelete) && (
              <div className="flex gap-1">
                {canEdit && (
                  <FeatureRequestFormDialog
                    projectId={featureRequest.projectId}
                    featureRequest={featureRequest}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit feature request"
                        className="h-8 w-8 rounded-md border border-border bg-card text-primary hover:bg-primary/10 hover:text-primary dark:border-primary [&_svg]:size-3"
                      >
                        <Pencil />
                      </Button>
                    }
                  />
                )}
                {canDelete && (
                  <DeleteFeatureRequestDialog
                    featureRequest={featureRequest}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete feature request"
                        className="h-8 w-8 rounded-md border border-destructive bg-card text-destructive hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3"
                      >
                        <Trash2 />
                      </Button>
                    }
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
