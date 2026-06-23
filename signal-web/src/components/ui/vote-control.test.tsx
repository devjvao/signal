import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { VoteControl } from "./vote-control"

describe("VoteControl", () => {
  it("renders a clickable upvote button when votable", async () => {
    const onClick = vi.fn()
    render(<VoteControl count={3} state="votable" onClick={onClick} />)

    const button = screen.getByRole("button", { name: "Upvote" })
    expect(button).toHaveTextContent("3")
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("renders a filled button labelled to remove the vote when already voted", () => {
    render(<VoteControl count={4} state="voted" onClick={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Remove upvote" })).toHaveTextContent("4")
  })

  it("renders a non-interactive YOUR REQUEST control when state is own", () => {
    render(<VoteControl count={2} state="own" />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText(/your request/i)).toBeInTheDocument()
  })

  it("disables the button when disabled is true", () => {
    render(<VoteControl count={1} state="votable" onClick={vi.fn()} disabled />)
    expect(screen.getByRole("button", { name: "Upvote" })).toBeDisabled()
  })
})
