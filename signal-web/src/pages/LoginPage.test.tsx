import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import { ToastProvider } from "@/context/ToastContext"
import { ApiError } from "@/lib/api"
import LoginPage from "./LoginPage"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>home</div>} />
          <Route path="/register" element={<div>register page</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

function setupAuth(login = vi.fn()) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "unauthenticated",
    user: null,
    login,
    register: vi.fn(),
    logout: vi.fn(),
  })
  return login
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <LoginPage />
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

describe("LoginPage", () => {
  it("shows the hero tagline and logs in on submit", async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    vi.mocked(authContext.useAuth).mockReturnValue({ status: "unauthenticated", user: null, login, register: vi.fn(), logout: vi.fn() })
    renderAt("/login")
    expect(screen.getByText("Vote the future into focus.")).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com")
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery")
    await userEvent.click(screen.getByRole("button", { name: "Log in" }))
    expect(login).toHaveBeenCalledWith("ada@example.com", "correct-horse-battery")
    expect(await screen.findByText("home")).toBeInTheDocument()
  })

  it("navigates to register when the link is clicked", async () => {
    vi.mocked(authContext.useAuth).mockReturnValue({ status: "unauthenticated", user: null, login: vi.fn(), register: vi.fn(), logout: vi.fn() })
    renderAt("/login")
    await userEvent.click(screen.getByText("Register"))
    expect(await screen.findByText("register page")).toBeInTheDocument()
  })

  it("does not show an error toast initially", () => {
    renderPage()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows an error toast when login fails", async () => {
    setupAuth(vi.fn().mockRejectedValue(new ApiError(401, "invalid credentials")))
    renderPage()

    await userEvent.type(screen.getByLabelText("Email"), "a@b.com")
    await userEvent.type(screen.getByLabelText("Password"), "password123")
    await userEvent.click(screen.getByRole("button", { name: "Log in" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Couldn't log in")
    expect(alert).toHaveTextContent("invalid credentials")
  })
})
