import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import * as api from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"
import { FeatureRequestList } from "./FeatureRequestList"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

let intersectionCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null

class MockIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    intersectionCallback = callback
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  intersectionCallback = null
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "authenticated",
    user: { id: "viewer-1", name: "Viewer", email: "viewer@example.com", createdAt: "2026-06-21T00:00:00Z" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

function featureRequest(id: string): FeatureRequest {
  return {
    id,
    projectId: "p1",
    title: `Request ${id}`,
    description: null,
    status: "open",
    createdBy: "author-1",
    createdByName: "Ada Lovelace",
    upvoteCount: 0,
    viewerHasVoted: false,
    createdAt: "2026-06-21T00:00:00Z",
  }
}

describe("FeatureRequestList", () => {
  it("renders the first page", async () => {
    vi.spyOn(api, "listFeatureRequests").mockResolvedValue({ featureRequests: [featureRequest("1")], nextCursor: null })

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" />)

    expect(await screen.findByText("Request 1")).toBeInTheDocument()
    expect(api.listFeatureRequests).toHaveBeenCalledWith("p1", { cursor: undefined })
  })

  it("shows an empty state when there are none", async () => {
    vi.spyOn(api, "listFeatureRequests").mockResolvedValue({ featureRequests: [], nextCursor: null })

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" />)

    expect(await screen.findByText("No feature requests yet.")).toBeInTheDocument()
  })

  it("fetches the next page when the sentinel intersects", async () => {
    const spy = vi.spyOn(api, "listFeatureRequests")
    spy.mockResolvedValueOnce({ featureRequests: [featureRequest("1")], nextCursor: "cursor-1" })
    spy.mockResolvedValueOnce({ featureRequests: [featureRequest("2")], nextCursor: null })

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" />)

    expect(await screen.findByText("Request 1")).toBeInTheDocument()
    intersectionCallback?.([{ isIntersecting: true }])
    expect(await screen.findByText("Request 2")).toBeInTheDocument()
    expect(spy).toHaveBeenLastCalledWith("p1", { cursor: "cursor-1" })
  })
})
