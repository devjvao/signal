import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import { ToastProvider } from "@/context/ToastContext"
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
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
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
    expect(api.listFeatureRequests).toHaveBeenCalledWith("p1", { cursor: undefined, status: undefined, sort: "votes" })
  })

  it("shows an empty state when there are none", async () => {
    vi.spyOn(api, "listFeatureRequests").mockResolvedValue({ featureRequests: [], nextCursor: null })

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" />)

    expect(await screen.findByText("No feature requests yet")).toBeInTheDocument()
  })

  it("fetches the next page when the sentinel intersects", async () => {
    const spy = vi.spyOn(api, "listFeatureRequests")
    spy.mockResolvedValueOnce({ featureRequests: [featureRequest("1")], nextCursor: "cursor-1" })
    spy.mockResolvedValueOnce({ featureRequests: [featureRequest("2")], nextCursor: null })

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" />)

    expect(await screen.findByText("Request 1")).toBeInTheDocument()
    intersectionCallback?.([{ isIntersecting: true }])
    expect(await screen.findByText("Request 2")).toBeInTheDocument()
    expect(spy).toHaveBeenLastCalledWith("p1", { cursor: "cursor-1", status: undefined, sort: "votes" })
  })

  it("passes status and sort through to listFeatureRequests", async () => {
    const spy = vi.spyOn(api, "listFeatureRequests").mockResolvedValue({ featureRequests: [], nextCursor: null })
    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" status="planned" sort="newest" />)
    await screen.findByText("No requests match this filter.")
    expect(spy).toHaveBeenCalledWith("p1", { cursor: undefined, status: "planned", sort: "newest" })
  })

  it("shows an error toast when a status update fails", async () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "authenticated",
      user: { id: "owner-1", name: "Owner", email: "owner@example.com", createdAt: "2026-06-21T00:00:00Z" },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })
    vi.spyOn(api, "listFeatureRequests").mockResolvedValue({
      featureRequests: [featureRequest("1")],
      nextCursor: null,
    })
    vi.spyOn(api, "updateFeatureRequestStatus").mockRejectedValue(new api.ApiError(403, "forbidden"))

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" />)

    await screen.findByText("Request 1")
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("Planned"))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Couldn't update status")
    expect(alert).toHaveTextContent("forbidden")
  })
})
