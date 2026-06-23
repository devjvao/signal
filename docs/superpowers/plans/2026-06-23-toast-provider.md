# Toast Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every toast behind a single global `ToastProvider`/`useToast()` so toasts survive the dialog or card that triggered them unmounting, and add the missing success toasts (delete project, feature-request create/edit/delete).

**Architecture:** A `ToastProvider` context (mirroring `AuthProvider`) holds the active toast and renders it at the app root; `useToast().showToast({ variant, title, description })` is called from anywhere. All existing ad-hoc toasts (project create/edit success, the status-change toast, the auth error toasts) migrate to it, and the `onStatusToast` prop chain is removed. Modal *failures* keep their inline `Alert` unchanged.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Tailwind, Radix Dialog/Select, TanStack Query, Vitest + Testing Library.

## Global Constraints

- **No new dependencies.** Reuse the existing `Toast` (`components/ui/toast.tsx`) unchanged.
- **Hosting rule (verbatim from the spec):** every toast goes through the global `ToastProvider` / `useToast()`, never per-dialog or per-list state — this is what lets a delete's success toast appear even though the dialog **and its card** unmount on the refetch. `useToast` throws outside the provider (same contract as `useAuth`).
- **Toast copy:** `Project created` / `Project updated` / `Project deleted`; `Request created` / `Request updated` / `Request deleted`; `Status updated` (success) / `Couldn't update status` (error); `Couldn't log in` / `Couldn't create account`. Description = the entity name/title.
- **Failures unchanged:** modal failures still render the inline `Alert` and keep the dialog open. Only success feedback and toast *hosting* change here.
- **Any component that calls `useToast()` must be wrapped in `<ToastProvider>` in its test** (the hook throws otherwise) — update each affected test's render helper.
- **Commits:** Conventional Commits per `CONVENTIONAL_COMMIT_GUIDELINE.md`; lowercase imperative summary, no trailing period, under 72 chars. **No `Co-authored-by` / AI-attribution trailer.**
- **Do NOT modify `prompts.txt`.** Run commands from `signal-web/`. Test/typecheck: `npx vitest run <file>`, `npm test`, `npx tsc -b`.

---

### Task 1: `ToastProvider` + `useToast`

**Files:**
- Create: `signal-web/src/context/ToastContext.tsx`
- Create: `signal-web/src/context/ToastContext.test.tsx`
- Modify: `signal-web/src/main.tsx`

**Interfaces:**
- Produces: `ToastProvider({ children })`; `useToast(): { showToast: (t: { variant?: "success" | "error"; title: string; description?: string }) => void }`.

- [ ] **Step 1: Write the failing test**

`signal-web/src/context/ToastContext.test.tsx`:
```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/context/ToastContext.test.tsx`
Expected: FAIL — cannot resolve `./ToastContext`.

- [ ] **Step 3: Write the provider**

`signal-web/src/context/ToastContext.tsx`:
```tsx
import { createContext, useCallback, useContext, useRef, useState } from "react"
import type { ReactNode } from "react"

import { Toast } from "@/components/ui/toast"

interface ToastOptions {
  variant?: "success" | "error"
  title: string
  description?: string
}

interface ActiveToast extends ToastOptions {
  id: number
}

interface ToastContextValue {
  showToast: (toast: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null)
  const idRef = useRef(0)

  const showToast = useCallback((options: ToastOptions) => {
    setToast({ ...options, id: idRef.current++ })
  }, [])

  const dismiss = useCallback(() => setToast(null), [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Toast
          key={toast.id}
          variant={toast.variant}
          title={toast.title}
          description={toast.description}
          onDismiss={dismiss}
        />
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return context
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/context/ToastContext.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount the provider in `main.tsx`**

Add the import alongside the other providers:
```tsx
import { ToastProvider } from '@/context/ToastContext'
```
Wrap `<App />` inside `<AuthProvider>`:
```tsx
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -b`  → no errors.
```bash
git add signal-web/src/context/ToastContext.tsx signal-web/src/context/ToastContext.test.tsx signal-web/src/main.tsx
git commit -m "feat(web): add a global ToastProvider and useToast hook"
```

---

### Task 2: Migrate `ProjectFormDialog` success toast → `useToast`

**Files:**
- Modify: `signal-web/src/components/projects/ProjectFormDialog.tsx`
- Modify: `signal-web/src/components/projects/ProjectFormDialog.test.tsx`

**Interfaces:**
- Consumes: `useToast` (Task 1).
- Produces: success fires `showToast`; the local `Toast`/`ToastState` are removed. Failure still sets `error` → inline `Alert`.

- [ ] **Step 1: Update the test render helper to provide the context**

In `ProjectFormDialog.test.tsx`, add the import:
```tsx
import { ToastProvider } from "@/context/ToastContext"
```
Wrap the dialog in `renderDialog`:
```tsx
function renderDialog(props: { project?: Project }) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ProjectFormDialog {...props} trigger={<Button>Open form</Button>} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
```
(The existing `"shows a success toast after creating/updating a project"` tests now assert the provider-rendered toast; the failure-Alert test is unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/projects/ProjectFormDialog.test.tsx`
Expected: FAIL — `ProjectFormDialog` still calls its own `Toast`; once migrated it will call `useToast`, which throws without the provider. (Before migration the wrap is harmless; this step locks the wrap in. If it still passes, proceed — Step 3 is the behavior change.)

