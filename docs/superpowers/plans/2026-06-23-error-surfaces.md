# Error Surfaces Implementation Plan

> **Note (2026-06-23):** Executed and merged. The *toast-hosting* parts of this plan (Login/Register rendering their own `Toast`, `ProjectFormDialog`'s local toast, and the `onStatusToast` prop chain through `FeatureRequestList`) were subsequently replaced by a global `ToastProvider`/`useToast` and extended with success toasts on every create/edit/delete — see `docs/superpowers/plans/2026-06-23-toast-provider.md`. The inline-`Alert` failure behavior here is unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split error presentation by surface — page-level action failures show an error `Toast`; failures inside a modal dialog show a new inline soft-tint `Alert` and keep the dialog open.

**Architecture:** Add one new presentational primitive (`Alert`). Convert the two auth pages and the feature-request status change to the existing `Toast` (`variant="error"`). Convert the four dialogs (project/feature-request create-edit, project/feature-request delete) from bare `text-destructive` text — or, for `ProjectFormDialog`, from an error toast — to the inline `Alert`.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Tailwind, Radix Dialog/Select, TanStack Query, Vitest + Testing Library, lucide-react icons.

## Global Constraints

- **No new dependencies.** `AlertCircle` comes from the already-installed `lucide-react` (the same package `toast.tsx` imports `Check, X` from).
- **Error-surface rule (verbatim from the spec):** page-level failures (auth submit on Login/Register; the inline status change on a feature-request card) → error `Toast` (`variant="error"`); failures inside a modal dialog → inline `Alert`, dialog stays open; modal success that closes the dialog still uses a success `Toast`.
- **Alert styling (exact):** `flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive`, `role="alert"`, leading `AlertCircle` icon (`mt-0.5 h-4 w-4 shrink-0`, `aria-hidden`).
- **Commits:** Conventional Commits per `CONVENTIONAL_COMMIT_GUIDELINE.md`. Lowercase imperative summary, no trailing period, under 72 chars. **Do NOT add any `Co-authored-by` / AI-attribution trailer.**
- **Do NOT modify `prompts.txt`** (controller-session only).
- All work happens in the current worktree (`chore/redesign-error-surfaces`). Run commands from `signal-web/`.
- Test/typecheck commands: `npx vitest run <file>` (single file), `npm test` (full suite), `npx tsc -b` (typecheck).

---

### Task 1: `Alert` primitive

**Files:**
- Create: `signal-web/src/components/ui/alert.tsx`
- Test: `signal-web/src/components/ui/alert.test.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`; `AlertCircle` from `lucide-react`.
- Produces: `export function Alert({ children, className }: { children: ReactNode; className?: string })` — renders a `role="alert"` block containing the icon + `children`.

- [ ] **Step 1: Write the failing test**

`signal-web/src/components/ui/alert.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Alert } from "./alert"

describe("Alert", () => {
  it("renders the message inside a role=alert region", () => {
    render(<Alert>Something went wrong</Alert>)
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong")
  })

  it("uses the destructive styling", () => {
    render(<Alert>Nope</Alert>)
    expect(screen.getByRole("alert").className).toContain("text-destructive")
  })

  it("merges a custom className", () => {
    render(<Alert className="mt-4">Nope</Alert>)
    expect(screen.getByRole("alert").className).toContain("mt-4")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/alert.test.tsx`
Expected: FAIL — cannot resolve `./alert`.

- [ ] **Step 3: Write minimal implementation**

`signal-web/src/components/ui/alert.tsx`:
```tsx
import { AlertCircle } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface AlertProps {
  children: ReactNode
  className?: string
}

export function Alert({ children, className }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive",
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/alert.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/ui/alert.tsx signal-web/src/components/ui/alert.test.tsx
git commit -m "feat(web): add an inline Alert component for in-modal errors"
```

---

### Task 2: Login & Register error toasts

**Files:**
- Modify: `signal-web/src/pages/LoginPage.tsx`
- Modify: `signal-web/src/pages/RegisterPage.tsx`
- Create: `signal-web/src/pages/LoginPage.test.tsx`
- Create: `signal-web/src/pages/RegisterPage.test.tsx`

**Interfaces:**
- Consumes: existing `Toast` (`variant="error"`, `title`, `description`, `onDismiss`) from `@/components/ui/toast`; `useAuth` from `@/context/AuthContext`.
- Produces: no new exports. Behavior: a failed submit sets `error` state and renders an error `Toast`; success still navigates.

- [ ] **Step 1: Write the failing tests**

`signal-web/src/pages/LoginPage.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import { ApiError } from "@/lib/api"
import LoginPage from "./LoginPage"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

function setupAuth(login = vi.fn()) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "unauthenticated",
    user: null,
    login,
    register: vi.fn(),
    logout: vi.fn(),
  })
  return login
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  setupAuth()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("LoginPage", () => {
  it("does not show an error toast initially", () => {
    renderPage()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows an error toast when login fails", async () => {
    setupAuth(vi.fn().mockRejectedValue(new ApiError(401, "invalid credentials")))
    renderPage()

    await userEvent.type(screen.getByLabelText("Email"), "a@b.com")
    await userEvent.type(screen.getByLabelText("Password"), "password123")
    await userEvent.click(screen.getByRole("button", { name: "Log in" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Couldn't log in")
    expect(alert).toHaveTextContent("invalid credentials")
  })
})
```

`signal-web/src/pages/RegisterPage.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import { ApiError } from "@/lib/api"
import RegisterPage from "./RegisterPage"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

function setupAuth(register = vi.fn()) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "unauthenticated",
    user: null,
    login: vi.fn(),
    register,
    logout: vi.fn(),
  })
  return register
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  setupAuth()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("RegisterPage", () => {
  it("does not show an error toast initially", () => {
    renderPage()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows an error toast when registration fails", async () => {
    setupAuth(vi.fn().mockRejectedValue(new ApiError(409, "email already in use")))
    renderPage()

    await userEvent.type(screen.getByLabelText("Name"), "Ada")
    await userEvent.type(screen.getByLabelText("Email"), "a@b.com")
    await userEvent.type(screen.getByLabelText("Password"), "password123")
    await userEvent.click(screen.getByRole("button", { name: "Create account" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Couldn't create account")
    expect(alert).toHaveTextContent("email already in use")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/LoginPage.test.tsx src/pages/RegisterPage.test.tsx`
Expected: FAIL — `getByRole("alert")` not found (current pages render a bare `<p>`, not a toast).

- [ ] **Step 3: Update `LoginPage.tsx`**

Add the import near the other `@/components/ui` imports:
```tsx
import { Toast } from "@/components/ui/toast"
```
Remove the inline error paragraph inside the form:
```tsx
            {error && <p className="text-sm text-destructive">{error}</p>}
```
Add the toast just before the outermost closing `</div>` (the one that closes `<div className="grid min-h-screen lg:grid-cols-2">`):
```tsx
      {error && (
        <Toast
          variant="error"
          title="Couldn't log in"
          description={error}
          onDismiss={() => setError(null)}
        />
      )}
```

- [ ] **Step 4: Update `RegisterPage.tsx`**

Add the same import:
```tsx
import { Toast } from "@/components/ui/toast"
```
Remove the inline error paragraph:
```tsx
            {error && <p className="text-sm text-destructive">{error}</p>}
```
Add the toast just before the outermost closing `</div>`:
```tsx
      {error && (
        <Toast
          variant="error"
          title="Couldn't create account"
          description={error}
          onDismiss={() => setError(null)}
        />
      )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/pages/LoginPage.test.tsx src/pages/RegisterPage.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add signal-web/src/pages/LoginPage.tsx signal-web/src/pages/RegisterPage.tsx signal-web/src/pages/LoginPage.test.tsx signal-web/src/pages/RegisterPage.test.tsx
git commit -m "feat(web): show auth failures as error toasts"
```

---

### Task 3: `ProjectFormDialog` failure → inline `Alert`

**Files:**
- Modify: `signal-web/src/components/projects/ProjectFormDialog.tsx`
- Modify: `signal-web/src/components/projects/ProjectFormDialog.test.tsx:95-109`

**Interfaces:**
- Consumes: `Alert` from `@/components/ui/alert` (Task 1).
- Produces: failure no longer fires a `Toast`; it sets `error` state and renders `<Alert>` inside the form. Success still fires the success `Toast` and closes.

- [ ] **Step 1: Update the failing test**

Replace the existing `"shows a failure toast when the request fails"` test (`ProjectFormDialog.test.tsx:95-109`) with:
```tsx
  it("shows an inline alert and keeps the dialog open when the request fails", async () => {
    vi.spyOn(api, "createProject").mockRejectedValue(new api.ApiError(400, "name is required"))

    renderDialog({})

    await userEvent.click(screen.getByText("Open form"))
    await userEvent.type(await screen.findByLabelText("Project name"), "x")
    await userEvent.click(screen.getByRole("button", { name: "Save project" }))

    // The inline Alert lives inside the open dialog (not a portaled toast), so no { hidden: true }.
    expect(await screen.findByRole("alert")).toHaveTextContent("name is required")
    // Dialog stays open.
    expect(screen.getByText("Create a project")).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/projects/ProjectFormDialog.test.tsx`
Expected: FAIL — current code renders the failure as a portaled toast (aria-hidden while the dialog is open), so `findByRole("alert")` (visible) does not find it.

- [ ] **Step 3: Update `ProjectFormDialog.tsx`**

Add the import:
```tsx
import { Alert } from "@/components/ui/alert"
```
Add an `error` state next to `toast`:
```tsx
  const [toast, setToast] = useState<ToastState | null>(null)
  const [error, setError] = useState<string | null>(null)
```
Clear it when (re)opening — in `handleOpenChange`, inside the `if (next) {` block, add:
```tsx
      setError(null)
```
Change the mutation's `onError` from setting a toast to setting `error`:
```tsx
    onError: (err) => setError(err instanceof ApiError ? err.message : "something went wrong"),
```
Clear `error` at the start of `handleSubmit`:
```tsx
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    mutation.mutate()
  }
```
Render the alert inside the `<form>`, immediately above the footer button row (`<div className="flex gap-3 pt-1">`):
```tsx
          {error && <Alert>{error}</Alert>}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/projects/ProjectFormDialog.test.tsx`
Expected: PASS (all tests, including the success-toast tests which are unchanged).

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/projects/ProjectFormDialog.tsx signal-web/src/components/projects/ProjectFormDialog.test.tsx
git commit -m "feat(web): show project form errors as an inline alert"
```

---

### Task 4: `FeatureRequestFormDialog` failure → inline `Alert`

**Files:**
- Modify: `signal-web/src/components/feature-requests/FeatureRequestFormDialog.tsx:97`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestFormDialog.test.tsx:77-87`

**Interfaces:**
- Consumes: `Alert` from `@/components/ui/alert` (Task 1).
- Produces: the existing `error` state now renders through `<Alert>` instead of a bare `<p>`.

- [ ] **Step 1: Update the failing test**

Replace the `"shows an inline error when the request fails"` test (`FeatureRequestFormDialog.test.tsx:77-87`) body's final assertion so it requires the Alert role:
```tsx
  it("shows an inline alert when the request fails", async () => {
    vi.spyOn(api, "createFeatureRequest").mockRejectedValue(new api.ApiError(400, "title is required"))

    renderDialog({ projectId: "p1" })

    await userEvent.click(screen.getByText("Open form"))
    await userEvent.type(await screen.findByLabelText("Title"), "x")
    await userEvent.click(screen.getByRole("button", { name: "Save request" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("title is required")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/feature-requests/FeatureRequestFormDialog.test.tsx`
Expected: FAIL — the current bare `<p className="text-sm text-destructive">` has no `role="alert"`.

- [ ] **Step 3: Update `FeatureRequestFormDialog.tsx`**

Add the import:
```tsx
import { Alert } from "@/components/ui/alert"
```
Replace the inline error paragraph at line 97:
```tsx
          {error && <p className="text-sm text-destructive">{error}</p>}
```
with:
```tsx
          {error && <Alert>{error}</Alert>}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/feature-requests/FeatureRequestFormDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/feature-requests/FeatureRequestFormDialog.tsx signal-web/src/components/feature-requests/FeatureRequestFormDialog.test.tsx
git commit -m "feat(web): show feature request form errors as an inline alert"
```

---

### Task 5: Delete dialogs failure → inline `Alert`

**Files:**
- Modify: `signal-web/src/components/projects/DeleteProjectDialog.tsx:58`
- Modify: `signal-web/src/components/projects/DeleteProjectDialog.test.tsx:51-60`
- Modify: `signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.tsx:49`
- Create: `signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.test.tsx`

**Interfaces:**
- Consumes: `Alert` from `@/components/ui/alert` (Task 1).
- Produces: both delete dialogs render their `error` state through `<Alert>`; the dialog stays open on failure.

- [ ] **Step 1: Update / add the failing tests**

In `DeleteProjectDialog.test.tsx`, replace the `"shows an inline error when deletion fails"` test (lines 51-60) final assertion to require the Alert role:
```tsx
  it("shows an inline alert when deletion fails", async () => {
    vi.spyOn(api, "deleteProject").mockRejectedValue(new api.ApiError(403, "forbidden"))
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete project" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("forbidden")
  })
```

Create `signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { DeleteFeatureRequestDialog } from "./DeleteFeatureRequestDialog"

const featureRequest: FeatureRequest = {
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

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DeleteFeatureRequestDialog featureRequest={featureRequest} trigger={<Button>Open</Button>} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DeleteFeatureRequestDialog", () => {
  it("deletes on confirm", async () => {
    const del = vi.spyOn(api, "deleteFeatureRequest").mockResolvedValue(undefined)
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(del).toHaveBeenCalledWith("f1")
  })

  it("shows an inline alert when deletion fails", async () => {
    vi.spyOn(api, "deleteFeatureRequest").mockRejectedValue(new api.ApiError(403, "forbidden"))
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("forbidden")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/projects/DeleteProjectDialog.test.tsx src/components/feature-requests/DeleteFeatureRequestDialog.test.tsx`
Expected: FAIL — the delete dialogs render a bare `<p>` (no `role="alert"`).

- [ ] **Step 3: Update `DeleteProjectDialog.tsx`**

Add the import:
```tsx
import { Alert } from "@/components/ui/alert"
```
Replace line 58:
```tsx
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
```
with:
```tsx
        {error && <Alert className="mt-3">{error}</Alert>}
```

- [ ] **Step 4: Update `DeleteFeatureRequestDialog.tsx`**

Add the import:
```tsx
import { Alert } from "@/components/ui/alert"
```
Replace line 49:
```tsx
        {error && <p className="text-sm text-destructive">{error}</p>}
```
with:
```tsx
        {error && <Alert className="mt-3">{error}</Alert>}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/projects/DeleteProjectDialog.test.tsx src/components/feature-requests/DeleteFeatureRequestDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add signal-web/src/components/projects/DeleteProjectDialog.tsx signal-web/src/components/projects/DeleteProjectDialog.test.tsx signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.tsx signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.test.tsx
git commit -m "feat(web): show delete dialog errors as an inline alert"
```

---

### Task 6: Feature-request status failure → error `Toast`

**Files:**
- Modify: `signal-web/src/components/feature-requests/FeatureRequestCard.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestList.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx:148-158`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestList.test.tsx`

**Interfaces:**
- The `onStatusToast` callback prop gains an optional `variant`: `(toast: { title: string; description: string; variant?: "success" | "error" }) => void`.
- `FeatureRequestCard` removes the inline status-error `<p>`; on status mutation error it calls `onStatusToast({ variant: "error", title: "Couldn't update status", description })`.
- `FeatureRequestList` stores `variant` in its `statusToast` state and passes it to `<Toast variant={...}>`.

- [ ] **Step 1: Update the failing card test**

Replace the `"shows an inline error and keeps the original status when the update fails"` test (`FeatureRequestCard.test.tsx:148-158`) with:
```tsx
  it("routes a failed status update to an error toast and keeps the original status", async () => {
    mockUser("owner-1")
    const onStatusToast = vi.fn()
    vi.spyOn(api, "updateFeatureRequestStatus").mockRejectedValue(new api.ApiError(403, "forbidden"))
    renderCard(base, "owner-1", onStatusToast)

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("Planned"))

    await waitFor(() =>
      expect(onStatusToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", title: "Couldn't update status", description: "forbidden" })
      )
    )
    // No inline error text on the card; the original status is preserved.
    expect(screen.queryByText("forbidden")).not.toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("open")
  })
