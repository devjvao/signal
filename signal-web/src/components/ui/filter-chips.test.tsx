import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { FilterChips } from "./filter-chips"

const options = [
  { value: "open", label: "Open" },
  { value: "planned", label: "Planned" },
]

describe("FilterChips", () => {
  it("renders an All chip plus one chip per option", () => {
    render(<FilterChips value={null} onChange={vi.fn()} options={options} />)
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Planned" })).toBeInTheDocument()
  })

  it("marks the All chip as pressed when value is null", () => {
    render(<FilterChips value={null} onChange={vi.fn()} options={options} />)
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "false")
  })

  it("marks the matching option chip as pressed", () => {
    render(<FilterChips value="open" onChange={vi.fn()} options={options} />)
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true")
  })

  it("calls onChange with the option's value when clicked, and null when All is clicked", async () => {
    const onChange = vi.fn()
    render(<FilterChips value="open" onChange={onChange} options={options} />)

    await userEvent.click(screen.getByRole("button", { name: "Planned" }))
    expect(onChange).toHaveBeenLastCalledWith("planned")

    await userEvent.click(screen.getByRole("button", { name: "All" }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})