- [ ] **Step 3: Migrate `ProjectFormDialog.tsx`**

Replace the toast import:
```tsx
import { Toast } from "@/components/ui/toast"
```
with:
```tsx
import { useToast } from "@/context/ToastContext"
```
Delete the `ToastState` interface (lines defining `interface ToastState {...}`).
Replace the `toast` state with the hook (keep `error`):
```tsx
  const { showToast } = useToast()
  const [error, setError] = useState<string | null>(null)
```
(Remove `const [toast, setToast] = useState<ToastState | null>(null)`.)
Change `onSuccess` to call `showToast`:
```tsx
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] })
      showToast({
        variant: "success",
        title: isEdit ? "Project updated" : "Project created",
        description: name,
      })
      setOpen(false)
    },
```
Remove the trailing toast block (the `{toast && (<Toast .../>)}` JSX) so the dialog ends:
```tsx
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/projects/ProjectFormDialog.test.tsx`
Expected: PASS (success-toast tests find the provider toast; the failure-Alert test still passes).

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/projects/ProjectFormDialog.tsx signal-web/src/components/projects/ProjectFormDialog.test.tsx
git commit -m "refactor(web): route project form toasts through useToast"
```

---

### Task 3: Migrate Login & Register error toasts → `useToast`

**Files:**
- Modify: `signal-web/src/pages/LoginPage.tsx`
- Modify: `signal-web/src/pages/RegisterPage.tsx`
- Modify: `signal-web/src/pages/LoginPage.test.tsx`
- Modify: `signal-web/src/pages/RegisterPage.test.tsx`

**Interfaces:**
- Consumes: `useToast` (Task 1).
- Produces: failed submit calls `showToast({ variant: "error", ... })`; the local `Toast` and `error` state are removed. Success still navigates.

- [ ] **Step 1: Wrap the page tests in the provider**

In both `LoginPage.test.tsx` and `RegisterPage.test.tsx`, add:
```tsx
import { ToastProvider } from "@/context/ToastContext"
```
and wrap the page in `renderPage` (Login shown; Register identical with `RegisterPage`):
```tsx
function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <LoginPage />
      </ToastProvider>
    </MemoryRouter>
  )
}
```
(The existing `getByRole("alert")` / `queryByRole("alert")` assertions still hold — the error toast keeps `role="alert"`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/LoginPage.test.tsx src/pages/RegisterPage.test.tsx`
Expected: still PASS before the component change (the pages currently render their own `Toast`); this step just installs the wrap. Proceed to Step 3.

- [ ] **Step 3: Migrate `LoginPage.tsx`**

Replace the toast import with the hook:
```tsx
import { useToast } from "@/context/ToastContext"
```
(remove `import { Toast } from "@/components/ui/toast"`).
Drop the `error` state and add the hook:
```tsx
  const { login } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
```
Rewrite `handleSubmit` to toast on failure:
```tsx
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      await login(email, password)
      navigate("/")
    } catch (err) {
      showToast({
        variant: "error",
        title: "Couldn't log in",
        description: err instanceof ApiError ? err.message : "something went wrong",
      })
    } finally {
      setIsSubmitting(false)
    }
  }
```
Remove the trailing `{error && (<Toast .../>)}` block so the page ends with the closing `</div>` of the grid.

- [ ] **Step 4: Migrate `RegisterPage.tsx`**

