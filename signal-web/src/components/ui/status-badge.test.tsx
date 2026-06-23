import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { StatusBadge, statusLabels, statusOptions } from "./status-badge"

describe("statusLabels and statusOptions", () => {
  it("covers all 5 statuses", () => {
    expect(statusLabels).toEqual({
      open: "open",
      planned: "planned",
      in_progress: "in progress",
      completed: "completed",
      rejected: "rejected",
    })
    expect(statusOptions).toHaveLength(5)
    expect(statusOptions[0]).toEqual({ value: "open", label: "open" })
  })
})

describe("StatusBadge", () => {
  it("renders a plain pill with the status label by default", () => {
    render(<StatusBadge status="open" />)
    expect(screen.getByText("open")).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
  })

  it("renders an editable dropdown when editable is true", () => {
    render(<StatusBadge status="open" editable onStatusChange={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument()
  })

  it("calls onStatusChange with the newly selected value", async () => {
    const onStatusChange = vi.fn()
    render(<StatusBadge status="open" editable onStatusChange={onStatusChange} />)

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("Planned"))

    expect(onStatusChange).toHaveBeenCalledWith("planned")
  })

  it("disables the dropdown when disabled is true", () => {
    render(<StatusBadge status="open" editable onStatusChange={vi.fn()} disabled />)
    expect(screen.getByRole("combobox", { name: "Status" })).toBeDisabled()
  })
})