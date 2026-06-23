import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ThemeToggle } from "./theme-toggle"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove("dark")
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ThemeToggle", () => {
  it("defaults to light when there is no stored preference and the system prefers light", () => {
    render(<ThemeToggle />)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument()
  })

  it("defaults to dark when the system prefers dark and nothing is stored", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }))

    render(<ThemeToggle />)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("respects a stored preference over the system preference", () => {
    localStorage.setItem("signal_theme", "dark")
    render(<ThemeToggle />)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("toggles the dark class and persists the choice when clicked", async () => {
    render(<ThemeToggle />)

    await userEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }))

    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(localStorage.getItem("signal_theme")).toBe("dark")
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Switch to light theme" }))

    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(localStorage.getItem("signal_theme")).toBe("light")
  })
})