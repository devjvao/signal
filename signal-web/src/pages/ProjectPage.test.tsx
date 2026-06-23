import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { ToastProvider } from "@/context/ToastContext"
import * as api from "@/lib/api"
import ProjectPage from "./ProjectPage"

vi.mock("@/components/layout/AppHeader", () => ({ AppHeader: () => null }))

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return {
    ...actual,
    useAuth: () => ({
      status: "authenticated",
      user: { id: "o1", name: "Owner", email: "owner@example.com", createdAt: "2026-06-21T00:00:00Z" },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    }),
  }
})

vi.mock("@/components/feature-requests/FeatureRequestList", () => ({
  FeatureRequestList: ({ projectId, status, sort }: { projectId: string; status?: string | null; sort?: string }) => (
    <div>FeatureRequestList:{projectId}:{String(status)}:{sort}</div>
  ),
}))

const project = { id: "p1", name: "Signal", slug: "signal", description: "A product", ownerId: "o1", ownerName: "Ada", requestCount: 3, voteCount: 7, createdAt: "2026-06-21T00:00:00Z" }

function renderAt(path: string) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/projects/:id" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}

describe("ProjectPage", () => {
  it("renders the project and its feature request list", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue({ project })

    renderAt("/projects/p1")

    expect(await screen.findByText("Signal")).toBeInTheDocument()
    expect(screen.getByText("FeatureRequestList:p1:null:votes")).toBeInTheDocument()
  })

  it("opens the new feature request modal", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue({ project })

    renderAt("/projects/p1")

    await userEvent.click(await screen.findByText("New feature request"))
    expect(await screen.findByText("Suggest a feature")).toBeInTheDocument()
  })

  it("shows the request count in the hero", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue({ project })
    renderAt("/projects/p1")
    expect(await screen.findByText("3 requests")).toBeInTheDocument()
    expect(screen.queryByText("You own this")).not.toBeInTheDocument()
  })

  it("filters and sorts feature requests via FilterChips and SortSelect", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue({ project })
    renderAt("/projects/p1")
    expect(await screen.findByText("FeatureRequestList:p1:null:votes")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Planned" }))
    expect(screen.getByText("FeatureRequestList:p1:planned:votes")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("combobox", { name: "Sort feature requests" }))
    await userEvent.click(await screen.findByText("Newest"))
    expect(screen.getByText("FeatureRequestList:p1:planned:newest")).toBeInTheDocument()
  })
})
