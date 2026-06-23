import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ToastProvider, useToast } from "./ToastContext"

function Trigger({ variant }: { variant?: "success" | "error" }) {
  const { showToast } = useToast()
  return <button onClick={() => showToast({ variant, title: "Saved", description: "done" })}>fire</button>
}

describe("ToastProvider / useToast", () => {
  it("shows a toast when showToast is called", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    )
    expect(screen.queryByText("Saved")).not.toBeInTheDocument()
    await userEvent.click(screen.getByText("fire"))
    expect(screen.getByText("Saved")).toBeInTheDocument()
    expect(screen.getByText("done")).toBeInTheDocument()
  })

  it("renders the error variant as role=alert", async () => {
    render(
      <ToastProvider>
        <Trigger variant="error" />
      </ToastProvider>
    )
    await userEvent.click(screen.getByText("fire"))
    expect(screen.getByRole("alert")).toHaveTextContent("Saved")
  })

  it("throws when useToast is used outside a provider", () => {
    function Orphan() {
      useToast()
      return null
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Orphan />)).toThrow("useToast must be used within a ToastProvider")
    spy.mockRestore()
  })
})
