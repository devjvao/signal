import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Alert } from "./alert"

describe("Alert", () => {
  it("renders the message inside a role=alert region", () => {
    render(<Alert>Something went wrong</Alert>)
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong")
  })

  it("uses the destructive styling", () => {
    render(<Alert>Nope</Alert>)
    expect(screen.getByRole("alert").className).toContain("text-destructive")
  })

  it("merges a custom className", () => {
    render(<Alert className="mt-4">Nope</Alert>)
    expect(screen.getByRole("alert").className).toContain("mt-4")
  })
})
