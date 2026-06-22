# Feature Requests Web Implementation Plan (signal-web)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the feature-request UI in `signal-web`: a per-project page listing feature requests
by upvotes with infinite scroll, upvote/edit/delete actions on each card, and a create/edit form
page — all against the frozen `contracts/feature-requests-api.md`.

**Architecture:** Mirrors the existing project UI. New API client functions in `lib/api.ts`;
`ProjectPage` fetches the project and renders `FeatureRequestList` (TanStack `useInfiniteQuery` +
`IntersectionObserver`, same pattern as `ProjectList`); `FeatureRequestCard` shows actions gated by
the viewer's relationship to the request and project; `FeatureRequestFormPage` mirrors
`ProjectFormPage`. The existing `ProjectCard` becomes clickable to open the project page.

**Tech Stack:** React 19, react-router-dom 7, TanStack Query 5, Vitest + Testing Library, Tailwind,
Radix dialog. Tests mock `@/lib/api` (and `@/context/AuthContext`) exactly like the existing
`ProjectCard.test.tsx` / `ProjectList.test.tsx` / `ProjectFormPage.test.tsx`.

## Global Constraints

- All API JSON is camelCase; the client types must match `contracts/entities.md` (`FeatureRequest`)
  field-for-field.
- Status values: `open`, `planned`, `in_progress`, `completed`, `rejected`.
- Status is editable by the **project owner only** (Task 7), via a `Select` that auto-saves against
  `PUT /feature-requests/:id/status`. All other viewers see the existing read-only badge.
- Auth: `useAuth()` provides `user` (`user.id` is the current user's id). Routes are wrapped in
  `ProtectedRoute`.
- Run tests with `cd signal-web && npm test` (Vitest, jsdom). Lint with `npm run lint`.
- Query-key convention: the feature-request list for a project is keyed
  `["featureRequests", projectId]`. Vote/edit/delete mutations invalidate that key.

---

### Task 1: API client — types and functions

**Files:**
- Modify: `signal-web/src/lib/api.ts`
- Test: `signal-web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: existing `request<T>` helper, `Project` type.
- Produces (used by all later tasks):
  - `interface FeatureRequest { id; projectId; title; description: string | null; status: string; createdBy; createdByName; upvoteCount: number; viewerHasVoted: boolean; createdAt }`
  - `interface FeatureRequestsPage { featureRequests: FeatureRequest[]; nextCursor: string | null }`
  - `interface FeatureRequestInput { title: string; description?: string }`
  - `getProject(id): Promise<{ project: Project }>`
  - `listFeatureRequests(projectId, { cursor?, limit? }): Promise<FeatureRequestsPage>`
  - `createFeatureRequest(projectId, input): Promise<{ featureRequest: FeatureRequest }>`
  - `updateFeatureRequest(id, input): Promise<{ featureRequest: FeatureRequest }>`
  - `deleteFeatureRequest(id): Promise<void>`
  - `voteFeatureRequest(id): Promise<{ featureRequest: FeatureRequest }>`
  - `unvoteFeatureRequest(id): Promise<{ featureRequest: FeatureRequest }>`

- [ ] **Step 1: Write failing tests** — append to `api.test.ts` (and add the new names to the top import from `./api`):

```ts
describe("getProject", () => {
  it("requests /projects/:id and returns the project", async () => {
    const project = { id: "1", name: "Signal", slug: "signal", description: null, ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { project }))

    const result = await getProject("1")

    expect(result.project).toEqual(project)
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/projects/1")
  })
})

describe("listFeatureRequests", () => {
  it("requests the project's feature requests with cursor and limit", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { featureRequests: [], nextCursor: null }))

    await listFeatureRequests("p1", { cursor: "abc", limit: 5 })

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/projects/p1/feature-requests")
    expect(url).toContain("cursor=abc")
    expect(url).toContain("limit=5")
  })
})

describe("createFeatureRequest", () => {
  it("posts to the project's feature-requests collection", async () => {
    const featureRequest = { id: "f1", projectId: "p1", title: "Dark mode", description: null, status: "open", createdBy: "u1", createdByName: "Ada", upvoteCount: 0, viewerHasVoted: false, createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(201, { featureRequest }))

    const result = await createFeatureRequest("p1", { title: "Dark mode" })

    expect(result.featureRequest).toEqual(featureRequest)
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/projects/p1/feature-requests")
    expect(options?.method).toBe("POST")
    expect(JSON.parse(options?.body as string)).toEqual({ title: "Dark mode" })
  })
})

describe("updateFeatureRequest", () => {
  it("puts to /feature-requests/:id", async () => {
    const featureRequest = { id: "f1", projectId: "p1", title: "New", description: null, status: "open", createdBy: "u1", createdByName: "Ada", upvoteCount: 0, viewerHasVoted: false, createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { featureRequest }))

    await updateFeatureRequest("f1", { title: "New" })

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/feature-requests/f1")
    expect(options?.method).toBe("PUT")
  })
})

describe("deleteFeatureRequest", () => {
  it("sends DELETE to /feature-requests/:id", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(204, undefined))

    await deleteFeatureRequest("f1")

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/feature-requests/f1")
    expect(options?.method).toBe("DELETE")
  })
})

