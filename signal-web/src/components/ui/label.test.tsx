import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Label } from "./label"

describe("Label", () => {
  it("renders its children and an htmlFor attribute", () => {
    render(<Label htmlFor="email">Email</Label>)
    const label = screen.getByText("Email")
    expect(label).toBeInTheDocument()
    expect(label).toHaveAttribute("for", "email")
  })
})
