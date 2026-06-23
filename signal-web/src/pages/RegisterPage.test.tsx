import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import { ToastProvider } from "@/context/ToastContext"
import { ApiError } from "@/lib/api"
import RegisterPage from "./RegisterPage"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

function setupAuth(register = vi.fn()) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "unauthenticated",
    user: null,
    login: vi.fn(),
    register,
    logout: vi.fn(),
  })
  return register
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RegisterPage />
      </ToastProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  setupAuth()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("RegisterPage", () => {
  it("shows the hero tagline and registers on submit", async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    vi.mocked(authContext.useAuth).mockReturnValue({ status: "unauthenticated", user: null, login: vi.fn(), register, logout: vi.fn() })
    renderAt("/register")
    expect(screen.getByText("Shape the software you love.")).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Name"), "Ada Lovelace")
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com")
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery")
    await userEvent.click(screen.getByRole("button", { name: "Create account" }))
    expect(register).toHaveBeenCalledWith("Ada Lovelace", "ada@example.com", "correct-horse-battery")
    expect(await screen.findByText("login page")).toBeInTheDocument()
  })

  it("navigates to login when the link is clicked", async () => {
    vi.mocked(authContext.useAuth).mockReturnValue({ status: "unauthenticated", user: null, login: vi.fn(), register: vi.fn(), logout: vi.fn() })
    renderAt("/register")
    await userEvent.click(screen.getByRole("button", { name: "Log in" }))
    expect(await screen.findByText("login page")).toBeInTheDocument()
  })

  it("does not show an error toast initially", () => {
    renderPage()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows an error toast when registration fails", async () => {
    setupAuth(vi.fn().mockRejectedValue(new ApiError(409, "email already in use")))
    renderPage()

    await userEvent.type(screen.getByLabelText("Name"), "Ada")
    await userEvent.type(screen.getByLabelText("Email"), "a@b.com")
    await userEvent.type(screen.getByLabelText("Password"), "password123")
    await userEvent.click(screen.getByRole("button", { name: "Create account" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Couldn't create account")
    expect(alert).toHaveTextContent("email already in use")
  })
})