describe("vote and unvote", () => {
  it("posts to the vote subresource", async () => {
    const featureRequest = { id: "f1", projectId: "p1", title: "x", description: null, status: "open", createdBy: "u1", createdByName: "Ada", upvoteCount: 1, viewerHasVoted: true, createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { featureRequest }))

    const result = await voteFeatureRequest("f1")

    expect(result.featureRequest.viewerHasVoted).toBe(true)
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/feature-requests/f1/vote")
    expect(options?.method).toBe("POST")
  })

  it("sends DELETE to the vote subresource", async () => {
    const featureRequest = { id: "f1", projectId: "p1", title: "x", description: null, status: "open", createdBy: "u1", createdByName: "Ada", upvoteCount: 0, viewerHasVoted: false, createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { featureRequest }))

    await unvoteFeatureRequest("f1")

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/feature-requests/f1/vote")
    expect(options?.method).toBe("DELETE")
  })
})
```

Update the import line at the top of `api.test.ts` to include:
`createFeatureRequest, deleteFeatureRequest, getProject, listFeatureRequests, unvoteFeatureRequest, updateFeatureRequest, voteFeatureRequest`.

- [ ] **Step 2: Run to verify failure**

Run: `cd signal-web && npm test -- src/lib/api.test.ts`
Expected: FAIL — these functions are not exported yet.

- [ ] **Step 3: Implement** — append to `lib/api.ts`:

```ts
export function getProject(id: string): Promise<{ project: Project }> {
  return request<{ project: Project }>(`/projects/${id}`)
}

export interface FeatureRequest {
  id: string
  projectId: string
  title: string
  description: string | null
  status: string
  createdBy: string
  createdByName: string
  upvoteCount: number
  viewerHasVoted: boolean
  createdAt: string
}

export interface FeatureRequestsPage {
  featureRequests: FeatureRequest[]
  nextCursor: string | null
}

interface FeatureRequestsPageParams {
  cursor?: string
  limit?: number
}

function featureRequestsQueryString(params: FeatureRequestsPageParams): string {
  const search = new URLSearchParams()
  if (params.cursor) search.set("cursor", params.cursor)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  const query = search.toString()
  return query ? `?${query}` : ""
}

export function listFeatureRequests(
  projectId: string,
  params: FeatureRequestsPageParams = {}
): Promise<FeatureRequestsPage> {
  return request<FeatureRequestsPage>(
    `/projects/${projectId}/feature-requests${featureRequestsQueryString(params)}`
  )
}

export interface FeatureRequestInput {
  title: string
  description?: string
}

