import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import * as api from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"
import { FeatureRequestCard } from "./FeatureRequestCard"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

function mockUser(id: string) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "authenticated",
    user: { id, name: "User", email: "user@example.com", createdAt: "2026-06-21T00:00:00Z" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  })
}

const base: FeatureRequest = {
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

function renderCard(featureRequest: FeatureRequest, projectOwnerId = "owner-1") {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FeatureRequestCard featureRequest={featureRequest} projectOwnerId={projectOwnerId} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("FeatureRequestCard", () => {
  it("renders title, status and upvote count", () => {
    mockUser("viewer-1")
    renderCard({ ...base, upvoteCount: 3 })
    expect(screen.getByText("Dark mode")).toBeInTheDocument()
    expect(screen.getByText("open")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
  })

  it("hides the upvote button for the author", () => {
    mockUser("author-1")
    renderCard(base)
    expect(screen.queryByRole("button", { name: /upvote/i })).not.toBeInTheDocument()
  })

  it("shows Edit only for the author when there are no upvotes", () => {
    mockUser("author-1")
    renderCard({ ...base, upvoteCount: 0 })
    expect(screen.getByText("Edit")).toBeInTheDocument()
  })

  it("hides Edit for the author once it has upvotes", () => {
    mockUser("author-1")
    renderCard({ ...base, upvoteCount: 2 })
    expect(screen.queryByText("Edit")).not.toBeInTheDocument()
  })

  it("shows Delete for the project owner who is not the author", () => {
    mockUser("owner-1")
    renderCard(base, "owner-1")
    expect(screen.getByText("Delete")).toBeInTheDocument()
    expect(screen.queryByText("Edit")).not.toBeInTheDocument()
  })

  it("hides Edit and Delete for an unrelated viewer", () => {
    mockUser("stranger")
    renderCard(base)
    expect(screen.queryByText("Edit")).not.toBeInTheDocument()
    expect(screen.queryByText("Delete")).not.toBeInTheDocument()
  })

  it("calls voteFeatureRequest when an eligible viewer upvotes", async () => {
    mockUser("viewer-1")
    vi.spyOn(api, "voteFeatureRequest").mockResolvedValue({ featureRequest: { ...base, upvoteCount: 1, viewerHasVoted: true } })
    renderCard(base)

    await userEvent.click(screen.getByRole("button", { name: /upvote/i }))
    expect(api.voteFeatureRequest).toHaveBeenCalledWith("f1")
  })

  it("calls unvoteFeatureRequest when the viewer has already voted", async () => {
    mockUser("viewer-1")
    vi.spyOn(api, "unvoteFeatureRequest").mockResolvedValue({ featureRequest: { ...base, viewerHasVoted: false } })
    renderCard({ ...base, viewerHasVoted: true, upvoteCount: 1 })

    await userEvent.click(screen.getByRole("button", { name: /upvote/i }))
    expect(api.unvoteFeatureRequest).toHaveBeenCalledWith("f1")
  })

  it("shows a status select for the project owner", () => {
    mockUser("owner-1")
    renderCard(base, "owner-1")
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument()
  })

  it("shows the read-only status badge for a non-owner", () => {
    mockUser("viewer-1")
    renderCard(base)
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument()
    expect(screen.getByText("open")).toBeInTheDocument()
  })

  it("updates the status when the project owner selects a new value", async () => {
    mockUser("owner-1")
    vi.spyOn(api, "updateFeatureRequestStatus").mockResolvedValue({
      featureRequest: { ...base, status: "planned" },
    })
    renderCard(base, "owner-1")

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("planned"))

    expect(api.updateFeatureRequestStatus).toHaveBeenCalledWith("f1", "planned")
  })

  it("shows an inline error and keeps the original status when the update fails", async () => {
    mockUser("owner-1")
    vi.spyOn(api, "updateFeatureRequestStatus").mockRejectedValue(new api.ApiError(403, "forbidden"))
    renderCard(base, "owner-1")

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("planned"))

    expect(await screen.findByText("forbidden")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("open")
  })
})
