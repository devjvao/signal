import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

function renderTabs() {
  return render(
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">Tab A</TabsTrigger>
        <TabsTrigger value="b">Tab B</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Content A</TabsContent>
      <TabsContent value="b">Content B</TabsContent>
    </Tabs>
  )
}

describe("Tabs", () => {
  it("shows the default tab's content", () => {
    renderTabs()
    expect(screen.getByText("Content A")).toBeInTheDocument()
    expect(screen.queryByText("Content B")).not.toBeInTheDocument()
  })

  it("switches content when a different tab is clicked", async () => {
    renderTabs()
    await userEvent.click(screen.getByText("Tab B"))
    expect(screen.getByText("Content B")).toBeInTheDocument()
    expect(screen.queryByText("Content A")).not.toBeInTheDocument()
  })
})