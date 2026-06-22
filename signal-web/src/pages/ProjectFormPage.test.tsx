import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import ProjectFormPage from "./ProjectFormPage"

function renderAt(initialEntries: Array<string | { pathname: string; state?: unknown }>) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/" element={<div>projects list</div>} />
          <Route path="/projects/new" element={<ProjectFormPage />} />
          <Route path="/projects/:id/edit" element={<ProjectFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("ProjectFormPage", () => {
  it("creates a project and redirects to the projects list", async () => {
    vi.spyOn(api, "createProject").mockResolvedValue({
      project: { id: "1", name: "Signal", slug: "signal", description: null, ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" },
    })

    renderAt(["/projects/new"])

    expect(screen.getByText("New project")).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Name"), "Signal")
    await userEvent.click(screen.getByText("Save"))

    expect(api.createProject).toHaveBeenCalledWith({ name: "Signal", description: undefined })
    expect(await screen.findByText("projects list")).toBeInTheDocument()
  })

  it("prefills from navigation state and updates an existing project", async () => {
    vi.spyOn(api, "updateProject").mockResolvedValue({
      project: { id: "1", name: "Signal v2", slug: "signal", description: "old", ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" },
    })
    const project = { id: "1", name: "Signal", slug: "signal", description: "old", ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" }

    renderAt([{ pathname: "/projects/1/edit", state: { project } }])

    expect(screen.getByText("Edit project")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Signal")).toBeInTheDocument()
    expect(screen.getByDisplayValue("old")).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText("Name"))
    await userEvent.type(screen.getByLabelText("Name"), "Signal v2")
    await userEvent.click(screen.getByText("Save"))

    expect(api.updateProject).toHaveBeenCalledWith("1", { name: "Signal v2", description: "old" })
    expect(await screen.findByText("projects list")).toBeInTheDocument()
  })

  it("redirects to / when edit state is missing", () => {
    renderAt(["/projects/1/edit"])
    expect(screen.getByText("projects list")).toBeInTheDocument()
  })
})