```

Also widen the `renderCard` helper signature (line 40-44) so `onStatusToast` accepts the variant:
```tsx
function renderCard(
  featureRequest: FeatureRequest,
  projectOwnerId = "owner-1",
  onStatusToast?: (toast: { title: string; description: string; variant?: "success" | "error" }) => void
) {
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/feature-requests/FeatureRequestCard.test.tsx`
Expected: FAIL — the card currently shows inline text and never calls `onStatusToast` on error.

- [ ] **Step 3: Update `FeatureRequestCard.tsx`**

Widen the prop type:
```tsx
  onStatusToast?: (toast: { title: string; description: string; variant?: "success" | "error" }) => void
```
Add an `onError` to `statusMutation`:
```tsx
  const statusMutation = useMutation({
    mutationFn: (status: string) => updateFeatureRequestStatus(featureRequest.id, status),
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] })
      onStatusToast?.({
        title: "Status updated",
        description: `"${featureRequest.title}" → ${statusDisplayLabels[status] ?? status}`,
      })
    },
    onError: (err) =>
      onStatusToast?.({
        variant: "error",
        title: "Couldn't update status",
        description: err instanceof ApiError ? err.message : "something went wrong",
      }),
  })
```
Remove the inline status-error block:
```tsx
          {statusMutation.isError && (
            <p className="mt-1 text-xs text-destructive">
              {statusMutation.error instanceof ApiError ? statusMutation.error.message : "something went wrong"}
            </p>
          )}
