import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SearchInput } from "./search-input"

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("SearchInput", () => {
  it("does not call onChange immediately while typing", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
    render(<SearchInput value="" onChange={onChange} />)

    await user.type(screen.getByRole("searchbox"), "signal")

    expect(onChange).not.toHaveBeenCalled()
  })

  it("calls onChange with the final value 300ms after the last keystroke", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
    render(<SearchInput value="" onChange={onChange} />)

    await user.type(screen.getByRole("searchbox"), "signal")
    vi.advanceTimersByTime(300)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("signal")
  })

  it("resets its draft when the value prop changes externally", () => {
    const { rerender } = render(<SearchInput value="" onChange={vi.fn()} />)
    rerender(<SearchInput value="reset" onChange={vi.fn()} />)
    expect(screen.getByRole("searchbox")).toHaveValue("reset")
  })
})