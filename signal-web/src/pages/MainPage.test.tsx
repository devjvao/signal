import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import { ToastProvider } from "@/context/ToastContext"
import MainPage from "./MainPage"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

vi.mock("@/components/projects/ProjectList", () => ({
  ProjectList: ({ scope, search, sort }: { scope: string; search?: string; sort?: string }) => (
    <div>
      ProjectList:{scope}:{search}:{sort}
    </div>
  ),
}))

vi.mock("@/components/ui/search-input", () => ({
  SearchInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="Search projects" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

function mockAuthenticated() {
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "authenticated",
    user: { id: "1", name: "Ada Lovelace", email: "ada@example.com", createdAt: "2026-06-21T00:00:00Z" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  })
}

function renderMain() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter>
          <MainPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}

describe("MainPage", () => {
  it("defaults to the All projects tab", () => {
    mockAuthenticated()

    renderMain()

    expect(screen.getByText("ProjectList:all::active")).toBeInTheDocument()
    expect(screen.queryByText(/ProjectList:mine/)).not.toBeInTheDocument()
  })

  it("switches to My projects when that tab is clicked", async () => {
    mockAuthenticated()

    renderMain()

    await userEvent.click(screen.getByText("My projects"))
    expect(screen.getByText("ProjectList:mine::active")).toBeInTheDocument()
  })
})

describe("MainPage header and hero", () => {
  it("shows the hero title", () => {
    mockAuthenticated()
    renderMain()
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument()
  })

  it("shows the user's initials and a theme toggle in the header", () => {
    mockAuthenticated()
    renderMain()
    expect(screen.getByText("AL")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /switch to (dark|light) theme/i })).toBeInTheDocument()
  })
})

describe("MainPage search and sort", () => {
  it("passes the typed search value down to ProjectList", async () => {
    mockAuthenticated()
    renderMain()
    await userEvent.type(screen.getByLabelText("Search projects"), "signal")
    expect(screen.getByText("ProjectList:all:signal:active")).toBeInTheDocument()
  })

  it("passes the selected sort value down to ProjectList", async () => {
    mockAuthenticated()
    renderMain()
    await userEvent.click(screen.getByRole("combobox", { name: "Sort" }))
    await userEvent.click(await screen.findByText("Newest"))
    expect(screen.getByText("ProjectList:all::newest")).toBeInTheDocument()
  })
})

describe("MainPage New project button", () => {
  it("opens the new project modal when clicked", async () => {
    mockAuthenticated()

    renderMain()

    await userEvent.click(screen.getByRole("button", { name: "+ New project" }))
    expect(await screen.findByText("Create a project")).toBeInTheDocument()
  })
})