Same edits with `register`/`navigate("/login")` and the title `"Couldn't create account"`:
```tsx
  const { register } = useAuth()
  const { showToast } = useToast()
```
```tsx
    } catch (err) {
      showToast({
        variant: "error",
        title: "Couldn't create account",
        description: err instanceof ApiError ? err.message : "something went wrong",
      })
    } finally {
      setIsSubmitting(false)
    }
```
Remove the `error` state and the trailing `{error && (<Toast .../>)}` block.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/pages/LoginPage.test.tsx src/pages/RegisterPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add signal-web/src/pages/LoginPage.tsx signal-web/src/pages/RegisterPage.tsx signal-web/src/pages/LoginPage.test.tsx signal-web/src/pages/RegisterPage.test.tsx
git commit -m "refactor(web): route auth error toasts through useToast"
```

---

### Task 4: Migrate the status toast → `useToast` (drop `onStatusToast`)

**Files:**
- Modify: `signal-web/src/components/feature-requests/FeatureRequestCard.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestList.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestList.test.tsx`

**Interfaces:**
- `FeatureRequestCard` no longer takes `onStatusToast`; it calls `useToast()` directly. `FeatureRequestList` no longer hosts a `Toast` or passes `onStatusToast`.

- [ ] **Step 1: Update the card test (drop `onStatusToast`, assert toast text)**

In `FeatureRequestCard.test.tsx`, add `import { ToastProvider } from "@/context/ToastContext"` and rewrite the `renderCard` helper (remove the `onStatusToast` param, wrap in `ToastProvider`):
```tsx
function renderCard(featureRequest: FeatureRequest, projectOwnerId = "owner-1") {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <FeatureRequestCard featureRequest={featureRequest} projectOwnerId={projectOwnerId} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
```
Replace the failure test (`"routes a failed status update to an error toast and keeps the original status"`) with:
```tsx
  it("shows an error toast and keeps the original status when the update fails", async () => {
    mockUser("owner-1")
    vi.spyOn(api, "updateFeatureRequestStatus").mockRejectedValue(new api.ApiError(403, "forbidden"))
    renderCard(base, "owner-1")

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("Planned"))

    expect(await screen.findByText("Couldn't update status")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("open")
  })
```
Replace the success test (`"notifies the parent to show a toast after the project owner changes the status"`) with:
```tsx
  it("shows a success toast after the project owner changes the status", async () => {
    mockUser("owner-1")
    vi.spyOn(api, "updateFeatureRequestStatus").mockResolvedValue({
      featureRequest: { ...base, status: "planned" },
    })
    renderCard(base, "owner-1")

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("Planned"))

    expect(await screen.findByText("Status updated")).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/feature-requests/FeatureRequestCard.test.tsx`
Expected: FAIL — `renderCard` no longer passes `onStatusToast`, and the card still calls `onStatusToast` (no provider toast yet); the new toast-text assertions are red.

- [ ] **Step 3: Migrate `FeatureRequestCard.tsx`**

Add the import:
```tsx
import { useToast } from "@/context/ToastContext"
```
Remove `onStatusToast` from the props interface and destructuring:
```tsx
interface FeatureRequestCardProps {
  featureRequest: FeatureRequest
  projectOwnerId: string
}

export function FeatureRequestCard({ featureRequest, projectOwnerId }: FeatureRequestCardProps) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
```
Change `statusMutation` to call `showToast` directly:
```tsx
  const statusMutation = useMutation({
    mutationFn: (status: string) => updateFeatureRequestStatus(featureRequest.id, status),
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] })
      showToast({
        title: "Status updated",
        description: `"${featureRequest.title}" → ${statusDisplayLabels[status] ?? status}`,
      })
    },
    onError: (err) =>
      showToast({
        variant: "error",
        title: "Couldn't update status",
        description: err instanceof ApiError ? err.message : "something went wrong",
      }),
  })
```

- [ ] **Step 4: Migrate `FeatureRequestList.tsx`**

Remove `import { Toast } from "@/components/ui/toast"` and the `useState` import if now unused (it is — drop `useState` from the React import, keeping `useEffect, useRef`):
```tsx
import { useEffect, useRef } from "react"
```
Delete the `statusToast` state block. Drop `onStatusToast` from the card render:
```tsx
        {featureRequests.map((fr) => (
          <FeatureRequestCard key={fr.id} featureRequest={fr} projectOwnerId={projectOwnerId} />
        ))}
