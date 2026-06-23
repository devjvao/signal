import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import { ToastProvider } from "@/context/ToastContext"
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
  requestCount: 2,
  voteCount: 4,
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
      <ToastProvider>
        <MemoryRouter>
          <ProjectCard project={project} />
        </MemoryRouter>
      </ToastProvider>
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
    expect(screen.queryByLabelText("Edit project")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Delete project")).not.toBeInTheDocument()
  })

  it("shows Edit/Delete for the owner", () => {
    mockUser("owner-1")
    renderCard()
    expect(screen.getByLabelText("Edit project")).toBeInTheDocument()
    expect(screen.getByLabelText("Delete project")).toBeInTheDocument()
  })

  it("opens a confirmation dialog and deletes on confirm", async () => {
    mockUser("owner-1")
    vi.spyOn(api, "deleteProject").mockResolvedValue(undefined)
    renderCard()

    await userEvent.click(screen.getByRole("button", { name: "Delete project" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/permanently removes the project/i)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete project" }))

    expect(api.deleteProject).toHaveBeenCalledWith("p1")
  })

  it("shows a vote/request stats line", () => {
    mockUser("someone-else")
    renderCard()
    expect(screen.getByText("▲ 4 · 2 requests")).toBeInTheDocument()
  })

  it("shows a gray accent bar for a non-owner", () => {
    mockUser("someone-else")
    const { container } = renderCard()
    expect(container.firstChild).toHaveClass("before:bg-border")
  })

  it("shows a gradient accent bar for the owner but not for other viewers", () => {
    mockUser("owner-1")
    const { container: ownerContainer } = renderCard()
    expect(ownerContainer.firstChild).toHaveClass("before:bg-gradient-to-b")
  })

  it("does not show the gradient accent bar for a non-owner", () => {
    mockUser("someone-else")
    const { container } = renderCard()
    expect(container.firstChild).not.toHaveClass("before:bg-gradient-to-b")
  })

  it("does not navigate when typing a space in the edit modal", async () => {
    mockUser("owner-1")
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route path="/" element={<ProjectCard project={project} />} />
              <Route path="/projects/:id" element={<div>project page</div>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )

    await userEvent.click(screen.getByRole("button", { name: "Edit project" }))
    const nameInput = within(await screen.findByRole("dialog")).getByLabelText("Project name")
    await userEvent.type(nameInput, " ")

    expect(screen.queryByText("project page")).not.toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(nameInput).toHaveValue("Signal ")
  })

  it("navigates to the project page when the card body is clicked", async () => {
    mockUser("someone-else")
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route path="/" element={<ProjectCard project={project} />} />
              <Route path="/projects/:id" element={<div>project page</div>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )

    await userEvent.click(screen.getByText("Signal"))
    expect(await screen.findByText("project page")).toBeInTheDocument()
  })
})