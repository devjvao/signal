import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import { ProtectedRoute } from "./ProtectedRoute"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return {
    ...actual,
    useAuth: vi.fn(),
  }
})

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <div>secret content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe("ProtectedRoute", () => {
  it("renders nothing while loading", () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "loading",
      user: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })

    renderProtected()
    expect(screen.queryByText("secret content")).not.toBeInTheDocument()
    expect(screen.queryByText("login page")).not.toBeInTheDocument()
  })

  it("redirects to /login when unauthenticated", () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "unauthenticated",
      user: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })

    renderProtected()
    expect(screen.getByText("login page")).toBeInTheDocument()
  })

  it("renders its children when authenticated", () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "authenticated",
      user: { id: "1", name: "Ada Lovelace", email: "ada@example.com", createdAt: "2026-06-21T00:00:00Z" },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })

    renderProtected()
    expect(screen.getByText("secret content")).toBeInTheDocument()
  })
})