```
Remove the trailing `{statusToast && (<Toast .../>)}` block, so the return is:
```tsx
  return (
    <div className="flex flex-col gap-3">
      {featureRequests.map((fr) => (
        <FeatureRequestCard key={fr.id} featureRequest={fr} projectOwnerId={projectOwnerId} />
      ))}
      <div ref={sentinelRef} />
      {isFetchingNextPage && <p className="text-sm text-muted-foreground">Loading more...</p>}
    </div>
  )
```
(The outer `<>...</>` fragment is no longer needed since only one element remains.)

- [ ] **Step 5: Wrap the list test in the provider**

In `FeatureRequestList.test.tsx`, add `import { ToastProvider } from "@/context/ToastContext"` and wrap inside `renderWithClient`:
```tsx
function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
```
(The existing `"shows an error toast when a status update fails"` test still asserts `"Couldn't update status"` + `"forbidden"` — now sourced from the provider via the card. All other list tests render cards too, which now require the provider.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/feature-requests/FeatureRequestCard.test.tsx src/components/feature-requests/FeatureRequestList.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add signal-web/src/components/feature-requests/FeatureRequestCard.tsx signal-web/src/components/feature-requests/FeatureRequestList.tsx signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx signal-web/src/components/feature-requests/FeatureRequestList.test.tsx
git commit -m "refactor(web): route status toasts through useToast, drop onStatusToast"
```

---

### Task 5: Success toast on feature-request create/edit

**Files:**
- Modify: `signal-web/src/components/feature-requests/FeatureRequestFormDialog.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestFormDialog.test.tsx`

**Interfaces:**
- Consumes: `useToast` (Task 1). Failure path (inline `Alert`) unchanged.

- [ ] **Step 1: Add the failing success-toast test + provider wrap**

In `FeatureRequestFormDialog.test.tsx`, add `import { ToastProvider } from "@/context/ToastContext"` and wrap in `renderDialog`:
```tsx
function renderDialog(props: { projectId: string; featureRequest?: FeatureRequest }) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <FeatureRequestFormDialog {...props} trigger={<Button>Open form</Button>} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
```
Add a success test inside the `describe`:
```tsx
  it("shows a success toast after creating a request", async () => {
    vi.spyOn(api, "createFeatureRequest").mockResolvedValue({ featureRequest: existing })

    renderDialog({ projectId: "p1" })

    await userEvent.click(screen.getByText("Open form"))
    await userEvent.type(await screen.findByLabelText("Title"), "New idea")
    await userEvent.click(screen.getByRole("button", { name: "Save request" }))

    expect(await screen.findByText("Request created")).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/feature-requests/FeatureRequestFormDialog.test.tsx`
Expected: FAIL — the dialog calls `useToast` only after migration; before Step 3 there is no `"Request created"` toast (and without the hook, the provider wrap is harmless).

- [ ] **Step 3: Migrate `FeatureRequestFormDialog.tsx`**

Add the import:
```tsx
import { useToast } from "@/context/ToastContext"
```
Add the hook next to the other state:
```tsx
  const { showToast } = useToast()
```
Update `onSuccess`:
```tsx
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["featureRequests", projectId] })
      showToast({
        variant: "success",
        title: isEdit ? "Request updated" : "Request created",
        description: title,
      })
      setOpen(false)
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/feature-requests/FeatureRequestFormDialog.test.tsx`
Expected: PASS (the new success test + the unchanged Alert-failure test).

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/feature-requests/FeatureRequestFormDialog.tsx signal-web/src/components/feature-requests/FeatureRequestFormDialog.test.tsx
git commit -m "feat(web): toast on feature request create and edit"
```

---

### Task 6: Success toast on project & feature-request deletion

**Files:**
- Modify: `signal-web/src/components/projects/DeleteProjectDialog.tsx`
- Modify: `signal-web/src/components/projects/DeleteProjectDialog.test.tsx`
- Modify: `signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.tsx`
- Modify: `signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.test.tsx`

**Interfaces:**
- Consumes: `useToast` (Task 1). Failure path (inline `Alert`) and reopen-clears-error behavior unchanged.

- [ ] **Step 1: Add failing success-toast tests + provider wraps**

In `DeleteProjectDialog.test.tsx`, add `import { ToastProvider } from "@/context/ToastContext"` and wrap in `renderDialog`:
```tsx
function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <DeleteProjectDialog project={project} trigger={<Button>Open</Button>} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
```
Add the success test:
```tsx
  it("shows a success toast after deleting", async () => {
    vi.spyOn(api, "deleteProject").mockResolvedValue(undefined)
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete project" }))

    expect(await screen.findByText("Project deleted")).toBeInTheDocument()
  })
