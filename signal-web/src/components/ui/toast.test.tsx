import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Toast } from "./toast"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("Toast", () => {
  it("renders the message", () => {
    render(<Toast title="Status updated" onDismiss={vi.fn()} />)
    expect(screen.getByRole("status")).toHaveTextContent("Status updated")
  })

  it("renders an alert with a description for the error variant", () => {
    render(<Toast title="Couldn't update project" description="name is required" variant="error" onDismiss={vi.fn()} />)
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Couldn't update project")
    expect(alert).toHaveTextContent("name is required")
  })

  it("does not call onDismiss before the duration elapses", () => {
    const onDismiss = vi.fn()
    render(<Toast title="Status updated" onDismiss={onDismiss} />)
    vi.advanceTimersByTime(2999)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("calls onDismiss after the default 3000ms duration", () => {
    const onDismiss = vi.fn()
    render(<Toast title="Status updated" onDismiss={onDismiss} />)
    vi.advanceTimersByTime(3000)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it("respects a custom durationMs", () => {
    const onDismiss = vi.fn()
    render(<Toast title="Status updated" onDismiss={onDismiss} durationMs={1000} />)
    vi.advanceTimersByTime(999)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})