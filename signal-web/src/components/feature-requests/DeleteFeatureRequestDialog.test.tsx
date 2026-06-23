import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { ToastProvider } from "@/context/ToastContext"
import { DeleteFeatureRequestDialog } from "./DeleteFeatureRequestDialog"

const featureRequest: FeatureRequest = {
  id: "f1",
  projectId: "p1",
  title: "Dark mode",
  description: "Please add it",
  status: "open",
  createdBy: "author-1",
  createdByName: "Ada Lovelace",
  upvoteCount: 0,
  viewerHasVoted: false,
  createdAt: "2026-06-21T00:00:00Z",
}

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <DeleteFeatureRequestDialog featureRequest={featureRequest} trigger={<Button>Open</Button>} />
      </ToastProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DeleteFeatureRequestDialog", () => {
  it("deletes on confirm", async () => {
    const del = vi.spyOn(api, "deleteFeatureRequest").mockResolvedValue(undefined)
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(del).toHaveBeenCalledWith("f1")
  })

  it("shows an inline alert when deletion fails", async () => {
    vi.spyOn(api, "deleteFeatureRequest").mockRejectedValue(new api.ApiError(403, "forbidden"))
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("forbidden")
  })

  it("shows a success toast after deleting", async () => {
    vi.spyOn(api, "deleteFeatureRequest").mockResolvedValue(undefined)
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Request deleted")).toBeInTheDocument()
  })

  it("clears a previous error when reopened", async () => {
    vi.spyOn(api, "deleteFeatureRequest").mockRejectedValue(new api.ApiError(403, "forbidden"))
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    let dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("forbidden")

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    await userEvent.click(screen.getByText("Open"))
    dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
  })
})