export function createFeatureRequest(
  projectId: string,
  input: FeatureRequestInput
): Promise<{ featureRequest: FeatureRequest }> {
  return request<{ featureRequest: FeatureRequest }>(`/projects/${projectId}/feature-requests`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function updateFeatureRequest(
  id: string,
  input: FeatureRequestInput
): Promise<{ featureRequest: FeatureRequest }> {
  return request<{ featureRequest: FeatureRequest }>(`/feature-requests/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export function deleteFeatureRequest(id: string): Promise<void> {
  return request<void>(`/feature-requests/${id}`, { method: "DELETE" })
}

export function voteFeatureRequest(id: string): Promise<{ featureRequest: FeatureRequest }> {
  return request<{ featureRequest: FeatureRequest }>(`/feature-requests/${id}/vote`, {
    method: "POST",
  })
}

export function unvoteFeatureRequest(id: string): Promise<{ featureRequest: FeatureRequest }> {
  return request<{ featureRequest: FeatureRequest }>(`/feature-requests/${id}/vote`, {
    method: "DELETE",
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd signal-web && npm test -- src/lib/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/lib/api.ts signal-web/src/lib/api.test.ts
git commit -m "feat(web): add feature request and project api client functions"
```

---

### Task 2: FeatureRequestCard component

**Files:**
- Create: `signal-web/src/components/feature-requests/FeatureRequestCard.tsx`
- Create: `signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.tsx`
- Test: `signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `FeatureRequest` type, vote/unvote/delete API functions, `Button`, dialog UI.
- Produces:
  - `DeleteFeatureRequestDialog({ featureRequest, trigger })`
  - `FeatureRequestCard({ featureRequest, projectOwnerId })` where action visibility is:
    - upvote control: shown only when `user.id !== featureRequest.createdBy`; pressed state from `viewerHasVoted`
    - Edit: shown only when `user.id === createdBy && upvoteCount === 0`; navigates to `/feature-requests/:id/edit` with `state: { featureRequest }`
    - Delete: shown when `user.id === createdBy || user.id === projectOwnerId`

- [ ] **Step 1: Write `DeleteFeatureRequestDialog.tsx`** (mirrors `DeleteProjectDialog`):

```tsx
import { useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ApiError, deleteFeatureRequest } from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"

interface DeleteFeatureRequestDialogProps {
  featureRequest: FeatureRequest
  trigger: ReactNode
}

export function DeleteFeatureRequestDialog({ featureRequest, trigger }: DeleteFeatureRequestDialogProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const queryClient = useQueryClient()

  async function handleConfirm() {
    setError(null)
    setIsDeleting(true)
    try {
      await deleteFeatureRequest(featureRequest.id)
      await queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] })
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle>Delete feature request</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete &quot;{featureRequest.title}&quot;? This action cannot be undone.
        </DialogDescription>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Write failing tests** in `FeatureRequestCard.test.tsx` (mirrors `ProjectCard.test.tsx` mocking style):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import * as api from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"
import { FeatureRequestCard } from "./FeatureRequestCard"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

function mockUser(id: string) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "authenticated",
    user: { id, name: "User", email: "user@example.com", createdAt: "2026-06-21T00:00:00Z" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  })
}

const base: FeatureRequest = {
  id: "f1",
  projectId: "p1",
  title: "Dark mode",
  description: "Please add it",
  status: "open",
  createdBy: "author-1",
  createdByName: "Ada Lovelace",
  upvoteCount: 0,
  viewerHasVoted: false,
  createdAt: "2026-06-21T00:00:00Z",
}

function renderCard(featureRequest: FeatureRequest, projectOwnerId = "owner-1") {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FeatureRequestCard featureRequest={featureRequest} projectOwnerId={projectOwnerId} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("FeatureRequestCard", () => {
  it("renders title, status and upvote count", () => {
    mockUser("viewer-1")
    renderCard({ ...base, upvoteCount: 3 })
    expect(screen.getByText("Dark mode")).toBeInTheDocument()
    expect(screen.getByText("open")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
  })

  it("hides the upvote button for the author", () => {
    mockUser("author-1")
    renderCard(base)
    expect(screen.queryByRole("button", { name: /upvote/i })).not.toBeInTheDocument()
  })

  it("shows Edit only for the author when there are no upvotes", () => {
    mockUser("author-1")
    renderCard({ ...base, upvoteCount: 0 })
    expect(screen.getByText("Edit")).toBeInTheDocument()
  })

  it("hides Edit for the author once it has upvotes", () => {
    mockUser("author-1")
    renderCard({ ...base, upvoteCount: 2 })
    expect(screen.queryByText("Edit")).not.toBeInTheDocument()
  })

  it("shows Delete for the project owner who is not the author", () => {
    mockUser("owner-1")
    renderCard(base, "owner-1")
    expect(screen.getByText("Delete")).toBeInTheDocument()
    expect(screen.queryByText("Edit")).not.toBeInTheDocument()
  })

  it("hides Edit and Delete for an unrelated viewer", () => {
    mockUser("stranger")
    renderCard(base)
    expect(screen.queryByText("Edit")).not.toBeInTheDocument()
    expect(screen.queryByText("Delete")).not.toBeInTheDocument()
  })

  it("calls voteFeatureRequest when an eligible viewer upvotes", async () => {
    mockUser("viewer-1")
    vi.spyOn(api, "voteFeatureRequest").mockResolvedValue({ featureRequest: { ...base, upvoteCount: 1, viewerHasVoted: true } })
    renderCard(base)

    await userEvent.click(screen.getByRole("button", { name: /upvote/i }))
    expect(api.voteFeatureRequest).toHaveBeenCalledWith("f1")
  })

  it("calls unvoteFeatureRequest when the viewer has already voted", async () => {
    mockUser("viewer-1")
    vi.spyOn(api, "unvoteFeatureRequest").mockResolvedValue({ featureRequest: { ...base, viewerHasVoted: false } })
    renderCard({ ...base, viewerHasVoted: true, upvoteCount: 1 })

    await userEvent.click(screen.getByRole("button", { name: /upvote/i }))
    expect(api.unvoteFeatureRequest).toHaveBeenCalledWith("f1")
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `cd signal-web && npm test -- src/components/feature-requests/FeatureRequestCard.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 4: Implement `FeatureRequestCard.tsx`**:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { DeleteFeatureRequestDialog } from "@/components/feature-requests/DeleteFeatureRequestDialog"
import { useAuth } from "@/context/AuthContext"
import { unvoteFeatureRequest, voteFeatureRequest } from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"

interface FeatureRequestCardProps {
  featureRequest: FeatureRequest
  projectOwnerId: string
}

const statusLabels: Record<string, string> = {
  open: "open",
  planned: "planned",
  in_progress: "in progress",
  completed: "completed",
  rejected: "rejected",
}

export function FeatureRequestCard({ featureRequest, projectOwnerId }: FeatureRequestCardProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const isAuthor = user?.id === featureRequest.createdBy
  const isProjectOwner = user?.id === projectOwnerId
  const canUpvote = !isAuthor
  const canEdit = isAuthor && featureRequest.upvoteCount === 0
  const canDelete = isAuthor || isProjectOwner

  const voteMutation = useMutation({
    mutationFn: () =>
      featureRequest.viewerHasVoted
        ? unvoteFeatureRequest(featureRequest.id)
        : voteFeatureRequest(featureRequest.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] }),
  })

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        {canUpvote && (
          <Button
            type="button"
            variant={featureRequest.viewerHasVoted ? "default" : "outline"}
            size="sm"
            aria-label={featureRequest.viewerHasVoted ? "Remove upvote" : "Upvote"}
            disabled={voteMutation.isPending}
            onClick={() => voteMutation.mutate()}
            className="flex h-auto flex-col px-3 py-1"
          >
            <span aria-hidden>▲</span>
            <span>{featureRequest.upvoteCount}</span>
          </Button>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold">{featureRequest.title}</h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {statusLabels[featureRequest.status] ?? featureRequest.status}
            </span>
            {!canUpvote && (
              <span className="text-xs text-muted-foreground">{featureRequest.upvoteCount} upvotes</span>
            )}
          </div>
          {featureRequest.description && (
            <p className="mt-1 text-sm text-muted-foreground">{featureRequest.description}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{featureRequest.createdByName}</p>
          {(canEdit || canDelete) && (
            <div className="mt-3 flex gap-2">
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate(`/feature-requests/${featureRequest.id}/edit`, { state: { featureRequest } })
                  }
                >
                  Edit
                </Button>
              )}
              {canDelete && (
                <DeleteFeatureRequestDialog
                  featureRequest={featureRequest}
                  trigger={
                    <Button variant="destructive" size="sm">
                      Delete
                    </Button>
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

> Note: for the author (no upvote button) the count is still shown via the `{featureRequest.upvoteCount} upvotes`
> text, so the "renders ... upvote count" test (viewer-1, count 3) finds `3` inside the upvote button,
> and author-facing cards still display their count.

- [ ] **Step 5: Run to verify pass**

Run: `cd signal-web && npm test -- src/components/feature-requests/FeatureRequestCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add signal-web/src/components/feature-requests/FeatureRequestCard.tsx signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.tsx signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx
git commit -m "feat(web): add feature request card with upvote, edit, delete"
```

---

### Task 3: FeatureRequestList component

**Files:**
- Create: `signal-web/src/components/feature-requests/FeatureRequestList.tsx`
- Test: `signal-web/src/components/feature-requests/FeatureRequestList.test.tsx`

**Interfaces:**
- Consumes: `listFeatureRequests`, `FeatureRequestCard`.
- Produces: `FeatureRequestList({ projectId, projectOwnerId })` — infinite scroll keyed `["featureRequests", projectId]`.

- [ ] **Step 1: Write failing tests** in `FeatureRequestList.test.tsx` (mirrors `ProjectList.test.tsx`, including the `IntersectionObserver` mock):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import * as api from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"
import { FeatureRequestList } from "./FeatureRequestList"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

let intersectionCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null

class MockIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    intersectionCallback = callback
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  intersectionCallback = null
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "authenticated",
    user: { id: "viewer-1", name: "Viewer", email: "viewer@example.com", createdAt: "2026-06-21T00:00:00Z" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

function featureRequest(id: string): FeatureRequest {
  return {
    id,
    projectId: "p1",
    title: `Request ${id}`,
    description: null,
    status: "open",
    createdBy: "author-1",
    createdByName: "Ada Lovelace",
    upvoteCount: 0,
    viewerHasVoted: false,
    createdAt: "2026-06-21T00:00:00Z",
  }
}

describe("FeatureRequestList", () => {
  it("renders the first page", async () => {
    vi.spyOn(api, "listFeatureRequests").mockResolvedValue({ featureRequests: [featureRequest("1")], nextCursor: null })

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" />)

    expect(await screen.findByText("Request 1")).toBeInTheDocument()
    expect(api.listFeatureRequests).toHaveBeenCalledWith("p1", { cursor: undefined })
  })

  it("shows an empty state when there are none", async () => {
    vi.spyOn(api, "listFeatureRequests").mockResolvedValue({ featureRequests: [], nextCursor: null })

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" />)

    expect(await screen.findByText("No feature requests yet.")).toBeInTheDocument()
  })

  it("fetches the next page when the sentinel intersects", async () => {
    const spy = vi.spyOn(api, "listFeatureRequests")
    spy.mockResolvedValueOnce({ featureRequests: [featureRequest("1")], nextCursor: "cursor-1" })
    spy.mockResolvedValueOnce({ featureRequests: [featureRequest("2")], nextCursor: null })

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" />)

    expect(await screen.findByText("Request 1")).toBeInTheDocument()
    intersectionCallback?.([{ isIntersecting: true }])
    expect(await screen.findByText("Request 2")).toBeInTheDocument()
    expect(spy).toHaveBeenLastCalledWith("p1", { cursor: "cursor-1" })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd signal-web && npm test -- src/components/feature-requests/FeatureRequestList.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `FeatureRequestList.tsx`** (mirrors `ProjectList.tsx`):

```tsx
import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { listFeatureRequests } from "@/lib/api"
import { FeatureRequestCard } from "@/components/feature-requests/FeatureRequestCard"

interface FeatureRequestListProps {
  projectId: string
  projectOwnerId: string
}

export function FeatureRequestList({ projectId, projectOwnerId }: FeatureRequestListProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["featureRequests", projectId],
    queryFn: ({ pageParam }) => listFeatureRequests(projectId, { cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading feature requests...</p>
  }

  const featureRequests = data?.pages.flatMap((page) => page.featureRequests) ?? []

  if (featureRequests.length === 0) {
    return <p className="text-sm text-muted-foreground">No feature requests yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {featureRequests.map((fr) => (
        <FeatureRequestCard key={fr.id} featureRequest={fr} projectOwnerId={projectOwnerId} />
      ))}
      <div ref={sentinelRef} />
      {isFetchingNextPage && <p className="text-sm text-muted-foreground">Loading more...</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd signal-web && npm test -- src/components/feature-requests/FeatureRequestList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/feature-requests/FeatureRequestList.tsx signal-web/src/components/feature-requests/FeatureRequestList.test.tsx
git commit -m "feat(web): add feature request list with infinite scroll"
```

---

### Task 4: ProjectPage

**Files:**
- Create: `signal-web/src/pages/ProjectPage.tsx`
- Test: `signal-web/src/pages/ProjectPage.test.tsx`

**Interfaces:**
- Consumes: `getProject`, `FeatureRequestList`, `useParams`, `useNavigate`.
- Produces: default-exported `ProjectPage` rendered at `/projects/:id`.

- [ ] **Step 1: Write failing tests** in `ProjectPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import ProjectPage from "./ProjectPage"

vi.mock("@/components/feature-requests/FeatureRequestList", () => ({
  FeatureRequestList: ({ projectId }: { projectId: string }) => <div>FeatureRequestList:{projectId}</div>,
}))

const project = { id: "p1", name: "Signal", slug: "signal", description: "A product", ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" }

function renderAt(path: string) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/projects/:id/feature-requests/new" element={<div>new feature request page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("ProjectPage", () => {
  it("renders the project and its feature request list", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue({ project })

    renderAt("/projects/p1")

    expect(await screen.findByText("Signal")).toBeInTheDocument()
    expect(screen.getByText("FeatureRequestList:p1")).toBeInTheDocument()
  })

  it("navigates to the new feature request page", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue({ project })

    renderAt("/projects/p1")

    await userEvent.click(await screen.findByText("New feature request"))
    expect(await screen.findByText("new feature request page")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd signal-web && npm test -- src/pages/ProjectPage.test.tsx`
Expected: FAIL — page does not exist.

- [ ] **Step 3: Implement `ProjectPage.tsx`**:

```tsx
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"

import { FeatureRequestList } from "@/components/feature-requests/FeatureRequestList"
import { Button } from "@/components/ui/button"
import { getProject } from "@/lib/api"

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading, isError } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id as string),
    enabled: Boolean(id),
  })

  if (isLoading) {
    return <p className="px-6 py-8 text-sm text-muted-foreground">Loading project...</p>
  }

  if (isError || !data) {
    return <p className="px-6 py-8 text-sm text-destructive">Project not found.</p>
  }

  const project = data.project

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
        <div>
          <Button variant="link" className="h-auto px-0" onClick={() => navigate("/")}>
            ← Back to projects
          </Button>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex justify-end">
          <Button onClick={() => navigate(`/projects/${project.id}/feature-requests/new`)}>
            New feature request
          </Button>
        </div>
        <FeatureRequestList projectId={project.id} projectOwnerId={project.ownerId} />
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd signal-web && npm test -- src/pages/ProjectPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/pages/ProjectPage.tsx signal-web/src/pages/ProjectPage.test.tsx
git commit -m "feat(web): add project page with feature request list"
```

---

### Task 5: FeatureRequestFormPage

**Files:**
- Create: `signal-web/src/pages/FeatureRequestFormPage.tsx`
- Test: `signal-web/src/pages/FeatureRequestFormPage.test.tsx`

**Interfaces:**
- Consumes: `createFeatureRequest`, `updateFeatureRequest`, `FeatureRequest`, router hooks.
- Produces: default-exported `FeatureRequestFormPage` serving two routes:
  - create: `/projects/:projectId/feature-requests/new` (param `projectId` present)
  - edit: `/feature-requests/:id/edit` (param `id` present; editing record from `location.state.featureRequest`)
  - Cancel and post-submit both navigate to `/projects/:projectId`.

- [ ] **Step 1: Write failing tests** in `FeatureRequestFormPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"
import FeatureRequestFormPage from "./FeatureRequestFormPage"

function renderAt(initialEntries: Array<string | { pathname: string; state?: unknown }>) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/projects/:id" element={<div>project page</div>} />
          <Route path="/projects/:projectId/feature-requests/new" element={<FeatureRequestFormPage />} />
          <Route path="/feature-requests/:id/edit" element={<FeatureRequestFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const existing: FeatureRequest = {
  id: "f1",
  projectId: "p1",
  title: "Dark mode",
  description: "old",
  status: "open",
  createdBy: "u1",
  createdByName: "Ada",
  upvoteCount: 0,
  viewerHasVoted: false,
  createdAt: "2026-06-21T00:00:00Z",
}

describe("FeatureRequestFormPage", () => {
  it("creates a feature request and redirects to the project page", async () => {
    vi.spyOn(api, "createFeatureRequest").mockResolvedValue({ featureRequest: existing })

    renderAt(["/projects/p1/feature-requests/new"])

    expect(screen.getByText("New feature request")).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Title"), "Dark mode")
    await userEvent.click(screen.getByText("Save"))

    expect(api.createFeatureRequest).toHaveBeenCalledWith("p1", { title: "Dark mode", description: undefined })
    expect(await screen.findByText("project page")).toBeInTheDocument()
  })

  it("requires a title before submitting", async () => {
    const spy = vi.spyOn(api, "createFeatureRequest")
    renderAt(["/projects/p1/feature-requests/new"])

    await userEvent.click(screen.getByText("Save"))
    expect(spy).not.toHaveBeenCalled()
  })

  it("prefills and updates an existing feature request", async () => {
    vi.spyOn(api, "updateFeatureRequest").mockResolvedValue({ featureRequest: { ...existing, title: "Dark theme" } })

    renderAt([{ pathname: "/feature-requests/f1/edit", state: { featureRequest: existing } }])

    expect(screen.getByText("Edit feature request")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Dark mode")).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText("Title"))
    await userEvent.type(screen.getByLabelText("Title"), "Dark theme")
    await userEvent.click(screen.getByText("Save"))

    expect(api.updateFeatureRequest).toHaveBeenCalledWith("f1", { title: "Dark theme", description: "old" })
    expect(await screen.findByText("project page")).toBeInTheDocument()
  })

  it("redirects to the project when Cancel is clicked", async () => {
    renderAt(["/projects/p1/feature-requests/new"])
    await userEvent.click(screen.getByText("Cancel"))
    expect(await screen.findByText("project page")).toBeInTheDocument()
  })

  it("redirects home when edit state is missing", () => {
    renderAt(["/feature-requests/f1/edit"])
    // No state -> redirect to "/" which is not registered here, so the form is not shown.
    expect(screen.queryByText("Edit feature request")).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd signal-web && npm test -- src/pages/FeatureRequestFormPage.test.tsx`
Expected: FAIL — page does not exist.

- [ ] **Step 3: Implement `FeatureRequestFormPage.tsx`** (mirrors `ProjectFormPage.tsx`; note the `required` attribute on the Title input gives native validation that blocks submit when empty):

```tsx
import { useState } from "react"
import type { FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, createFeatureRequest, updateFeatureRequest } from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"

export default function FeatureRequestFormPage() {
  const { projectId: projectIdParam, id: featureRequestId } = useParams<{ projectId?: string; id?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const isEditMode = Boolean(featureRequestId)
  const editing = (location.state as { featureRequest?: FeatureRequest } | null)?.featureRequest ?? null
  const projectId = isEditMode ? editing?.projectId : projectIdParam

  const [title, setTitle] = useState(editing?.title ?? "")
  const [description, setDescription] = useState(editing?.description ?? "")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isEditMode && !editing) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const input = { title, description: description || undefined }
      if (isEditMode && featureRequestId) {
        await updateFeatureRequest(featureRequestId, input)
      } else if (projectId) {
        await createFeatureRequest(projectId, input)
      }
      await queryClient.invalidateQueries({ queryKey: ["featureRequests", projectId] })
      navigate(`/projects/${projectId}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">
        {isEditMode ? "Edit feature request" : "New feature request"}
      </h1>
      <form className="flex w-full max-w-sm flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" required value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(`/projects/${projectId}`)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd signal-web && npm test -- src/pages/FeatureRequestFormPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/pages/FeatureRequestFormPage.tsx signal-web/src/pages/FeatureRequestFormPage.test.tsx
git commit -m "feat(web): add feature request create and edit form page"
```

---

### Task 6: Routing + clickable ProjectCard

**Files:**
- Modify: `signal-web/src/App.tsx`
- Modify: `signal-web/src/components/projects/ProjectCard.tsx`
- Modify: `signal-web/src/components/projects/ProjectCard.test.tsx`

**Interfaces:**
- Consumes: `ProjectPage`, `FeatureRequestFormPage`.
- Produces: routes `/projects/:id`, `/projects/:projectId/feature-requests/new`, `/feature-requests/:id/edit`; clickable project card.

- [ ] **Step 1: Add routes to `App.tsx`** — add imports and three `ProtectedRoute` routes:

```tsx
import FeatureRequestFormPage from "@/pages/FeatureRequestFormPage"
import ProjectPage from "@/pages/ProjectPage"
```

```tsx
      <Route
        path="/projects/:id"
        element={
          <ProtectedRoute>
            <ProjectPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId/feature-requests/new"
        element={
          <ProtectedRoute>
            <FeatureRequestFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/feature-requests/:id/edit"
        element={
          <ProtectedRoute>
            <FeatureRequestFormPage />
          </ProtectedRoute>
        }
      />
```

> Place `/projects/:id` after the existing `/projects/new` and `/projects/:id/edit` routes in the
> file. React-router ranks routes by specificity, not order, so the static `/projects/new` still
> wins over `/projects/:id` — but keeping declaration order tidy aids readability.

- [ ] **Step 2: Update `ProjectCard.test.tsx`** — add a navigation test. Insert into the existing `describe("ProjectCard", ...)`:

```tsx
  it("navigates to the project page when the card body is clicked", async () => {
    mockUser("someone-else")
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<ProjectCard project={project} />} />
            <Route path="/projects/:id" element={<div>project page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    await userEvent.click(screen.getByText("Signal"))
    expect(await screen.findByText("project page")).toBeInTheDocument()
  })
```

Add `Route, Routes` to the existing `react-router-dom` import in that test file.

- [ ] **Step 3: Run to verify the new test fails**

Run: `cd signal-web && npm test -- src/components/projects/ProjectCard.test.tsx`
Expected: FAIL — clicking the title does not navigate yet.

- [ ] **Step 4: Make `ProjectCard` clickable** — wrap the card so the body navigates and the action buttons don't. Replace the outer `<div>` and add `stopPropagation` to the action container:

```tsx
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/projects/${project.id}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          navigate(`/projects/${project.id}`)
        }
      }}
      className="cursor-pointer rounded-md border border-border bg-background p-4 text-left"
    >
      <h3 className="font-display text-lg font-semibold">{project.name}</h3>
      {project.description && (
        <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {project.ownerName} &middot; {createdAt}
      </p>
      {isOwner && (
        <div className="mt-3 flex gap-2" onClick={(event) => event.stopPropagation()}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/projects/${project.id}/edit`, { state: { project } })}
          >
            Edit
          </Button>
          <DeleteProjectDialog
            project={project}
            trigger={
              <Button variant="destructive" size="sm">
                Delete
              </Button>
            }
          />
        </div>
      )}
    </div>
  )
```

- [ ] **Step 5: Run the full web suite**

Run: `cd signal-web && npm test`
Expected: all test files PASS (existing project/auth tests unaffected; new feature-request tests green).

- [ ] **Step 6: Lint and type-check the build**

Run: `cd signal-web && npm run lint && npm run build`
Expected: no lint errors; `tsc -b && vite build` succeeds.

- [ ] **Step 7: Commit**

```bash
git add signal-web/src/App.tsx signal-web/src/components/projects/ProjectCard.tsx signal-web/src/components/projects/ProjectCard.test.tsx
git commit -m "feat(web): route to project page and make project cards clickable"
```

---

### Task 7: Status-editing UI for the project owner

**Files:**
- Modify: `signal-web/package.json` (new dependency `@radix-ui/react-select`)
- Modify: `signal-web/src/test/setup.ts`
- Create: `signal-web/src/components/ui/select.tsx`
- Create: `signal-web/src/components/ui/select.test.tsx`
- Modify: `signal-web/src/lib/api.ts`
- Modify: `signal-web/src/lib/api.test.ts`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestCard.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx`

**Interfaces:**
- Consumes: `@radix-ui/react-select`, `cn`, `ApiError`, `PUT /feature-requests/:id/status` contract.
- Produces:
  - `components/ui/select.tsx`: `Select`, `SelectValue`, `SelectTrigger`, `SelectContent`,
    `SelectItem` (shadcn-style Radix wrapper, mirrors `dialog.tsx`/`tabs.tsx`).
  - `lib/api.ts`: `updateFeatureRequestStatus(id: string, status: string): Promise<{ featureRequest: FeatureRequest }>`.
  - `FeatureRequestCard`: when `isProjectOwner`, renders the `Select` (current status preselected)
    instead of the read-only badge; auto-saves `onValueChange`; shows an inline error on failure.

- [ ] **Step 1: Install the new dependency**

Run: `cd signal-web && npm install @radix-ui/react-select`

- [ ] **Step 2: Add jsdom polyfills Radix Select needs** — append to `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest"

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
```

(Without these, Radix `Select`'s pointer-based item selection throws in jsdom — `Dialog`/`Tabs`
don't need them because they don't drive pointer capture during open.)

- [ ] **Step 3: Write failing test for `select.tsx`** in `select.test.tsx`:

```tsx
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
```

- [ ] **Step 4: Run to verify failure**

Run: `cd signal-web && npm test -- src/components/ui/select.test.tsx`
Expected: FAIL — `./select` does not exist.

- [ ] **Step 5: Implement `select.tsx`** (mirrors `tabs.tsx`'s Radix-wrapper style):

```tsx
import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex items-center justify-between gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground disabled:pointer-events-none disabled:opacity-50",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-3 w-3 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-background shadow-md",
        className
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground",
      className
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-2">
      <Check className="h-4 w-4" />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem }
```

- [ ] **Step 6: Run to verify pass**

Run: `cd signal-web && npm test -- src/components/ui/select.test.tsx`
Expected: PASS.

- [ ] **Step 7: Write failing test for `updateFeatureRequestStatus`** — append to `api.test.ts`
  (add `updateFeatureRequestStatus` to the top import from `./api`):

```ts
describe("updateFeatureRequestStatus", () => {
  it("puts the new status to /feature-requests/:id/status", async () => {
    const featureRequest = { id: "f1", projectId: "p1", title: "x", description: null, status: "planned", createdBy: "u1", createdByName: "Ada", upvoteCount: 0, viewerHasVoted: false, createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { featureRequest }))

    const result = await updateFeatureRequestStatus("f1", "planned")

    expect(result.featureRequest.status).toBe("planned")
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/feature-requests/f1/status")
    expect(options?.method).toBe("PUT")
    expect(JSON.parse(options?.body as string)).toEqual({ status: "planned" })
  })
})
```

- [ ] **Step 8: Run to verify failure**

Run: `cd signal-web && npm test -- src/lib/api.test.ts`
Expected: FAIL — `updateFeatureRequestStatus` is not exported yet.

- [ ] **Step 9: Implement** — append to `lib/api.ts`:

```ts
export function updateFeatureRequestStatus(
  id: string,
  status: string
): Promise<{ featureRequest: FeatureRequest }> {
  return request<{ featureRequest: FeatureRequest }>(`/feature-requests/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  })
}
```

- [ ] **Step 10: Run to verify pass**

Run: `cd signal-web && npm test -- src/lib/api.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add signal-web/package.json signal-web/package-lock.json signal-web/src/test/setup.ts signal-web/src/components/ui/select.tsx signal-web/src/components/ui/select.test.tsx signal-web/src/lib/api.ts signal-web/src/lib/api.test.ts
git commit -m "feat(web): add select ui component and feature request status api client function"
```

- [ ] **Step 12: Write failing tests** — append to `FeatureRequestCard.test.tsx`:

```tsx
  it("shows a status select for the project owner", () => {
    mockUser("owner-1")
    renderCard(base, "owner-1")
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument()
  })

  it("shows the read-only status badge for a non-owner", () => {
    mockUser("viewer-1")
    renderCard(base)
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument()
    expect(screen.getByText("open")).toBeInTheDocument()
  })

  it("updates the status when the project owner selects a new value", async () => {
    mockUser("owner-1")
    vi.spyOn(api, "updateFeatureRequestStatus").mockResolvedValue({
      featureRequest: { ...base, status: "planned" },
    })
    renderCard(base, "owner-1")

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("planned"))

    expect(api.updateFeatureRequestStatus).toHaveBeenCalledWith("f1", "planned")
  })

  it("shows an inline error and keeps the original status when the update fails", async () => {
    mockUser("owner-1")
    vi.spyOn(api, "updateFeatureRequestStatus").mockRejectedValue(new api.ApiError(403, "forbidden"))
    renderCard(base, "owner-1")

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("planned"))

    expect(await screen.findByText("forbidden")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("open")
  })
```

- [ ] **Step 13: Run to verify failure**

Run: `cd signal-web && npm test -- src/components/feature-requests/FeatureRequestCard.test.tsx`
Expected: FAIL — no combobox is rendered yet.

- [ ] **Step 14: Implement** — in `FeatureRequestCard.tsx`, add imports:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApiError, unvoteFeatureRequest, updateFeatureRequestStatus, voteFeatureRequest } from "@/lib/api"
```

Add the mutation alongside `voteMutation`:

```tsx
  const statusMutation = useMutation({
    mutationFn: (status: string) => updateFeatureRequestStatus(featureRequest.id, status),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] }),
  })
```

Replace the status `<span>` with:

```tsx
            {isProjectOwner ? (
              <Select
                value={featureRequest.status}
                onValueChange={(status) => statusMutation.mutate(status)}
                disabled={statusMutation.isPending}
              >
                <SelectTrigger aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {statusLabels[featureRequest.status] ?? featureRequest.status}
              </span>
            )}
```

And add the inline error message after the title/status row's closing `</div>` (still inside `<div className="flex-1">`, before the description):

```tsx
          {statusMutation.isError && (
            <p className="mt-1 text-xs text-destructive">
              {statusMutation.error instanceof ApiError ? statusMutation.error.message : "something went wrong"}
            </p>
          )}
```

- [ ] **Step 15: Run to verify pass**

Run: `cd signal-web && npm test -- src/components/feature-requests/FeatureRequestCard.test.tsx`
Expected: PASS.

- [ ] **Step 16: Run the full web suite, lint, and build**

Run: `cd signal-web && npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 17: Commit**

```bash
git add signal-web/src/components/feature-requests/FeatureRequestCard.tsx signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx
git commit -m "feat(web): let project owners change a feature request's status"
```

---

## Self-Review

- **Spec coverage:** click project → project page (Task 6 + Task 4); list ordered by upvotes with
  infinite scroll (Task 3 — order is server-supplied); per-card upvote with single-vote + author
  cannot vote (Task 2); per-card edit/delete with availability validation (Task 2); "New feature
  request" button on project page (Task 4); new-feature-request page with title/description
  validation, submit, and cancel-returns-to-project (Task 5); project-owner status editing with
  auto-save and inline error handling (Task 7).
- **No placeholders:** every component and test is written in full; every step has an exact command
  and expected result.
- **Type consistency:** all components use the `FeatureRequest` field names from Task 1
  (`createdBy`, `createdByName`, `upvoteCount`, `viewerHasVoted`, `projectId`); the list query key
  `["featureRequests", projectId]` is identical in the list, card mutation, delete dialog, status
  mutation, and form page; `FeatureRequestCard` is always given both `featureRequest` and
  `projectOwnerId`.

## Note on the GET /projects/:id dependency

`getProject` (Task 1) and `ProjectPage` (Task 4) depend on `GET /projects/:id`, which is delivered
by the signal-api plan. Until that endpoint is live, `ProjectPage` renders its "Project not found."
branch against a running API, but all tests here mock `getProject` and pass independently.