```
(`ApiError` stays imported — it is still used in `onError`.)

- [ ] **Step 4: Update `FeatureRequestList.tsx`**

Widen the toast state to carry a variant and pass it through:
```tsx
  const [statusToast, setStatusToast] = useState<
    { title: string; description: string; variant?: "success" | "error" } | null
  >(null)
```
Update the rendered toast:
```tsx
      {statusToast && (
        <Toast
          variant={statusToast.variant}
          title={statusToast.title}
          description={statusToast.description}
          onDismiss={() => setStatusToast(null)}
        />
      )}
```

- [ ] **Step 5: Add the list integration test**

Append to `FeatureRequestList.test.tsx` (inside the `describe` block). It renders as the project owner so the card shows the editable status `Select`, then fails the update and asserts the error toast appears:
```tsx
  it("shows an error toast when a status update fails", async () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "authenticated",
      user: { id: "owner-1", name: "Owner", email: "owner@example.com", createdAt: "2026-06-21T00:00:00Z" },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })
    vi.spyOn(api, "listFeatureRequests").mockResolvedValue({
      featureRequests: [featureRequest("1")],
      nextCursor: null,
    })
    vi.spyOn(api, "updateFeatureRequestStatus").mockRejectedValue(new api.ApiError(403, "forbidden"))

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" />)

    await screen.findByText("Request 1")
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("Planned"))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Couldn't update status")
    expect(alert).toHaveTextContent("forbidden")
  })
