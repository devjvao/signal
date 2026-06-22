import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import MainPage from "./MainPage"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

vi.mock("@/components/projects/ProjectList", () => ({
  ProjectList: ({ scope }: { scope: string }) => <div>ProjectList:{scope}</div>,
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

describe("MainPage", () => {
  it("defaults to the All projects tab", () => {
    mockAuthenticated()

    render(
      <MemoryRouter>
        <MainPage />
      </MemoryRouter>
    )

    expect(screen.getByText("ProjectList:all")).toBeInTheDocument()
    expect(screen.queryByText("ProjectList:mine")).not.toBeInTheDocument()
  })

  it("switches to My projects when that tab is clicked", async () => {
    mockAuthenticated()

    render(
      <MemoryRouter>
        <MainPage />
      </MemoryRouter>
    )

    await userEvent.click(screen.getByText("My projects"))
    expect(screen.getByText("ProjectList:mine")).toBeInTheDocument()
  })
})