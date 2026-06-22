import { useState } from "react"
import type { FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, createProject, updateProject } from "@/lib/api"
import type { Project } from "@/lib/api"

export default function ProjectFormPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const isEditMode = Boolean(id)
  const editingProject = (location.state as { project?: Project } | null)?.project ?? null

  const [name, setName] = useState(editingProject?.name ?? "")
  const [description, setDescription] = useState(editingProject?.description ?? "")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isEditMode && !editingProject) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const input = { name, description: description || undefined }
      if (isEditMode && id) {
        await updateProject(id, input)
      } else {
        await createProject(input)
      }
      await queryClient.invalidateQueries({ queryKey: ["projects"] })
      navigate("/")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">
        {isEditMode ? "Edit project" : "New project"}
      </h1>
      <form className="flex w-full max-w-sm flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" required value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </form>
    </div>
  )
}