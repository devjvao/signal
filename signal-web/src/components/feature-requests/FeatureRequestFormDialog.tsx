import { useMutation, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useState } from "react"
import type { FormEvent, ReactNode } from "react"

import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/ui/status-badge"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { ApiError, createFeatureRequest, updateFeatureRequest } from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"
import { useToast } from "@/context/ToastContext"

interface FeatureRequestFormDialogProps {
  trigger: ReactNode
  projectId: string
  /** When provided, the dialog is in edit mode and pre-fills from this request. */
  featureRequest?: FeatureRequest
}

export function FeatureRequestFormDialog({ trigger, projectId, featureRequest }: FeatureRequestFormDialogProps) {
  const isEdit = Boolean(featureRequest)
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(featureRequest?.title ?? "")
  const [description, setDescription] = useState(featureRequest?.description ?? "")
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    if (next) {
      setTitle(featureRequest?.title ?? "")
      setDescription(featureRequest?.description ?? "")
      setError(null)
    }
    setOpen(next)
  }

  const mutation = useMutation({
    mutationFn: () => {
      const input = { title, description: description || undefined }
      return isEdit ? updateFeatureRequest(featureRequest!.id, input) : createFeatureRequest(projectId, input)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["featureRequests", projectId] })
      showToast({
        variant: "success",
        title: isEdit ? "Request updated" : "Request created",
        description: title,
      })
      setOpen(false)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "something went wrong"),
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent aria-describedby={undefined} className="max-w-lg rounded-2xl bg-card p-7">
        <DialogClose
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </DialogClose>
        <div className="flex flex-col gap-1">
          <span className={cn("font-mono text-xs uppercase tracking-widest", isEdit ? "text-accent" : "text-primary")}>
            {isEdit ? "Editing your request" : "New request"}
          </span>
          <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">
            {isEdit ? "Edit feature request" : "Suggest a feature"}
          </DialogTitle>
        </div>
        <form className="mt-5 flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fr-title">Title</Label>
            <Input
              id="fr-title"
              required
              placeholder="Short, specific summary"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fr-description">Description</Label>
            <Textarea
              id="fr-description"
              className="min-h-[120px]"
              placeholder="What problem does this solve? Who's it for?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {error && <Alert>{error}</Alert>}
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {isEdit ? (
              <>
                Current status <StatusBadge status={featureRequest!.status} /> (set by owner)
              </>
            ) : (
              <>
                New requests start as <StatusBadge status="open" /> — only the project owner can change status.
              </>
            )}
          </p>
          <div className="flex gap-3 pt-1">
            <Button type="submit" className="flex-1" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : isEdit ? "Save changes" : "Save request"}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
