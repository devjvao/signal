import { useState } from "react"
import type { FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, createFeatureRequest, updateFeatureRequest } from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"

export default function FeatureRequestFormPage() {
  const { projectId: projectIdParam, id: featureRequestId } = useParams<{ projectId?: string; id?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const isEditMode = Boolean(featureRequestId)
  const editing = (location.state as { featureRequest?: FeatureRequest } | null)?.featureRequest ?? null
  const projectId = isEditMode ? editing?.projectId : projectIdParam

  const [title, setTitle] = useState(editing?.title ?? "")
  const [description, setDescription] = useState(editing?.description ?? "")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isEditMode && !editing) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const input = { title, description: description || undefined }
      if (isEditMode && featureRequestId) {
        await updateFeatureRequest(featureRequestId, input)
      } else if (projectId) {
        await createFeatureRequest(projectId, input)
      }
      await queryClient.invalidateQueries({ queryKey: ["featureRequests", projectId] })
      navigate(`/projects/${projectId}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">
        {isEditMode ? "Edit feature request" : "New feature request"}
      </h1>
      <form className="flex w-full max-w-sm flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" required value={title} onChange={(event) => setTitle(event.target.value)} />
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
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(`/projects/${projectId}`)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
