import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { SortSelect } from "./sort-select"

const options = [
  { value: "newest", label: "Newest" },
  { value: "active", label: "Most active" },
]

describe("SortSelect", () => {
  it("renders a combobox showing the current value's label", () => {
    render(<SortSelect value="newest" onChange={vi.fn()} options={options} />)
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveTextContent("Newest")
  })

  it("calls onChange with the selected option's value", async () => {
    const onChange = vi.fn()
    render(<SortSelect value="newest" onChange={onChange} options={options} />)

    await userEvent.click(screen.getByRole("combobox", { name: "Sort" }))
    await userEvent.click(await screen.findByText("Most active"))

    expect(onChange).toHaveBeenCalledWith("active")
  })

  it("supports a custom accessible label", () => {
    render(<SortSelect value="newest" onChange={vi.fn()} options={options} label="Sort feature requests" />)
    expect(screen.getByRole("combobox", { name: "Sort feature requests" })).toBeInTheDocument()
  })
})