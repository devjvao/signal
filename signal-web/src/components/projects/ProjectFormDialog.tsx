import { useMutation, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useState } from "react"
import type { FormEvent, ReactNode } from "react"

import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useToast } from "@/context/ToastContext"
import { ApiError, createProject, updateProject } from "@/lib/api"
import type { Project } from "@/lib/api"

interface ProjectFormDialogProps {
  trigger: ReactNode
  /** When provided, the dialog is in edit mode and pre-fills from this project. */
  project?: Project
}

export function ProjectFormDialog({ trigger, project }: ProjectFormDialogProps) {
  const isEdit = Boolean(project)
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(project?.name ?? "")
  const [description, setDescription] = useState(project?.description ?? "")
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    if (next) {
      setName(project?.name ?? "")
      setDescription(project?.description ?? "")
      setError(null)
    }
    setOpen(next)
  }

  const mutation = useMutation({
    mutationFn: () => {
      const input = { name, description: description || undefined }
      return isEdit ? updateProject(project!.id, input) : createProject(input)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] })
      showToast({
        variant: "success",
        title: isEdit ? "Project updated" : "Project created",
        description: name,
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
            {isEdit ? "Editing" : "New project"}
          </span>
          <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">
            {isEdit ? "Edit project" : "Create a project"}
          </DialogTitle>
        </div>
        <form className="mt-5 flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              required
              placeholder="e.g. Aurora Notes"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              className="min-h-[120px]"
              placeholder="What is this project about?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-3 pt-1">
            <Button type="submit" className="flex-1" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : isEdit ? "Save changes" : "Save project"}
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
