import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import ProjectPage from "./ProjectPage"

vi.mock("@/components/feature-requests/FeatureRequestList", () => ({
  FeatureRequestList: ({ projectId }: { projectId: string }) => <div>FeatureRequestList:{projectId}</div>,
}))

const project = { id: "p1", name: "Signal", slug: "signal", description: "A product", ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" }

function renderAt(path: string) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/projects/:id/feature-requests/new" element={<div>new feature request page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("ProjectPage", () => {
  it("renders the project and its feature request list", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue({ project })

    renderAt("/projects/p1")

    expect(await screen.findByText("Signal")).toBeInTheDocument()
    expect(screen.getByText("FeatureRequestList:p1")).toBeInTheDocument()
  })

  it("navigates to the new feature request page", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue({ project })

    renderAt("/projects/p1")

    await userEvent.click(await screen.findByText("New feature request"))
    expect(await screen.findByText("new feature request page")).toBeInTheDocument()
  })
})
