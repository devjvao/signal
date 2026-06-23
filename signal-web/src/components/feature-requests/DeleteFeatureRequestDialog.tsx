import { useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useToast } from "@/context/ToastContext"
import { ApiError, deleteFeatureRequest } from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"

interface DeleteFeatureRequestDialogProps {
  featureRequest: FeatureRequest
  trigger: ReactNode
}

export function DeleteFeatureRequestDialog({ featureRequest, trigger }: DeleteFeatureRequestDialogProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  function handleOpenChange(next: boolean) {
    if (next) setError(null)
    setOpen(next)
  }

  async function handleConfirm() {
    setError(null)
    setIsDeleting(true)
    try {
      await deleteFeatureRequest(featureRequest.id)
      await queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] })
      showToast({ variant: "success", title: "Request deleted", description: featureRequest.title })
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle>Delete feature request</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete &quot;{featureRequest.title}&quot;? This action cannot be undone.
        </DialogDescription>
        {error && <Alert className="mt-3">{error}</Alert>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
