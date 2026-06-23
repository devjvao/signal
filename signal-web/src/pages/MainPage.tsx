import { useState } from "react"

import { AppHeader } from "@/components/layout/AppHeader"
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog"
import { ProjectList } from "@/components/projects/ProjectList"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/search-input"
import { SortSelect } from "@/components/ui/sort-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const projectSortOptions = [
  { value: "newest", label: "Newest" },
  { value: "active", label: "Most active" },
]

export default function MainPage() {
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState("active")

  return (
    <div className="flex min-h-screen flex-col bg-muted/50 dark:bg-background">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-xs uppercase tracking-widest text-primary">Browse &amp; build</span>
            <h1 className="font-display text-4xl font-extrabold tracking-tight">Projects</h1>
          </div>
          <ProjectFormDialog trigger={<Button>+ New project</Button>} />
        </div>
        <Tabs defaultValue="all">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="rounded-lg bg-muted p-1">
              <TabsTrigger value="all" className="rounded-md">
                All projects
              </TabsTrigger>
              <TabsTrigger value="mine" className="rounded-md">
                My projects
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-3">
              <div className="w-full sm:w-64">
                <SearchInput value={search} onChange={setSearch} placeholder="Search projects..." />
              </div>
              <SortSelect value={sort} onChange={setSort} options={projectSortOptions} />
            </div>
          </div>
          <TabsContent value="all" tabIndex={-1} className="mt-6">
            <ProjectList scope="all" search={search} sort={sort as "newest" | "active"} />
          </TabsContent>
          <TabsContent value="mine" tabIndex={-1} className="mt-6">
            <ProjectList scope="mine" search={search} sort={sort as "newest" | "active"} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