```
Add the `userEvent` import at the top of the file:
```tsx
import userEvent from "@testing-library/user-event"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/feature-requests/FeatureRequestCard.test.tsx src/components/feature-requests/FeatureRequestList.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add signal-web/src/components/feature-requests/FeatureRequestCard.tsx signal-web/src/components/feature-requests/FeatureRequestList.tsx signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx signal-web/src/components/feature-requests/FeatureRequestList.test.tsx
git commit -m "feat(web): route feature request status failures to an error toast"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run (from `signal-web/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all suites pass (baseline was 133; this adds the `Alert`, Login, Register, and delete-feature-request suites and the list error-toast test — expect ~140+).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: `tsc -b && vite build` completes with no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean (no new warnings/errors in touched files).

---

## Self-Review

**Spec coverage:**
- Error-surface rule (page → toast, modal → Alert) → Tasks 2, 3, 4, 5, 6. ✅
- New `Alert` primitive (soft-tint, destructive, `role="alert"`, `AlertCircle`) → Task 1. ✅
- `Toast` carries page-level outcomes incl. error variant → already supported; used by Tasks 2 & 6. ✅
- Login/Register error toast (not inline) → Task 2. ✅
- `ProjectFormDialog` success toast kept, failure → Alert → Task 3. ✅
- `FeatureRequestFormDialog`, both delete dialogs → Alert → Tasks 4, 5. ✅
- Feature-request status: success toast kept, failure → error toast → Task 6. ✅
- Testing notes (each surface covered end-to-end) → Tasks 1-6 tests + Task 7 full run. ✅

**Placeholder scan:** none — every code/test step shows complete content.

**Type consistency:** `onStatusToast` widened identically in the card prop, the `renderCard` test helper, and consumed by `FeatureRequestList`'s `statusToast` state (`{ title; description; variant? }`). `Alert` is `{ children, className? }` everywhere it is used. `Toast`'s existing `variant`/`title`/`description`/`onDismiss` props are used unchanged.
