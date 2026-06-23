import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { ToastProvider } from "@/context/ToastContext"
import { FeatureRequestFormDialog } from "./FeatureRequestFormDialog"

const existing: FeatureRequest = {
  id: "f1",
  projectId: "p1",
  title: "Dark mode",
  description: "Please add it",
  status: "planned",
  createdBy: "author-1",
  createdByName: "Ada",
  upvoteCount: 0,
  viewerHasVoted: false,
  createdAt: "2026-06-21T00:00:00Z",
}

function renderDialog(props: { projectId: string; featureRequest?: FeatureRequest }) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <FeatureRequestFormDialog {...props} trigger={<Button>Open form</Button>} />
      </ToastProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("FeatureRequestFormDialog", () => {
  it("opens the create form and submits a new request", async () => {
    const create = vi
      .spyOn(api, "createFeatureRequest")
      .mockResolvedValue({ featureRequest: existing })

    renderDialog({ projectId: "p1" })

    await userEvent.click(screen.getByText("Open form"))
    expect(await screen.findByText("Suggest a feature")).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText("Title"), "New idea")
    await userEvent.type(screen.getByLabelText("Description"), "Details")
    await userEvent.click(screen.getByRole("button", { name: "Save request" }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith("p1", { title: "New idea", description: "Details" })
    )
  })

  it("opens the edit form prefilled and submits an update", async () => {
    const update = vi
      .spyOn(api, "updateFeatureRequest")
      .mockResolvedValue({ featureRequest: existing })

    renderDialog({ projectId: "p1", featureRequest: existing })

    await userEvent.click(screen.getByText("Open form"))
    expect(await screen.findByText("Edit feature request")).toBeInTheDocument()
    expect(screen.getByLabelText("Title")).toHaveValue("Dark mode")

    await userEvent.clear(screen.getByLabelText("Title"))
    await userEvent.type(screen.getByLabelText("Title"), "Updated")
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("f1", { title: "Updated", description: "Please add it" })
    )
  })

  it("shows a success toast after creating a request", async () => {
    vi.spyOn(api, "createFeatureRequest").mockResolvedValue({ featureRequest: existing })

    renderDialog({ projectId: "p1" })

    await userEvent.click(screen.getByText("Open form"))
    await userEvent.type(await screen.findByLabelText("Title"), "New idea")
    await userEvent.click(screen.getByRole("button", { name: "Save request" }))

    expect(await screen.findByText("Request created")).toBeInTheDocument()
  })

  it("shows a success toast after editing a request", async () => {
    vi.spyOn(api, "updateFeatureRequest").mockResolvedValue({ featureRequest: existing })

    renderDialog({ projectId: "p1", featureRequest: existing })

    await userEvent.click(screen.getByText("Open form"))
    await userEvent.click(await screen.findByRole("button", { name: "Save changes" }))

    expect(await screen.findByText("Request updated")).toBeInTheDocument()
  })

  it("shows an inline alert when the request fails", async () => {
    vi.spyOn(api, "createFeatureRequest").mockRejectedValue(new api.ApiError(400, "title is required"))

    renderDialog({ projectId: "p1" })

    await userEvent.click(screen.getByText("Open form"))
    await userEvent.type(await screen.findByLabelText("Title"), "x")
    await userEvent.click(screen.getByRole("button", { name: "Save request" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("title is required")
  })
})
