import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"

describe("Select", () => {
  it("calls onValueChange when an item is selected", async () => {
    const onValueChange = vi.fn()
    render(
      <Select value="open" onValueChange={onValueChange}>
        <SelectTrigger aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">open</SelectItem>
          <SelectItem value="planned">planned</SelectItem>
        </SelectContent>
      </Select>
    )

    await userEvent.click(screen.getByRole("combobox"))
    await userEvent.click(await screen.findByText("planned"))

    expect(onValueChange).toHaveBeenCalledWith("planned")
  })
})
