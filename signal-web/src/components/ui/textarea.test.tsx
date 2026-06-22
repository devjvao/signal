import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Textarea } from "./textarea"

describe("Textarea", () => {
  it("renders a textarea and forwards props", () => {
    render(<Textarea aria-label="description" placeholder="Description" />)
    const textarea = screen.getByLabelText("description")
    expect(textarea.tagName).toBe("TEXTAREA")
    expect(textarea).toHaveAttribute("placeholder", "Description")
  })
})
