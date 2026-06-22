import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog"

describe("Dialog", () => {
  it("opens content when the trigger is clicked", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirm</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    expect(screen.queryByText("Confirm")).not.toBeInTheDocument()

    await userEvent.click(screen.getByText("Open"))

    expect(screen.getByText("Confirm")).toBeInTheDocument()
  })
})
