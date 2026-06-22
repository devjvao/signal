import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Input } from "./input"

describe("Input", () => {
  it("renders an input and forwards props", () => {
    render(<Input aria-label="email" placeholder="Email" />)
    const input = screen.getByLabelText("email")
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute("placeholder", "Email")
  })
})