```
In `DeleteFeatureRequestDialog.test.tsx`, add the same import and wrap in `renderDialog`:
```tsx
function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <DeleteFeatureRequestDialog featureRequest={featureRequest} trigger={<Button>Open</Button>} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
```
Add the success test:
```tsx
  it("shows a success toast after deleting", async () => {
    vi.spyOn(api, "deleteFeatureRequest").mockResolvedValue(undefined)
    renderDialog()

    await userEvent.click(screen.getByText("Open"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Request deleted")).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/projects/DeleteProjectDialog.test.tsx src/components/feature-requests/DeleteFeatureRequestDialog.test.tsx`
Expected: FAIL — no `"Project deleted"` / `"Request deleted"` toast yet.

- [ ] **Step 3: Migrate `DeleteProjectDialog.tsx`**

Add the import:
```tsx
import { useToast } from "@/context/ToastContext"
```
Add the hook inside the component:
```tsx
  const { showToast } = useToast()
```
In `handleConfirm`, toast on success before closing:
```tsx
    try {
      await deleteProject(project.id)
      await queryClient.invalidateQueries({ queryKey: ["projects"] })
      showToast({ variant: "success", title: "Project deleted", description: project.name })
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsDeleting(false)
    }
```

- [ ] **Step 4: Migrate `DeleteFeatureRequestDialog.tsx`**

Add the import and hook:
```tsx
import { useToast } from "@/context/ToastContext"
```
```tsx
  const { showToast } = useToast()
```
In `handleConfirm`:
```tsx
    try {
      await deleteFeatureRequest(featureRequest.id)
      await queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] })
      showToast({ variant: "success", title: "Request deleted", description: featureRequest.title })
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsDeleting(false)
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/projects/DeleteProjectDialog.test.tsx src/components/feature-requests/DeleteFeatureRequestDialog.test.tsx`
Expected: PASS (new success tests + the unchanged delete/Alert/reopen tests).

- [ ] **Step 6: Commit**

```bash
git add signal-web/src/components/projects/DeleteProjectDialog.tsx signal-web/src/components/projects/DeleteProjectDialog.test.tsx signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.tsx signal-web/src/components/feature-requests/DeleteFeatureRequestDialog.test.tsx
git commit -m "feat(web): toast on project and feature request deletion"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck** — `npx tsc -b` → no errors. (Catches any stale `onStatusToast`/`Toast` reference.)
- [ ] **Step 2: Full suite** — `npm test` → all suites pass (baseline 145 + the `ToastContext` suite + the new success-toast tests).
- [ ] **Step 3: Build** — `npm run build` → `tsc -b && vite build` completes.
- [ ] **Step 4: Lint** — `npm run lint` → 0 errors (the 7 pre-existing `react-refresh` warnings remain; `ToastContext.tsx` exports both a component and a hook, so it may add one more `react-refresh/only-export-components` warning — acceptable, matches `AuthContext.tsx`).

---

## Self-Review

**Spec coverage:**
- Global `ToastProvider`/`useToast`, app-root hosting, throws outside provider → Task 1. ✅
- Migrate project create/edit success toast → Task 2. ✅
- Migrate auth error toasts → Task 3. ✅
- Migrate status toast, remove `onStatusToast` + list `Toast` host → Task 4. ✅
- New success toasts: feature-request create/edit → Task 5; delete project + delete feature request → Task 6. ✅
- Failures stay inline `Alert` → untouched (Tasks 2–6 leave `error`/`Alert` paths intact). ✅
- Tests wrap `useToast` consumers in `ToastProvider`; `ToastContext` has its own test → Tasks 1–6 + Task 7 full run. ✅

**Placeholder scan:** none — every code/test step shows complete content.

**Type consistency:** `showToast({ variant?: "success" | "error"; title: string; description?: string })` is defined in Task 1 and called with exactly those fields in Tasks 2–6. `useToast()` returns `{ showToast }` everywhere. `FeatureRequestCard` drops `onStatusToast` in both the component prop type and the test helper signature (Task 4). `FeatureRequestList` drops `useState` + `Toast` imports consistently with removing its toast state.
