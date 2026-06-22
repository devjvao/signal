import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"
import FeatureRequestFormPage from "./FeatureRequestFormPage"

function renderAt(initialEntries: Array<string | { pathname: string; state?: unknown }>) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/projects/:id" element={<div>project page</div>} />
          <Route path="/projects/:projectId/feature-requests/new" element={<FeatureRequestFormPage />} />
          <Route path="/feature-requests/:id/edit" element={<FeatureRequestFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const existing: FeatureRequest = {
  id: "f1",
  projectId: "p1",
  title: "Dark mode",
  description: "old",
  status: "open",
  createdBy: "u1",
  createdByName: "Ada",
  upvoteCount: 0,
  viewerHasVoted: false,
  createdAt: "2026-06-21T00:00:00Z",
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("FeatureRequestFormPage", () => {
  it("creates a feature request and redirects to the project page", async () => {
    vi.spyOn(api, "createFeatureRequest").mockResolvedValue({ featureRequest: existing })

    renderAt(["/projects/p1/feature-requests/new"])

    expect(screen.getByText("New feature request")).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Title"), "Dark mode")
    await userEvent.click(screen.getByText("Save"))

    expect(api.createFeatureRequest).toHaveBeenCalledWith("p1", { title: "Dark mode", description: undefined })
    expect(await screen.findByText("project page")).toBeInTheDocument()
  })

  it("requires a title before submitting", async () => {
    const spy = vi.spyOn(api, "createFeatureRequest")
    renderAt(["/projects/p1/feature-requests/new"])

    await userEvent.click(screen.getByText("Save"))
    expect(spy).not.toHaveBeenCalled()
  })

  it("prefills and updates an existing feature request", async () => {
    vi.spyOn(api, "updateFeatureRequest").mockResolvedValue({ featureRequest: { ...existing, title: "Dark theme" } })

    renderAt([{ pathname: "/feature-requests/f1/edit", state: { featureRequest: existing } }])

    expect(screen.getByText("Edit feature request")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Dark mode")).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText("Title"))
    await userEvent.type(screen.getByLabelText("Title"), "Dark theme")
    await userEvent.click(screen.getByText("Save"))

    expect(api.updateFeatureRequest).toHaveBeenCalledWith("f1", { title: "Dark theme", description: "old" })
    expect(await screen.findByText("project page")).toBeInTheDocument()
  })

  it("redirects to the project when Cancel is clicked", async () => {
    renderAt(["/projects/p1/feature-requests/new"])
    await userEvent.click(screen.getByText("Cancel"))
    expect(await screen.findByText("project page")).toBeInTheDocument()
  })

  it("redirects home when edit state is missing", () => {
    renderAt(["/feature-requests/f1/edit"])
    // No state -> redirect to "/" which is not registered here, so the form is not shown.
    expect(screen.queryByText("Edit feature request")).not.toBeInTheDocument()
  })
})
