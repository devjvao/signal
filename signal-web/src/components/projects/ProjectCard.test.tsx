import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import * as api from "@/lib/api"
import type { Project } from "@/lib/api"
import { ProjectCard } from "./ProjectCard"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

const project: Project = {
  id: "p1",
  name: "Signal",
  slug: "signal",
  description: "A product",
  ownerId: "owner-1",
  ownerName: "Ada Lovelace",
  createdAt: "2026-06-21T00:00:00Z",
}

function mockUser(id: string) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "authenticated",
    user: { id, name: "User", email: "user@example.com", createdAt: "2026-06-21T00:00:00Z" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  })
}

function renderCard() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectCard project={project} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ProjectCard", () => {
  it("hides Edit/Delete for a non-owner", () => {
    mockUser("someone-else")
    renderCard()
    expect(screen.queryByText("Edit")).not.toBeInTheDocument()
    expect(screen.queryByText("Delete")).not.toBeInTheDocument()
  })

  it("shows Edit/Delete for the owner", () => {
    mockUser("owner-1")
    renderCard()
    expect(screen.getByText("Edit")).toBeInTheDocument()
    expect(screen.getByText("Delete")).toBeInTheDocument()
  })

  it("opens a confirmation dialog and deletes on confirm", async () => {
    mockUser("owner-1")
    vi.spyOn(api, "deleteProject").mockResolvedValue(undefined)
    renderCard()

    await userEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument()

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" })
    await userEvent.click(deleteButtons[deleteButtons.length - 1])

    expect(api.deleteProject).toHaveBeenCalledWith("p1")
  })

  it("navigates to the project page when the card body is clicked", async () => {
    mockUser("someone-else")
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<ProjectCard project={project} />} />
            <Route path="/projects/:id" element={<div>project page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    await userEvent.click(screen.getByText("Signal"))
    expect(await screen.findByText("project page")).toBeInTheDocument()
  })
})