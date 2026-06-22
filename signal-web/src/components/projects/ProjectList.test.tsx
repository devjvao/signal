import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import { ProjectList } from "./ProjectList"

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
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function project(id: string) {
  return {
    id,
    name: `Project ${id}`,
    slug: `project-${id}`,
    description: null,
    ownerId: "owner-1",
    ownerName: "Ada Lovelace",
    createdAt: "2026-06-21T00:00:00Z",
  }
}

describe("ProjectList", () => {
  it("renders the first page for scope=all using listProjects", async () => {
    vi.spyOn(api, "listProjects").mockResolvedValue({ projects: [project("1")], nextCursor: null })
    const listMyProjectsSpy = vi.spyOn(api, "listMyProjects")

    renderWithClient(<ProjectList scope="all" />)

    expect(await screen.findByText("Project 1")).toBeInTheDocument()
    expect(listMyProjectsSpy).not.toHaveBeenCalled()
  })

  it("renders using listMyProjects for scope=mine", async () => {
    vi.spyOn(api, "listMyProjects").mockResolvedValue({ projects: [project("2")], nextCursor: null })

    renderWithClient(<ProjectList scope="mine" />)

    expect(await screen.findByText("Project 2")).toBeInTheDocument()
  })

  it("shows an empty state when there are no projects", async () => {
    vi.spyOn(api, "listProjects").mockResolvedValue({ projects: [], nextCursor: null })

    renderWithClient(<ProjectList scope="all" />)

    expect(await screen.findByText("No projects yet.")).toBeInTheDocument()
  })

  it("fetches the next page when the sentinel intersects", async () => {
    const spy = vi.spyOn(api, "listProjects")
    spy.mockResolvedValueOnce({ projects: [project("1")], nextCursor: "cursor-1" })
    spy.mockResolvedValueOnce({ projects: [project("2")], nextCursor: null })

    renderWithClient(<ProjectList scope="all" />)

    expect(await screen.findByText("Project 1")).toBeInTheDocument()

    intersectionCallback?.([{ isIntersecting: true }])

    expect(await screen.findByText("Project 2")).toBeInTheDocument()
    expect(spy).toHaveBeenLastCalledWith({ cursor: "cursor-1" })
  })
})
