import { useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"

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
import { ApiError, deleteProject } from "@/lib/api"
import type { Project } from "@/lib/api"

interface DeleteProjectDialogProps {
  project: Project
  trigger: ReactNode
}

export function DeleteProjectDialog({ project, trigger }: DeleteProjectDialogProps) {
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
      await deleteProject(project.id)
      await queryClient.invalidateQueries({ queryKey: ["projects"] })
      showToast({ variant: "success", title: "Project deleted", description: project.name })
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
      <DialogContent className="max-w-md rounded-2xl bg-card p-7 shadow-2xl">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-1.5">
            <DialogTitle className="text-xl font-bold">Delete &quot;{project.name}&quot;?</DialogTitle>
            <DialogDescription>
              This permanently removes the project and all its feature requests. This action cannot be
              undone.
            </DialogDescription>
          </div>
        </div>
        {error && <Alert className="mt-3">{error}</Alert>}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="outline" className="w-full" onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" className="w-full" onClick={handleConfirm} disabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete project"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
