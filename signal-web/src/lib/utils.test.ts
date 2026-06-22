import { describe, expect, it } from "vitest"

import { cn } from "./utils"

describe("cn", () => {
  it("joins multiple class names", () => {
    expect(cn("a", "b")).toBe("a b")
  })

  it("lets a later conflicting tailwind class win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4")
  })

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b")
  })
})
