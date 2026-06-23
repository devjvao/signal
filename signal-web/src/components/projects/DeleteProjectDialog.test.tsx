import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import type { Project } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { ToastProvider } from "@/context/ToastContext"
import { DeleteProjectDialog } from "./DeleteProjectDialog"

const project: Project = {
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

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <DeleteProjectDialog project={project} trigger={<Button>Open</Button>} />
      </ToastProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DeleteProjectDialog", () => {
  it("names the project in the title and deletes on confirm", async () => {
    const del = vi.spyOn(api, "deleteProject").mockResolvedValue(undefined)
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText('Delete "Aurora Notes"?')).toBeInTheDocument()
    expect(
      within(dialog).getByText(/permanently removes the project and all its feature requests/i)
    ).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete project" }))
    expect(del).toHaveBeenCalledWith("p1")
  })

  it("shows an inline alert when deletion fails", async () => {
    vi.spyOn(api, "deleteProject").mockRejectedValue(new api.ApiError(403, "forbidden"))
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete project" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("forbidden")
  })

  it("shows a success toast after deleting", async () => {
    vi.spyOn(api, "deleteProject").mockResolvedValue(undefined)
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete project" }))

    expect(await screen.findByText("Project deleted")).toBeInTheDocument()
  })

  it("clears a previous error when reopened", async () => {
    vi.spyOn(api, "deleteProject").mockRejectedValue(new api.ApiError(403, "forbidden"))
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    let dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete project" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("forbidden")

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    await userEvent.click(screen.getByText("Open"))
    dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
  })
})
