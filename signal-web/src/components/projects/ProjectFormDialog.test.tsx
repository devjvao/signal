import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import type { Project } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { ToastProvider } from "@/context/ToastContext"
import { ProjectFormDialog } from "./ProjectFormDialog"

const existing: Project = {
  id: "p1",
  name: "Aurora Notes",
  slug: "aurora-notes",
  description: "A note-taking app",
  ownerId: "owner-1",
  ownerName: "Ada",
  requestCount: 0,
  voteCount: 0,
  createdAt: "2026-06-21T00:00:00Z",
}

function renderDialog(props: { project?: Project }) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ProjectFormDialog {...props} trigger={<Button>Open form</Button>} />
      </ToastProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ProjectFormDialog", () => {
  it("opens the create form and submits a new project", async () => {
    const create = vi.spyOn(api, "createProject").mockResolvedValue({ project: existing })

    renderDialog({})

    await userEvent.click(screen.getByText("Open form"))
    expect(await screen.findByText("Create a project")).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText("Project name"), "Cobalt CLI")
    await userEvent.type(screen.getByLabelText("Description"), "A terminal toolkit")
    await userEvent.click(screen.getByRole("button", { name: "Save project" }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: "Cobalt CLI", description: "A terminal toolkit" })
    )
  })

  it("opens the edit form prefilled and submits an update", async () => {
    const update = vi.spyOn(api, "updateProject").mockResolvedValue({ project: existing })

    renderDialog({ project: existing })

    await userEvent.click(screen.getByText("Open form"))
    expect(await screen.findByText("Edit project")).toBeInTheDocument()
    expect(screen.getByLabelText("Project name")).toHaveValue("Aurora Notes")

    await userEvent.clear(screen.getByLabelText("Project name"))
    await userEvent.type(screen.getByLabelText("Project name"), "Aurora")
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("p1", { name: "Aurora", description: "A note-taking app" })
    )
  })

  it("shows a success toast after creating a project", async () => {
    vi.spyOn(api, "createProject").mockResolvedValue({ project: existing })

    renderDialog({})

    await userEvent.click(screen.getByText("Open form"))
    await userEvent.type(screen.getByLabelText("Project name"), "Cobalt CLI")
    await userEvent.click(screen.getByRole("button", { name: "Save project" }))

    expect(await screen.findByText("Project created")).toBeInTheDocument()
  })

  it("shows a success toast after updating a project", async () => {
    vi.spyOn(api, "updateProject").mockResolvedValue({ project: existing })

    renderDialog({ project: existing })

    await userEvent.click(screen.getByText("Open form"))
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    expect(await screen.findByText("Project updated")).toBeInTheDocument()
  })

  it("shows an inline alert and keeps the dialog open when the request fails", async () => {
    vi.spyOn(api, "createProject").mockRejectedValue(new api.ApiError(400, "name is required"))

    renderDialog({})

    await userEvent.click(screen.getByText("Open form"))
    await userEvent.type(await screen.findByLabelText("Project name"), "x")
    await userEvent.click(screen.getByRole("button", { name: "Save project" }))

    // The inline Alert lives inside the open dialog (not a portaled toast), so no { hidden: true }.
    expect(await screen.findByRole("alert")).toHaveTextContent("name is required")
    // Dialog stays open.
    expect(screen.getByText("Create a project")).toBeInTheDocument()
  })
})
