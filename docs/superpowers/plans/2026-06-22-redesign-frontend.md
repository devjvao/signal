# Signal redesign — frontend (signal-web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every existing Signal screen to the bold color-blocked visual direction from `docs/superpowers/specs/2026-06-22-redesign-design.md`, and wire the small set of real features the mockup implies — a light/dark theme toggle, server-side project search/sort and feature-request status filter/sort, and a status-change toast — on top of the aggregate fields and query params already shipped by `docs/superpowers/plans/2026-06-22-redesign-backend.md` and documented in `contracts/projects-api.md` / `contracts/feature-requests-api.md` / `contracts/entities.md`.

**Architecture:** Six new presentational primitives (`StatusBadge`, `VoteControl`, `SearchInput`, `SortSelect`, `FilterChips`, `Toast`) plus a `ThemeToggle` go in `signal-web/src/components/ui/`, following the project's existing shadcn-style convention (kebab-case filenames, `cn()` for class merging, Radix primitives wrapped with Tailwind classes). `signal-web/src/lib/api.ts` gains `requestCount`/`voteCount` on `Project` and `search`/`sort`/`status` query params — this is a pure types-and-querystring change with no new endpoints, since the backend plan already shipped the routes. Search/sort/filter state is **lifted to the page** (`MainPage` for projects, `ProjectPage` for feature requests) and passed down as props, because the existing `ProjectList`/`FeatureRequestList` components each own a `useInfiniteQuery` whose `queryKey` must include `search`/`sort`/`status` so React Query automatically restarts pagination when any of them change (no manual cursor-reset code needed). All existing permission logic (`isAuthor`, `isProjectOwner`, `canEdit`, `canDelete`) is untouched — only presentation and the additions above change.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS (with shadcn-style CSS-variable tokens), Radix UI primitives, TanStack React Query v5, React Router v7, Vitest + Testing Library. No new dependencies — `lucide-react` (icons) and all Radix packages used below are already installed.

## Global Constraints

- Filenames for new files under `signal-web/src/components/ui/` are kebab-case (`status-badge.tsx`), matching `components.json`'s shadcn config. Existing single-word primitives (`button.tsx`, `select.tsx`, etc.) are untouched.
- `tsconfig.app.json` includes all of `src` (no test-file exclusion) and `noUnusedLocals`/`noUnusedParameters` are on, so every test fixture touching a changed type must be updated in the same task that changes the type, and any locals/params that become unused after a refactor must be deleted, not left dangling.
- `vitest run` does not type-check (esbuild transform only) — type errors only surface via `tsc -b` (the `build` script). Still fix fixtures immediately rather than relying on this gap.
- No new npm dependencies. Debouncing, toasts, and theme persistence are hand-rolled with `useState`/`useEffect`/`setTimeout`, per the spec's explicit "no new dependency" note for `Toast`.
- `jsdom` has no `window.matchMedia` implementation; Task 1 adds a default stub to `src/test/setup.ts` (`matches: false`) so every test that renders the real `ThemeToggle` (instead of mocking it) doesn't crash. Individual tests override it with `vi.stubGlobal` when they need to assert dark-preference behavior.
- Pure visual/markup changes with no new user-observable behavior (gradient panels, pill-shaped tabs, icon chips on dialogs) are not preceded by a new failing test — there is nothing for jsdom to meaningfully assert about a gradient. Those steps instead end with "run the existing test file for that component and confirm it's still green." Steps that add new behavior (a breadcrumb that navigates, a tag that appears conditionally, a toast that appears after a mutation) always follow the standard write-test-see-it-fail-implement-see-it-pass cycle.
- Status values are always one of `open`, `planned`, `in_progress`, `completed`, `rejected` (from `contracts/entities.md`); their display labels (`statusLabels`) and ordered `(value, label)` pairs (`statusOptions`) are defined once in Task 2 and imported everywhere else a status needs to be shown or chosen.
- `Button`'s `default` (primary) variant carries the mockup's glow (`shadow-lg shadow-primary/30`) directly in its `cva` base, so every primary button shares it without a per-call-site `className`. (Some earlier call sites still pass the same className; it's redundant via `tailwind-merge` and harmless.) Other variants are unchanged.
- Run `cd signal-web && npm test -- <file>` (vitest) for the targeted test commands below; run `cd signal-web && npm test` for the full suite. Run `cd signal-web && npx tsc -b --noEmit` if you want a type-check independent of `vite build`.

---

## Task 1: `ThemeToggle` — light/dark theme persisted to `localStorage`

**Files:**
- Create: `signal-web/src/components/ui/theme-toggle.tsx`
- Create: `signal-web/src/components/ui/theme-toggle.test.tsx`
- Modify: `signal-web/src/test/setup.ts` (add a default `window.matchMedia` stub)

**Interfaces:**
- Produces: `ThemeToggle()` — a zero-prop component. Task 10 renders it in `MainPage`'s header; no other task in this plan renders it (see Architecture note on scope).
- Produces: the `signal_theme` `localStorage` key (`"light" | "dark"`) and the `dark` class on `document.documentElement` — both are side effects other parts of the app (Tailwind's `darkMode: ["class"]` config) already read, no consumer code needed.

- [ ] **Step 1: Add the default `matchMedia` stub other tests will rely on**

In `signal-web/src/test/setup.ts`, add after the existing `Element.prototype` polyfills:

```ts
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
```

- [ ] **Step 2: Write the failing test**

Create `signal-web/src/components/ui/theme-toggle.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ThemeToggle } from "./theme-toggle"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove("dark")
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ThemeToggle", () => {
  it("defaults to light when there is no stored preference and the system prefers light", () => {
    render(<ThemeToggle />)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument()
  })

  it("defaults to dark when the system prefers dark and nothing is stored", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }))

    render(<ThemeToggle />)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("respects a stored preference over the system preference", () => {
    localStorage.setItem("signal_theme", "dark")
    render(<ThemeToggle />)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("toggles the dark class and persists the choice when clicked", async () => {
    render(<ThemeToggle />)

    await userEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }))

    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(localStorage.getItem("signal_theme")).toBe("dark")
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Switch to light theme" }))

    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(localStorage.getItem("signal_theme")).toBe("light")
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd signal-web && npx vitest run src/components/ui/theme-toggle.test.tsx`
Expected: FAIL — `./theme-toggle` doesn't exist yet.

- [ ] **Step 4: Implement `ThemeToggle`**

Create `signal-web/src/components/ui/theme-toggle.tsx`:

```tsx
import { Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

const THEME_KEY = "signal_theme"

function getInitialTheme(): "light" | "dark" {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === "light" || stored === "dark") return stored
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const next = theme === "dark" ? "light" : "dark"

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd signal-web && npx vitest run src/components/ui/theme-toggle.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add signal-web/src/components/ui/theme-toggle.tsx signal-web/src/components/ui/theme-toggle.test.tsx signal-web/src/test/setup.ts
git commit -m "feat(web): add ThemeToggle with localStorage-persisted light/dark theme"
```

---

## Task 2: Status color tokens + `StatusBadge` primitive

**Files:**
- Modify: `signal-web/src/index.css` (add 4 status CSS variable pairs; `open` reuses `--primary`)
- Modify: `signal-web/tailwind.config.js` (add a `status` color group)
- Create: `signal-web/src/components/ui/status-badge.tsx`
- Create: `signal-web/src/components/ui/status-badge.test.tsx`

**Interfaces:**
- Produces: `statusLabels: Record<string, string>` and `statusOptions: { value: string; label: string }[]` — every later task that renders or chooses a status (Task 13's `FeatureRequestCard`, Task 14's `ProjectPage` `FilterChips`, Task 15's `FeatureRequestFormDialog`) imports these from `@/components/ui/status-badge` instead of redefining them.
- Produces: `StatusBadge({ status, editable, onStatusChange, disabled, className })` — `editable` (default `false`) switches between a plain pill (`<span>`) and a Radix `Select`-backed dropdown pill with `aria-label="Status"`, matching the existing combobox contract `FeatureRequestCard`'s tests already rely on.

- [ ] **Step 1: Add the status color tokens**

In `signal-web/src/index.css`, add to `:root` (after `--ring`, before the closing `}`):

```css
  --status-planned: 259 96% 67%;
  --status-in-progress: 37 91% 55%;
  --status-completed: 142 76% 36%;
  --status-rejected: 215 20% 65%;
```

Add to `.dark` (after `--ring`, before the closing `}`):

```css
  --status-planned: 247 68% 62%;
  --status-in-progress: 36 71% 42%;
  --status-completed: 142 72% 29%;
  --status-rejected: 215 16% 47%;
```

`open` has no dedicated variable — it reuses `hsl(var(--primary))` directly, since the spec describes it simply as "(blue)" with no separate hex value.

- [ ] **Step 2: Wire the tokens into Tailwind**

In `signal-web/tailwind.config.js`, add to `theme.extend.colors` (after `ring`):

```js
        status: {
          open: "hsl(var(--primary))",
          planned: "hsl(var(--status-planned))",
          "in-progress": "hsl(var(--status-in-progress))",
          completed: "hsl(var(--status-completed))",
          rejected: "hsl(var(--status-rejected))",
        },
```

This produces literal utility classes `bg-status-open`, `bg-status-planned`, `bg-status-in-progress`, `bg-status-completed`, `bg-status-rejected` that Tailwind's content scanner will find as long as they appear as literal strings somewhere in `src/**/*.{ts,tsx}` (Step 4 below puts them in a lookup object, not a template string, for exactly this reason).

- [ ] **Step 3: Write the failing test**

Create `signal-web/src/components/ui/status-badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { StatusBadge, statusLabels, statusOptions } from "./status-badge"

describe("statusLabels and statusOptions", () => {
  it("covers all 5 statuses", () => {
    expect(statusLabels).toEqual({
      open: "open",
      planned: "planned",
      in_progress: "in progress",
      completed: "completed",
      rejected: "rejected",
    })
    expect(statusOptions).toHaveLength(5)
    expect(statusOptions[0]).toEqual({ value: "open", label: "open" })
  })
})

describe("StatusBadge", () => {
  it("renders a plain pill with the status label by default", () => {
    render(<StatusBadge status="open" />)
    expect(screen.getByText("open")).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
  })

  it("renders an editable dropdown when editable is true", () => {
    render(<StatusBadge status="open" editable onStatusChange={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument()
  })

  it("calls onStatusChange with the newly selected value", async () => {
    const onStatusChange = vi.fn()
    render(<StatusBadge status="open" editable onStatusChange={onStatusChange} />)

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("planned"))

    expect(onStatusChange).toHaveBeenCalledWith("planned")
  })

  it("disables the dropdown when disabled is true", () => {
    render(<StatusBadge status="open" editable onStatusChange={vi.fn()} disabled />)
    expect(screen.getByRole("combobox", { name: "Status" })).toBeDisabled()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd signal-web && npx vitest run src/components/ui/status-badge.test.tsx`
Expected: FAIL — `./status-badge` doesn't exist yet.

- [ ] **Step 5: Implement `StatusBadge`**

Create `signal-web/src/components/ui/status-badge.tsx`:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

export const statusLabels: Record<string, string> = {
  open: "open",
  planned: "planned",
  in_progress: "in progress",
  completed: "completed",
  rejected: "rejected",
}

export const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }))

const statusDotClasses: Record<string, string> = {
  open: "bg-status-open",
  planned: "bg-status-planned",
  in_progress: "bg-status-in-progress",
  completed: "bg-status-completed",
  rejected: "bg-status-rejected",
}

interface StatusBadgeProps {
  status: string
  editable?: boolean
  onStatusChange?: (status: string) => void
  disabled?: boolean
  className?: string
}

export function StatusBadge({ status, editable = false, onStatusChange, disabled, className }: StatusBadgeProps) {
  const dotClass = statusDotClasses[status] ?? "bg-muted-foreground"
  const label = statusLabels[status] ?? status

  if (editable) {
    return (
      <Select value={status} onValueChange={onStatusChange} disabled={disabled}>
        <SelectTrigger
          aria-label="Status"
          className={cn("gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs", className)}
        >
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground",
        className
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
      {label}
    </span>
  )
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd signal-web && npx vitest run src/components/ui/status-badge.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add signal-web/src/index.css signal-web/tailwind.config.js signal-web/src/components/ui/status-badge.tsx signal-web/src/components/ui/status-badge.test.tsx
git commit -m "feat(web): add status color tokens and StatusBadge primitive"
```

---

## Task 3: `VoteControl` primitive

**Files:**
- Create: `signal-web/src/components/ui/vote-control.tsx`
- Create: `signal-web/src/components/ui/vote-control.test.tsx`

**Interfaces:**
- Produces: `VoteControl({ count, state, onClick, disabled, className })` where `state` is `"votable" | "voted" | "own"`. Task 13's `FeatureRequestCard` is the sole consumer: it computes `state` from `isAuthor`/`viewerHasVoted` and always renders this control (replacing both the old conditional upvote button and the separate "N upvotes" text for non-voters).

- [ ] **Step 1: Write the failing test**

Create `signal-web/src/components/ui/vote-control.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd signal-web && npx vitest run src/components/ui/vote-control.test.tsx`
Expected: FAIL — `./vote-control` doesn't exist yet.

- [ ] **Step 3: Implement `VoteControl`**

Create `signal-web/src/components/ui/vote-control.tsx`:

```tsx
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface VoteControlProps {
  count: number
  state: "votable" | "voted" | "own"
  onClick?: () => void
  disabled?: boolean
  className?: string
}

export function VoteControl({ count, state, onClick, disabled, className }: VoteControlProps) {
  if (state === "own") {
    return (
      <div
        className={cn(
          "flex h-auto flex-col items-center gap-0.5 rounded-md border border-dashed border-border px-3 py-1.5 text-muted-foreground",
          className
        )}
      >
        <span aria-hidden>▲</span>
        <span className="text-sm font-semibold">{count}</span>
        <span className="font-mono text-[10px] uppercase tracking-wide">Your request</span>
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant={state === "voted" ? "default" : "outline"}
      size="sm"
      aria-label={state === "voted" ? "Remove upvote" : "Upvote"}
      disabled={disabled}
      onClick={onClick}
      className={cn("flex h-auto flex-col px-3 py-1", className)}
    >
      <span aria-hidden>▲</span>
      <span>{count}</span>
    </Button>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd signal-web && npx vitest run src/components/ui/vote-control.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/ui/vote-control.tsx signal-web/src/components/ui/vote-control.test.tsx
git commit -m "feat(web): add VoteControl primitive with votable/voted/own states"
```

---

## Task 4: `SearchInput` primitive (debounced)

**Files:**
- Create: `signal-web/src/components/ui/search-input.tsx`
- Create: `signal-web/src/components/ui/search-input.test.tsx`

**Interfaces:**
- Produces: `SearchInput({ value, onChange, placeholder })` — a controlled-from-outside text input that calls `onChange` with the latest typed value ~300ms after the user stops typing. Task 10's `MainPage` is the sole consumer; it holds the real `search` state and only that debounced `onChange` ever updates it, so `MainPage`'s own test can mock this component entirely and not deal with fake timers (debounce correctness is fully covered here).

- [ ] **Step 1: Write the failing test**

Create `signal-web/src/components/ui/search-input.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SearchInput } from "./search-input"

beforeEach(() => {
  vi.useFakeTimers()
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd signal-web && npx vitest run src/components/ui/search-input.test.tsx`
Expected: FAIL — `./search-input` doesn't exist yet.

- [ ] **Step 3: Implement `SearchInput`**

Create `signal-web/src/components/ui/search-input.tsx`:

```tsx
import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (draft === value) return
    const timeout = setTimeout(() => onChange(draft), 300)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  return (
    <Input
      type="search"
      aria-label="Search projects"
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd signal-web && npx vitest run src/components/ui/search-input.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/ui/search-input.tsx signal-web/src/components/ui/search-input.test.tsx
git commit -m "feat(web): add debounced SearchInput primitive"
```

---

## Task 5: `SortSelect` primitive

**Files:**
- Create: `signal-web/src/components/ui/sort-select.tsx`
- Create: `signal-web/src/components/ui/sort-select.test.tsx`

**Interfaces:**
- Produces: `SortSelect({ value, onChange, options, label }, label default "Sort")` and the exported `SortOption` type (`{ value: string; label: string }`). Task 10 (`MainPage`, options `newest`/`active`) and Task 14 (`ProjectPage`, options `votes`/`newest`) both consume this with different `options` arrays — the component itself has no domain knowledge of which sort modes exist.

- [ ] **Step 1: Write the failing test**

Create `signal-web/src/components/ui/sort-select.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { SortSelect } from "./sort-select"

const options = [
  { value: "newest", label: "Newest" },
  { value: "active", label: "Most active" },
]

describe("SortSelect", () => {
  it("renders a combobox showing the current value's label", () => {
    render(<SortSelect value="newest" onChange={vi.fn()} options={options} />)
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveTextContent("Newest")
  })

  it("calls onChange with the selected option's value", async () => {
    const onChange = vi.fn()
    render(<SortSelect value="newest" onChange={onChange} options={options} />)

    await userEvent.click(screen.getByRole("combobox", { name: "Sort" }))
    await userEvent.click(await screen.findByText("Most active"))

    expect(onChange).toHaveBeenCalledWith("active")
  })

  it("supports a custom accessible label", () => {
    render(<SortSelect value="newest" onChange={vi.fn()} options={options} label="Sort feature requests" />)
    expect(screen.getByRole("combobox", { name: "Sort feature requests" })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd signal-web && npx vitest run src/components/ui/sort-select.test.tsx`
Expected: FAIL — `./sort-select` doesn't exist yet.

- [ ] **Step 3: Implement `SortSelect`**

Create `signal-web/src/components/ui/sort-select.tsx`:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export interface SortOption {
  value: string
  label: string
}

interface SortSelectProps {
  value: string
  onChange: (value: string) => void
  options: SortOption[]
  label?: string
}

export function SortSelect({ value, onChange, options, label = "Sort" }: SortSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className="w-auto gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd signal-web && npx vitest run src/components/ui/sort-select.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/ui/sort-select.tsx signal-web/src/components/ui/sort-select.test.tsx
git commit -m "feat(web): add generic SortSelect primitive"
```

---

## Task 6: `FilterChips` primitive

**Files:**
- Create: `signal-web/src/components/ui/filter-chips.tsx`
- Create: `signal-web/src/components/ui/filter-chips.test.tsx`

**Interfaces:**
- Produces: `FilterChips({ value, onChange, options, allLabel }, allLabel default "All")` where `value` is `string | null` (`null` means "All" is selected) and `FilterChipOption` is `{ value: string; label: string }`. Task 14's `ProjectPage` is the sole consumer, passing `statusOptions` (from Task 2) as `options`.

- [ ] **Step 1: Write the failing test**

Create `signal-web/src/components/ui/filter-chips.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { FilterChips } from "./filter-chips"

const options = [
  { value: "open", label: "Open" },
  { value: "planned", label: "Planned" },
]

describe("FilterChips", () => {
  it("renders an All chip plus one chip per option", () => {
    render(<FilterChips value={null} onChange={vi.fn()} options={options} />)
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Planned" })).toBeInTheDocument()
  })

  it("marks the All chip as pressed when value is null", () => {
    render(<FilterChips value={null} onChange={vi.fn()} options={options} />)
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "false")
  })

  it("marks the matching option chip as pressed", () => {
    render(<FilterChips value="open" onChange={vi.fn()} options={options} />)
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true")
  })

  it("calls onChange with the option's value when clicked, and null when All is clicked", async () => {
    const onChange = vi.fn()
    render(<FilterChips value="open" onChange={onChange} options={options} />)

    await userEvent.click(screen.getByRole("button", { name: "Planned" }))
    expect(onChange).toHaveBeenLastCalledWith("planned")

    await userEvent.click(screen.getByRole("button", { name: "All" }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd signal-web && npx vitest run src/components/ui/filter-chips.test.tsx`
Expected: FAIL — `./filter-chips` doesn't exist yet.

- [ ] **Step 3: Implement `FilterChips`**

Create `signal-web/src/components/ui/filter-chips.tsx`:

```tsx
import { cn } from "@/lib/utils"

export interface FilterChipOption {
  value: string
  label: string
}

interface FilterChipsProps {
  value: string | null
  onChange: (value: string | null) => void
  options: FilterChipOption[]
  allLabel?: string
}

function chipClass(active: boolean) {
  return cn(
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-background text-muted-foreground"
  )
}

export function FilterChips({ value, onChange, options, allLabel = "All" }: FilterChipsProps) {
  return (
    <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={chipClass(value === null)}>
        {allLabel}
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={chipClass(value === option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd signal-web && npx vitest run src/components/ui/filter-chips.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/ui/filter-chips.tsx signal-web/src/components/ui/filter-chips.test.tsx
git commit -m "feat(web): add FilterChips primitive"
```

---

## Task 7: `Toast` primitive

**Files:**
- Create: `signal-web/src/components/ui/toast.tsx`
- Create: `signal-web/src/components/ui/toast.test.tsx`

**Interfaces:**
- Produces: `Toast({ message, onDismiss, durationMs }, durationMs default 3000)` — a fixed bottom-right `role="status"` element that calls `onDismiss` once after `durationMs`. It owns no visibility state itself; Task 13's `FeatureRequestCard` holds a local `showStatusToast` boolean and conditionally renders this component, passing a callback that flips it back to `false`.

- [ ] **Step 1: Write the failing test**

Create `signal-web/src/components/ui/toast.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Toast } from "./toast"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("Toast", () => {
  it("renders the message", () => {
    render(<Toast message="Status updated" onDismiss={vi.fn()} />)
    expect(screen.getByRole("status")).toHaveTextContent("Status updated")
  })

  it("does not call onDismiss before the duration elapses", () => {
    const onDismiss = vi.fn()
    render(<Toast message="Status updated" onDismiss={onDismiss} />)

    vi.advanceTimersByTime(2999)

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("calls onDismiss after the default 3000ms duration", () => {
    const onDismiss = vi.fn()
    render(<Toast message="Status updated" onDismiss={onDismiss} />)

    vi.advanceTimersByTime(3000)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it("respects a custom durationMs", () => {
    const onDismiss = vi.fn()
    render(<Toast message="Status updated" onDismiss={onDismiss} durationMs={1000} />)

    vi.advanceTimersByTime(999)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd signal-web && npx vitest run src/components/ui/toast.test.tsx`
Expected: FAIL — `./toast` doesn't exist yet.

- [ ] **Step 3: Implement `Toast`**

Create `signal-web/src/components/ui/toast.tsx`:

```tsx
import { useEffect } from "react"

interface ToastProps {
  message: string
  onDismiss: () => void
  durationMs?: number
}

export function Toast({ message, onDismiss, durationMs = 3000 }: ToastProps) {
  useEffect(() => {
    const timeout = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timeout)
  }, [onDismiss, durationMs])

  return (
    <div
      role="status"
      className="fixed bottom-6 right-6 z-50 rounded-md border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg"
    >
      {message}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd signal-web && npx vitest run src/components/ui/toast.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/ui/toast.tsx signal-web/src/components/ui/toast.test.tsx
git commit -m "feat(web): add self-dismissing Toast primitive"
```

---

## Task 8: `lib/api.ts` — project aggregates, `search`/`sort`/`status` query params

**Files:**
- Modify: `signal-web/src/lib/api.ts` (`Project` interface, `ProjectsPageParams`, `projectsQueryString`, `FeatureRequestsPageParams`, `featureRequestsQueryString`)
- Modify: `signal-web/src/lib/api.test.ts` (new tests + existing `Project` fixtures)
- Modify: `signal-web/src/components/projects/ProjectCard.test.tsx` (fixture)
- Modify: `signal-web/src/components/projects/ProjectList.test.tsx` (fixture)
- Modify: `signal-web/src/pages/ProjectFormPage.test.tsx` (fixtures)
- Modify: `signal-web/src/pages/ProjectPage.test.tsx` (fixture)

**Interfaces:**
- Produces: `Project.requestCount: number`, `Project.voteCount: number` — every object literal typed as `Project` anywhere in the codebase must include both fields from this task onward (`tsconfig.app.json` includes test files in its `tsc -b` type-check, so missing fields break the build, not just lint).
- Produces: `ProjectsPageParams.search?: string`, `ProjectsPageParams.sort?: "newest" | "active"` — consumed by Task 10's `ProjectList`.
- Produces: `FeatureRequestsPageParams.status?: string`, `FeatureRequestsPageParams.sort?: "votes" | "newest"` — consumed by Task 14's `FeatureRequestList`.

**Why every `Project` fixture needs updating now:** `grep -rl "ownerName:" signal-web/src` turns up exactly the 6 files touched above (`api.ts` itself plus the 5 test files listed). Updating all of them in this task — even though only `api.test.ts` directly tests the new fields — keeps `tsc -b` green at every commit in this plan, instead of leaving it broken until whichever later task happens to touch each page.

- [ ] **Step 1: Write the failing tests**

In `signal-web/src/lib/api.test.ts`, add to the `describe("listProjects", ...)` block (after the existing "includes cursor and limit when provided" test):

```ts
  it("includes search and sort when provided", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { projects: [], nextCursor: null }))

    await listProjects({ search: "signal", sort: "active" })

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("search=signal")
    expect(url).toContain("sort=active")
  })

  it("omits sort from the query string when sort is the default 'newest'", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { projects: [], nextCursor: null }))

    await listProjects({ sort: "newest" })

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).not.toContain("sort=")
  })

  it("omits search from the query string when it is empty", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { projects: [], nextCursor: null }))

    await listProjects({ search: "" })

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).not.toContain("search=")
  })
```

Add to the `describe("listFeatureRequests", ...)` block:

```ts
  it("includes status and sort when provided", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { featureRequests: [], nextCursor: null }))

    await listFeatureRequests("p1", { status: "planned", sort: "newest" })

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("status=planned")
    expect(url).toContain("sort=newest")
  })

  it("omits sort from the query string when sort is the default 'votes'", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { featureRequests: [], nextCursor: null }))

    await listFeatureRequests("p1", { sort: "votes" })

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).not.toContain("sort=")
  })
```

Update every `Project` object literal in `signal-web/src/lib/api.test.ts` (one each in `describe("listProjects")`'s "returns the parsed projects page" test, `describe("createProject")`, `describe("updateProject")`, and `describe("getProject")`) to add `requestCount: 0, voteCount: 0,` after `ownerName: "Ada",` — e.g.:

```ts
    const project = { id: "1", name: "Signal", slug: "signal", description: null, ownerId: "o1", ownerName: "Ada", requestCount: 0, voteCount: 0, createdAt: "2026-06-21T00:00:00Z" }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd signal-web && npx vitest run src/lib/api.test.ts`
Expected: FAIL — `search`/`sort`/`status` aren't read from params yet, so the new assertions on `url` fail; the fixture updates alone don't fail vitest (no type-check at test time) but are needed for `tsc -b` and are included here so the diff lands together.

- [ ] **Step 3: Update the `Project` interface and params types**

In `signal-web/src/lib/api.ts`, replace the `Project` interface:

```ts
export interface Project {
  id: string
  name: string
  slug: string
  description: string | null
  ownerId: string
  ownerName: string
  requestCount: number
  voteCount: number
  createdAt: string
}
```

Replace `ProjectsPageParams` and `projectsQueryString`:

```ts
interface ProjectsPageParams {
  cursor?: string
  limit?: number
  search?: string
  sort?: "newest" | "active"
}

function projectsQueryString(params: ProjectsPageParams): string {
  const qs = new URLSearchParams()
  if (params.cursor) qs.set("cursor", params.cursor)
  if (params.limit !== undefined) qs.set("limit", String(params.limit))
  if (params.search) qs.set("search", params.search)
  if (params.sort && params.sort !== "newest") qs.set("sort", params.sort)
  const query = qs.toString()
  return query ? `?${query}` : ""
}
```

Replace `FeatureRequestsPageParams` and `featureRequestsQueryString`:

```ts
interface FeatureRequestsPageParams {
  cursor?: string
  limit?: number
  status?: string
  sort?: "votes" | "newest"
}

function featureRequestsQueryString(params: FeatureRequestsPageParams): string {
  const qs = new URLSearchParams()
  if (params.cursor) qs.set("cursor", params.cursor)
  if (params.limit !== undefined) qs.set("limit", String(params.limit))
  if (params.status) qs.set("status", params.status)
  if (params.sort && params.sort !== "votes") qs.set("sort", params.sort)
  const query = qs.toString()
  return query ? `?${query}` : ""
}
```

- [ ] **Step 4: Update the remaining `Project` fixtures**

In each of `signal-web/src/components/projects/ProjectCard.test.tsx`, `signal-web/src/components/projects/ProjectList.test.tsx` (the `project(id)` helper), `signal-web/src/pages/ProjectFormPage.test.tsx` (both inline `project` objects), and `signal-web/src/pages/ProjectPage.test.tsx` (the `project` constant), add `requestCount: 0, voteCount: 0,` after the existing `ownerName: ...,` field. For example, in `ProjectList.test.tsx`:

```ts
function project(id: string) {
  return {
    id,
    name: `Project ${id}`,
    slug: `project-${id}`,
    description: null,
    ownerId: "owner-1",
    ownerName: "Ada Lovelace",
    requestCount: 0,
    voteCount: 0,
    createdAt: "2026-06-21T00:00:00Z",
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd signal-web && npx vitest run src/lib/api.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite and a type-check to confirm no regressions**

Run: `cd signal-web && npm test`
Run: `cd signal-web && npx tsc -b --noEmit`
Expected: both clean — every `Project` fixture across the touched files now satisfies the extended interface.

- [ ] **Step 7: Commit**

```bash
git add signal-web/src/lib/api.ts signal-web/src/lib/api.test.ts signal-web/src/components/projects/ProjectCard.test.tsx signal-web/src/components/projects/ProjectList.test.tsx signal-web/src/pages/ProjectFormPage.test.tsx signal-web/src/pages/ProjectPage.test.tsx
git commit -m "feat(web): add project aggregates and search/sort/status query params to the API client"
```

---

## Task 9: `ProjectCard` — stats line + owner gradient accent

> **Correction (live-render alignment):** the card is a flex-column **grid card** (consumed by
> `ProjectList`'s grid). Every card has a left accent bar — blue→teal gradient for the owner,
> gray (`before:bg-border`) for everyone else. Owner actions are pencil/trash **icon** buttons
> (`aria-label` "Edit project"/"Delete project") in the top-right, not text buttons. The footer is
> a `flex flex-wrap items-end justify-between` row with a meta span ("You"/owner · `MMM D, YYYY`)
> and a stats span rendered as `▲ {votes} · {requests} requests` (the whole span in `text-primary`);
> each span is `whitespace-nowrap` so they stay intact and wrap to separate lines on narrow cards.

**Files:**
- Modify: `signal-web/src/components/projects/ProjectCard.tsx`
- Modify: `signal-web/src/components/projects/ProjectCard.test.tsx`

**Interfaces:**
- Consumes: `Project.requestCount`/`voteCount` from Task 8.

- [ ] **Step 1: Write the failing tests**

In `signal-web/src/components/projects/ProjectCard.test.tsx`, update the `project` fixture's aggregate fields and add tests (the fixture already has `requestCount: 0, voteCount: 0` from Task 8 — change them here to non-zero so the stats line is meaningfully testable):

```ts
const project: Project = {
  id: "p1",
  name: "Signal",
  slug: "signal",
  description: "A product",
  ownerId: "owner-1",
  ownerName: "Ada Lovelace",
  requestCount: 2,
  voteCount: 4,
  createdAt: "2026-06-21T00:00:00Z",
}
```

Add to the `describe("ProjectCard", ...)` block:

```tsx
  it("shows a vote/request stats line", () => {
    mockUser("someone-else")
    renderCard()
    expect(screen.getByText("▲ 4")).toBeInTheDocument()
    expect(screen.getByText(/2 requests/)).toBeInTheDocument()
  })

  it("shows a gradient accent bar for the owner but not for other viewers", () => {
    mockUser("owner-1")
    const { container: ownerContainer } = renderCard()
    expect(ownerContainer.firstChild).toHaveClass("before:bg-gradient-to-b")
  })

  it("does not show the gradient accent bar for a non-owner", () => {
    mockUser("someone-else")
    const { container } = renderCard()
    expect(container.firstChild).not.toHaveClass("before:bg-gradient-to-b")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd signal-web && npx vitest run src/components/projects/ProjectCard.test.tsx`
Expected: FAIL — the stats line and gradient class don't exist yet.

- [ ] **Step 3: Implement the changes**

In `signal-web/src/components/projects/ProjectCard.tsx`, add the `cn` import:

```tsx
import { cn } from "@/lib/utils"
```

Replace the root `<div>` and its content:

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
      className={cn(
        "relative cursor-pointer rounded-md border border-border bg-background p-4 pl-5 text-left",
        isOwner &&
          "before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:rounded-l-md before:bg-gradient-to-b before:from-primary before:to-accent"
      )}
    >
      <h3 className="font-display text-lg font-semibold">{project.name}</h3>
      {project.description && (
        <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {project.ownerName} &middot; {createdAt}
      </p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        ▲ {project.voteCount} votes · {project.requestCount} requests
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd signal-web && npx vitest run src/components/projects/ProjectCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/projects/ProjectCard.tsx signal-web/src/components/projects/ProjectCard.test.tsx
git commit -m "feat(web): show vote/request stats and an owner accent bar on ProjectCard"
```

---

## Task 10: `ProjectList` + `MainPage` — server-side search/sort, header restyle

> **Revised:** the projects `SortSelect` defaults to `active` ("Most active") to match the mockup's rendered state.

> **Correction (live-render alignment):** `ProjectList` renders a responsive grid
> (`grid gap-4 sm:grid-cols-2 lg:grid-cols-3`) rather than a vertical stack. `MainPage`'s header
> stacks the user name over their email (mono) before the avatar chip, ThemeToggle, and Log out.
> The hero is `eyebrow "Browse & build" (primary blue) + title "Projects"` with the `+ New project`
> button on the right of that row; the header contents and page body are both centered in a
> `max-w-7xl` container, and the header is full-bleed `bg-background dark:bg-card` (a shade above
> the page in dark). Search and
> sort move into the **same row as the tab switcher** (tabs left; SearchInput + SortSelect right),
> above the grid. `SearchInput` gains a leading magnifier icon; `SortSelect` shows a `Sort:` prefix.
> Supporting primitive fixes landed with this screen: the shared `Select` trigger gets a primary
> focus/open ring and its items highlight in primary (not teal `accent`); the page body uses a
> muted background with `bg-card` cards; the dark `--card` token was darkened to `216 55% 15%`;
> cards keep a primary `focus-visible` ring and stay tab-focusable while each Tabs panel is
> `tabIndex={-1}`; owner edit/delete are `h-8` bordered icon-squares whose background matches the
> card (edit glyph primary with a gray→primary border by theme, delete glyph + border destructive)
> with `size-3` glyphs and a color-matched hover tint (not the `ghost` teal). Cards gain a subtle
> primary glow + border on hover. (Light/dark `--destructive` were also nudged lighter to match the
> mock's softer red.) The header itself was extracted to a shared `components/layout/AppHeader.tsx`
> (logo · user · ThemeToggle · Log out) now rendered on every authenticated page — `MainPage`,
> `ProjectPage`, and both form pages — so the navbar is consistent and fixed once. Page tests that
> don't provide an `AuthProvider` mock `AppHeader`. Globally, the `Button` `outline`/`ghost` hover
> moved off the teal `accent` to a neutral `bg-muted` so navbar/icon hovers aren't green.
> `ProjectList`'s empty branch now renders a shared `EmptyState` (`components/ui/empty-state.tsx`)
> — brand chevron chip, "No projects yet", scope-aware copy, and a "+ Create your first project"
> CTA — instead of a bare text line (its test asserts the heading without the trailing period).

**Files:**
- Modify: `signal-web/src/components/projects/ProjectList.tsx`
- Modify: `signal-web/src/components/projects/ProjectList.test.tsx`
- Modify: `signal-web/src/pages/MainPage.tsx`
- Modify: `signal-web/src/pages/MainPage.test.tsx`

**Interfaces:**
- Consumes: `ProjectsPageParams.search`/`sort` (Task 8), `SearchInput` (Task 4), `SortSelect` (Task 5), `ThemeToggle` (Task 1).
- Produces: `ProjectList({ scope, search, sort })` — `search` defaults to `""`, `sort` defaults to `"newest"`. `MainPage` is the only consumer that passes non-default values; it lifts the state so the same `search`/`sort` apply to whichever of the two tabs (`all`/`mine`) is currently mounted.

- [ ] **Step 1: Write the failing tests for `ProjectList`**

In `signal-web/src/components/projects/ProjectList.test.tsx`, replace the "fetches the next page when the sentinel intersects" test's final assertion and add new tests. Replace:

```tsx
    expect(await screen.findByText("Project 2")).toBeInTheDocument()
    expect(spy).toHaveBeenLastCalledWith({ cursor: "cursor-1" })
  })
})
```

with:

```tsx
    expect(await screen.findByText("Project 2")).toBeInTheDocument()
    expect(spy).toHaveBeenLastCalledWith({ cursor: "cursor-1", search: "", sort: "newest" })
  })

  it("passes search and sort through to listProjects", async () => {
    const spy = vi.spyOn(api, "listProjects").mockResolvedValue({ projects: [project("1")], nextCursor: null })

    renderWithClient(<ProjectList scope="all" search="signal" sort="active" />)

    expect(await screen.findByText("Project 1")).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith({ cursor: undefined, search: "signal", sort: "active" })
  })

  it("restarts pagination when search changes", async () => {
    const spy = vi.spyOn(api, "listProjects")
    spy.mockResolvedValueOnce({ projects: [project("1")], nextCursor: null })
    spy.mockResolvedValueOnce({ projects: [project("2")], nextCursor: null })

    const { rerender } = renderWithClient(<ProjectList scope="all" search="" sort="newest" />)
    expect(await screen.findByText("Project 1")).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ProjectList scope="all" search="other" sort="newest" />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(await screen.findByText("Project 2")).toBeInTheDocument()
    expect(spy).toHaveBeenLastCalledWith({ cursor: undefined, search: "other", sort: "newest" })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd signal-web && npx vitest run src/components/projects/ProjectList.test.tsx`
Expected: FAIL — `ProjectList` doesn't accept `search`/`sort` props yet, and `fetchPage` is called with only `{ cursor }`.

- [ ] **Step 3: Update `ProjectList`**

Replace `signal-web/src/components/projects/ProjectList.tsx`'s props and query:

```tsx
interface ProjectListProps {
  scope: "all" | "mine"
  search?: string
  sort?: "newest" | "active"
}

export function ProjectList({ scope, search = "", sort = "newest" }: ProjectListProps) {
  const fetchPage = scope === "mine" ? listMyProjects : listProjects

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["projects", scope, sort, search],
    queryFn: ({ pageParam }) => fetchPage({ cursor: pageParam, search, sort }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
```

(The rest of the component — the `IntersectionObserver` effect, loading/empty states, and the `ProjectCard` map — is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd signal-web && npx vitest run src/components/projects/ProjectList.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing tests for `MainPage`**

In `signal-web/src/pages/MainPage.test.tsx`, replace the `ProjectList` mock and add a `SearchInput` mock so the test doesn't have to deal with the 300ms debounce (already covered by Task 4's own test):

```tsx
vi.mock("@/components/projects/ProjectList", () => ({
  ProjectList: ({ scope, search, sort }: { scope: string; search?: string; sort?: string }) => (
    <div>
      ProjectList:{scope}:{search}:{sort}
    </div>
  ),
}))

vi.mock("@/components/ui/search-input", () => ({
  SearchInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="Search projects" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))
```

Add new tests:

```tsx
describe("MainPage header and hero", () => {
  it("shows the hero title", () => {
    mockAuthenticated()
    render(
      <MemoryRouter>
        <MainPage />
      </MemoryRouter>
    )
    expect(screen.getByText("Browse feature requests")).toBeInTheDocument()
  })

  it("shows the user's initials and a theme toggle in the header", () => {
    mockAuthenticated()
    render(
      <MemoryRouter>
        <MainPage />
      </MemoryRouter>
    )
    expect(screen.getByText("AL")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /switch to (dark|light) theme/i })).toBeInTheDocument()
  })
})

describe("MainPage search and sort", () => {
  it("passes the typed search value down to ProjectList", async () => {
    mockAuthenticated()
    render(
      <MemoryRouter>
        <MainPage />
      </MemoryRouter>
    )

    await userEvent.type(screen.getByLabelText("Search projects"), "signal")

    expect(screen.getByText("ProjectList:all:signal:newest")).toBeInTheDocument()
  })

  it("passes the selected sort value down to ProjectList", async () => {
    mockAuthenticated()
    render(
      <MemoryRouter>
        <MainPage />
      </MemoryRouter>
    )

    await userEvent.click(screen.getByRole("combobox", { name: "Sort" }))
    await userEvent.click(await screen.findByText("Most active"))

    expect(screen.getByText("ProjectList:all::active")).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd signal-web && npx vitest run src/pages/MainPage.test.tsx`
Expected: FAIL — `MainPage` doesn't render a hero, avatar chip, `ThemeToggle`, `SearchInput`, or `SortSelect` yet.

- [ ] **Step 7: Update `MainPage`**

Replace `signal-web/src/pages/MainPage.tsx`:

```tsx
import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { Logo } from "@/components/brand/logo"
import { ProjectList } from "@/components/projects/ProjectList"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/search-input"
import { SortSelect } from "@/components/ui/sort-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { useAuth } from "@/context/AuthContext"

const projectSortOptions = [
  { value: "newest", label: "Newest" },
  { value: "active", label: "Most active" },
]

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return (first + last).toUpperCase()
}

export default function MainPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState("newest")

  function handleLogout() {
    logout()
    navigate("/login")
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
        <Logo />
        {user && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {user.name} ({user.email})
            </span>
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary font-mono text-xs font-semibold text-primary-foreground"
            >
              {getInitials(user.name)}
            </span>
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        )}
      </header>
      <main className="flex flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-widest text-accent">Projects</span>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Browse feature requests</h1>
        </div>
        <div className="flex justify-end">
          <Button className="shadow-lg shadow-primary/30" onClick={() => navigate("/projects/new")}>
            New project
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search projects" />
          <SortSelect value={sort} onChange={setSort} options={projectSortOptions} />
        </div>
        <Tabs defaultValue="all">
          <TabsList className="rounded-full bg-muted p-1">
            <TabsTrigger value="all" className="rounded-full">
              All projects
            </TabsTrigger>
            <TabsTrigger value="mine" className="rounded-full">
              My projects
            </TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <ProjectList scope="all" search={search} sort={sort as "newest" | "active"} />
          </TabsContent>
          <TabsContent value="mine">
            <ProjectList scope="mine" search={search} sort={sort as "newest" | "active"} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd signal-web && npx vitest run src/pages/MainPage.test.tsx`
Expected: PASS

- [ ] **Step 9: Run the full suite to confirm no regressions**

Run: `cd signal-web && npm test`
Expected: all PASS

- [ ] **Step 10: Commit**

```bash
git add signal-web/src/components/projects/ProjectList.tsx signal-web/src/components/projects/ProjectList.test.tsx signal-web/src/pages/MainPage.tsx signal-web/src/pages/MainPage.test.tsx
git commit -m "feat(web): wire server-side project search/sort and restyle the MainPage header and hero"
```

---

## Task 11: Login / Register — split-panel layout

**Files:**
- Modify: `signal-web/tailwind.config.js` (add the raw `ink` + `deep` one-off colors)
- Create: `signal-web/src/components/auth/AuthHero.tsx` (shared gradient hero, used by both pages)
- Modify: `signal-web/src/components/brand/logo.tsx` (add the `inverted` prop)
- Modify: `signal-web/src/components/ui/label.tsx` + `label.test.tsx` (mono uppercase field-label style)
- Modify: `signal-web/index.html` (pre-paint theme initializer so logged-out pages honor the theme)
- Modify: `signal-web/src/pages/LoginPage.tsx`
- Create: `signal-web/src/pages/LoginPage.test.tsx`
- Modify: `signal-web/src/pages/RegisterPage.tsx`
- Create: `signal-web/src/pages/RegisterPage.test.tsx`

**Interfaces:**
- Produces: `AuthHero({ eyebrow, headline })` — the navy→blue gradient panel (inverted `Logo`,
  chevron-motif SVG watermark, eyebrow + headline). Both auth pages render it; they differ only in
  the copy passed. The gradient uses fixed tokens (`from-ink via-deep to-[#2563EB]`) so it is
  theme-independent.
- Produces: `Logo`'s `inverted` prop (light icon + white wordmark) and the restyled `Label`
  (mono/uppercase) — both shared primitives consumed by every later form screen.
- The right-hand form is a left-aligned `max-w-sm` block: a colored eyebrow above the heading, mono
  labels, a full-width primary submit (`w-full shadow-lg shadow-primary/30`), and a centered text
  cross-link to the other auth page (not an outline button).

- [ ] **Step 1: Add the `ink` raw color token**

In `signal-web/tailwind.config.js`, add to `theme.extend.colors` (after the `status` block added in Task 2):

```js
        ink: "#0B1A33",
        deep: "#1E40AF",
```

These are one-off gradient colors with no semantic CSS-variable role, per the spec's note that such colors are added as raw Tailwind tokens, not theme variables. The hero gradient (`from-ink via-deep to-[#2563EB]`) deliberately uses these fixed values instead of `primary`/`accent` so it does not shift between light and dark.

- [ ] **Step 2: Write the failing test for `LoginPage`**

Create `signal-web/src/pages/LoginPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import LoginPage from "./LoginPage"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>home</div>} />
        <Route path="/register" element={<div>register page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe("LoginPage", () => {
  it("shows the hero tagline and logs in on submit", async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "unauthenticated",
      user: null,
      login,
      register: vi.fn(),
      logout: vi.fn(),
    })

    renderAt("/login")

    expect(screen.getByText("Vote the future into focus.")).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com")
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery")
    await userEvent.click(screen.getByRole("button", { name: "Log in" }))

    expect(login).toHaveBeenCalledWith("ada@example.com", "correct-horse-battery")
    expect(await screen.findByText("home")).toBeInTheDocument()
  })

  it("navigates to register when the link is clicked", async () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "unauthenticated",
      user: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })

    renderAt("/login")
    await userEvent.click(screen.getByText("Register"))
    expect(await screen.findByText("register page")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd signal-web && npx vitest run src/pages/LoginPage.test.tsx`
Expected: FAIL — the hero tagline text doesn't exist yet.

- [ ] **Step 4: Restyle `LoginPage`**

Replace `signal-web/src/pages/LoginPage.tsx`'s returned JSX (everything after the `handleSubmit` function, keeping all existing state/handlers unchanged):

```tsx
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <AuthHero eyebrow="Community feature requests" headline="Vote the future into focus." />
      <div className="flex flex-col items-center justify-center px-4 py-12">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-xs uppercase tracking-widest text-primary">Welcome back</span>
            <h1 className="font-display text-4xl font-extrabold tracking-tight">Log in</h1>
          </div>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full shadow-lg shadow-primary/30" disabled={isSubmitting}>
              {isSubmitting ? "Logging in..." : "Log in"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            New to Signal?{" "}
            <button type="button" onClick={() => navigate("/register")} className="font-semibold text-primary hover:underline">
              Register
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
```

Replace the old `Logo` import with the shared hero import at the top of the file:

```tsx
import { AuthHero } from "@/components/auth/AuthHero"
```

`AuthHero` itself (`signal-web/src/components/auth/AuthHero.tsx`) renders the gradient panel, the
`inverted` `Logo`, the chevron-motif SVG watermark, and the `{eyebrow, headline}` copy.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd signal-web && npx vitest run src/pages/LoginPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Write the failing test for `RegisterPage`**

Create `signal-web/src/pages/RegisterPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import RegisterPage from "./RegisterPage"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe("RegisterPage", () => {
  it("shows the hero tagline and registers on submit", async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "unauthenticated",
      user: null,
      login: vi.fn(),
      register,
      logout: vi.fn(),
    })

    renderAt("/register")

    expect(screen.getByText("Shape the software you love.")).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Name"), "Ada Lovelace")
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com")
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery")
    await userEvent.click(screen.getByRole("button", { name: "Create account" }))

    expect(register).toHaveBeenCalledWith("Ada Lovelace", "ada@example.com", "correct-horse-battery")
    expect(await screen.findByText("login page")).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd signal-web && npx vitest run src/pages/RegisterPage.test.tsx`
Expected: FAIL — the hero tagline text doesn't exist yet.

- [ ] **Step 8: Restyle `RegisterPage`**

Replace `signal-web/src/pages/RegisterPage.tsx`'s returned JSX (keeping all existing state/handlers unchanged). It mirrors `LoginPage`, but passes `tone="teal"` to `AuthHero` and adds an "Already have an account? Log in" cross-link:

```tsx
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <AuthHero tone="teal" eyebrow="Join the community" headline="Shape the software you love." />
      <div className="flex flex-col items-center justify-center px-4 py-12">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-xs uppercase tracking-widest text-primary">Join Signal</span>
            <h1 className="font-display text-4xl font-extrabold tracking-tight">Register</h1>
          </div>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" required value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full shadow-lg shadow-primary/30" disabled={isSubmitting}>
              {isSubmitting ? "Creating account..." : "Create account"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <button type="button" onClick={() => navigate("/login")} className="font-semibold text-primary hover:underline">
              Log in
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
```

Replace the old `Logo` import with `import { AuthHero } from "@/components/auth/AuthHero"`.

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd signal-web && npx vitest run src/pages/RegisterPage.test.tsx`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add signal-web/tailwind.config.js signal-web/src/pages/LoginPage.tsx signal-web/src/pages/LoginPage.test.tsx signal-web/src/pages/RegisterPage.tsx signal-web/src/pages/RegisterPage.test.tsx
git commit -m "feat(web): restyle Login/Register as a split gradient-hero layout"
```

---

## Task 12: project form → `ProjectFormDialog` (modal)

> **Revised:** the `project-create-modal` / `project-edit-modal` mockups show a **modal**, not a page.
> `ProjectFormPage` is replaced by one shared dialog (mirroring `FeatureRequestFormDialog`).

**Files:**
- Add: `signal-web/src/components/projects/ProjectFormDialog.tsx`
- Add: `signal-web/src/components/projects/ProjectFormDialog.test.tsx`
- Modify: `signal-web/src/pages/MainPage.tsx` + `MainPage.test.tsx` ("+ New project" opens the dialog)
- Modify: `signal-web/src/components/projects/ProjectCard.tsx` (edit button opens the dialog)
- Modify: `signal-web/src/components/projects/ProjectList.tsx` (empty-state CTA opens the dialog)
- Modify: `signal-web/src/App.tsx` (drop the two form-page routes)
- Remove: `signal-web/src/pages/ProjectFormPage.tsx` + `ProjectFormPage.test.tsx`

**Interfaces:**
- Consumes: `Dialog`/`DialogClose` (`ui/dialog`), `createProject` / `updateProject` (`lib/api`).
- Produces: `ProjectFormDialog({ trigger, project? })` — create when `project` is absent, edit when present.

- [x] **Step 1: Build `ProjectFormDialog`** — Radix `Dialog` (`max-w-lg rounded-2xl bg-card p-7`),
  top-right close (X), eyebrow ("New project" primary / "Editing" accent), display title ("Create a
  project" / "Edit project"), "Project name" (`Input`, placeholder "e.g. Aurora Notes") + "Description"
  (`Textarea`, placeholder "What is this project about?"), and a `flex-1` "Save project"/"Save changes"
  submit + outline "Cancel" footer. State resets on open; `useMutation` invalidates `["projects"]` and
  closes on success; `ApiError.message` shows inline.

- [x] **Step 2: Wire the triggers** — MainPage "+ New project" button, the projects empty-state CTA, and
  each owned `ProjectCard`'s edit button render the dialog instead of navigating. `MainPage.test` now
  wraps renders in a `QueryClientProvider` (the dialog calls `useQueryClient`).

- [x] **Step 3: Remove the old page + routes** — delete `ProjectFormPage.tsx`/`.test.tsx` and the
  `/projects/new` + `/projects/:id/edit` routes from `App.tsx`.

- [x] **Step 4: Tests** — `ProjectFormDialog.test.tsx` covers create-submit, edit-prefill +
  update-submit, and inline error; `MainPage.test.tsx` asserts "+ New project" opens the modal ("Create
  a project"). `ProjectCard`/`ProjectList` affordance tests pass unchanged (labels/text preserved).

- [x] **Step 5: Regression gate** — `cd signal-web && npm test -- --run` → all PASS (127);
  `npx tsc --noEmit` → clean.

- [x] **Step 6: Commit**

```bash
git add signal-web/src/components/projects/ProjectFormDialog.tsx \
        signal-web/src/components/projects/ProjectFormDialog.test.tsx \
        signal-web/src/pages/MainPage.tsx signal-web/src/pages/MainPage.test.tsx \
        signal-web/src/components/projects/ProjectCard.tsx \
        signal-web/src/components/projects/ProjectList.tsx \
        signal-web/src/App.tsx
git rm signal-web/src/pages/ProjectFormPage.tsx signal-web/src/pages/ProjectFormPage.test.tsx
git commit -m "feat(web): convert the project form to a modal (light/dark)"
```

---

## Task 12b: `DeleteProjectDialog` — match the delete-project mockup

> Already a modal; needs copy + styling to match `project-delete-dialog` (light/dark).

**Files:** Modify `signal-web/src/components/projects/DeleteProjectDialog.tsx` + `DeleteProjectDialog.test.tsx`;
update `ProjectCard.test.tsx`'s delete-flow assertions for the new button label.

- [x] Dynamic title `Delete "{project.name}"?`; description "This permanently removes the project and all
  its feature requests. This action cannot be undone."; confirm button labelled "Delete project"; a
  rounded-**square** (`rounded-xl`) destructive icon badge inline-left of the title; two **equal-width**
  (50/50, `grid-cols-2`) footer buttons; `rounded-2xl bg-card shadow-2xl` card.
- [x] Added `DeleteProjectDialog.test.tsx` (dynamic title + copy + "Delete project" confirm + inline
  error) and updated `ProjectCard.test`'s delete-flow regression (scoped with `within(dialog)` since the
  trigger and confirm button now share the "Delete project" accessible name). Suite green (129).
- [x] Commit: `feat(web): align the delete-project dialog with the redesign mockup (light/dark)`.

---

## Task 13: `FeatureRequestCard` — `VoteControl` + `StatusBadge` + status-change `Toast`

> **Correction (live-render alignment):** the card is `bg-card` with a `VoteControl` box on the
> left (fixed `w-16`; votable = outline/"VOTES", voted = solid `#2563EB`/"VOTES", own = dashed/
> wrapping "YOUR REQUEST"), title + `StatusBadge` on a `justify-between` row (editable tinted
> dropdown for the owner; read-only tinted pill otherwise), a meta line (`You`/author · `MMM D,
> YYYY`, plus `· N upvotes` only for your own request), and owner/author edit/delete as `h-8`
> bordered icon-square buttons (`aria-label` "Edit/Delete feature request"). The status `Toast` is
> **not** rendered here — the card calls an `onStatusToast` callback in `statusMutation.onSuccess`;
> the toast is hosted by `FeatureRequestList` so it survives the list's post-mutation refetch
> (per-card state was being reset). Shared primitives this depends on (tinted `StatusBadge` w/
> Title-case menu, `VoteControl` caption/box, neutral-hover `Select`, theme-inverted `Toast`) were
> updated first. Tests switch the Edit/Delete `getByText` → `getByLabelText`, the menu click →
> Title-case ("Planned"), and assert `onStatusToast` is called rather than a rendered toast.

**Files:**
- Modify: `signal-web/src/components/feature-requests/FeatureRequestCard.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx`

**Interfaces:**
- Consumes: `VoteControl` (Task 3), `StatusBadge`/`statusLabels` (Task 2), `Toast` (Task 7).

- [ ] **Step 1: Write the failing tests**

In `signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx`, add to the `describe("FeatureRequestCard", ...)` block:

```tsx
  it("shows a non-interactive YOUR REQUEST control for the author instead of an upvote button", () => {
    mockUser("author-1")
    renderCard({ ...base, upvoteCount: 2 })
    expect(screen.getByText(/your request/i)).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /upvote/i })).not.toBeInTheDocument()
  })

  it("shows a toast after the project owner changes the status", async () => {
    mockUser("owner-1")
    vi.spyOn(api, "updateFeatureRequestStatus").mockResolvedValue({
      featureRequest: { ...base, status: "planned" },
    })
    renderCard(base, "owner-1")

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }))
    await userEvent.click(await screen.findByText("planned"))

    expect(await screen.findByRole("status")).toHaveTextContent(/planned/i)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd signal-web && npx vitest run src/components/feature-requests/FeatureRequestCard.test.tsx`
Expected: FAIL — there's no "your request" control and no toast yet.

- [ ] **Step 3: Update `FeatureRequestCard`**

Replace the full contents of `signal-web/src/components/feature-requests/FeatureRequestCard.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { DeleteFeatureRequestDialog } from "@/components/feature-requests/DeleteFeatureRequestDialog"
import { StatusBadge, statusLabels } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Toast } from "@/components/ui/toast"
import { VoteControl } from "@/components/ui/vote-control"
import { useAuth } from "@/context/AuthContext"
import { ApiError, unvoteFeatureRequest, updateFeatureRequestStatus, voteFeatureRequest } from "@/lib/api"
import type { FeatureRequest } from "@/lib/api"

interface FeatureRequestCardProps {
  featureRequest: FeatureRequest
  projectOwnerId: string
}

export function FeatureRequestCard({ featureRequest, projectOwnerId }: FeatureRequestCardProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showStatusToast, setShowStatusToast] = useState(false)

  const isAuthor = user?.id === featureRequest.createdBy
  const isProjectOwner = user?.id === projectOwnerId
  const canEdit = isAuthor && featureRequest.upvoteCount === 0
  const canDelete = isAuthor || isProjectOwner
  const voteState: "votable" | "voted" | "own" = isAuthor
    ? "own"
    : featureRequest.viewerHasVoted
      ? "voted"
      : "votable"

  const voteMutation = useMutation({
    mutationFn: () =>
      featureRequest.viewerHasVoted
        ? unvoteFeatureRequest(featureRequest.id)
        : voteFeatureRequest(featureRequest.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] }),
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateFeatureRequestStatus(featureRequest.id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["featureRequests", featureRequest.projectId] })
      setShowStatusToast(true)
    },
  })

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <VoteControl
          count={featureRequest.upvoteCount}
          state={voteState}
          disabled={voteMutation.isPending}
          onClick={voteState === "own" ? undefined : () => voteMutation.mutate()}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold">{featureRequest.title}</h3>
            {isProjectOwner ? (
              <StatusBadge
                status={featureRequest.status}
                editable
                onStatusChange={(status) => statusMutation.mutate(status)}
                disabled={statusMutation.isPending}
              />
            ) : (
              <StatusBadge status={featureRequest.status} />
            )}
          </div>
          {statusMutation.isError && (
            <p className="mt-1 text-xs text-destructive">
              {statusMutation.error instanceof ApiError ? statusMutation.error.message : "something went wrong"}
            </p>
          )}
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
      {showStatusToast && (
        <Toast
          message={`Status updated to "${statusLabels[statusMutation.variables ?? featureRequest.status] ?? featureRequest.status}"`}
          onDismiss={() => setShowStatusToast(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd signal-web && npx vitest run src/components/feature-requests/FeatureRequestCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/components/feature-requests/FeatureRequestCard.tsx signal-web/src/components/feature-requests/FeatureRequestCard.test.tsx
git commit -m "feat(web): swap FeatureRequestCard to VoteControl/StatusBadge and show a toast on status change"
```

---

## Task 14: `ProjectPage` + `FeatureRequestList` — gradient hero, status filter, sort

> **Revised:** the hero shows only the `{n} requests` pill — the owner-only "You own this" pill was dropped to match the mockup.

> **Correction (live-render alignment):** `ProjectPage` renders `AppHeader`, then a full-bleed
> navy→blue banner (`from-ink via-deep to-[#2563EB]`, content in `max-w-7xl`, chevron-motif SVG)
> with a "← All projects" breadcrumb, title/description, a "{n} requests" pill + owner-only teal
> "You own this" pill, and a primary "+ New feature request" CTA. The body sits on the
> muted/`bg-background` surface; a "FILTER" mono label precedes Title-case `FilterChips`
> (`statusDisplayOptions`), with `SortSelect` (`label="Sort feature requests"`) on the right — the
> whole toolbar is hidden when `requestCount === 0`. `FeatureRequestList` owns the status `Toast`
> state (passed to each card via `onStatusToast`) and renders the shared `EmptyState`
> ("No feature requests yet" + "+ New feature request" CTA) when genuinely empty, or
> "No requests match this filter." when a status filter yields nothing. Tests: mock `useAuth`
> (owner), owner badge assertion → "You own this", chip name → "Planned", sort combobox name →
> "Sort feature requests"; the empty-state text drops its trailing period.

**Files:**
- Modify: `signal-web/src/pages/ProjectPage.tsx`
- Modify: `signal-web/src/pages/ProjectPage.test.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestList.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestList.test.tsx`

**Interfaces:**
- Consumes: `FeatureRequestsPageParams.status`/`sort` (Task 8), `FilterChips` (Task 6), `SortSelect` (Task 5), `statusOptions` (Task 2).
- Produces: `FeatureRequestList({ projectId, projectOwnerId, status, sort })` — `status` defaults to `null`, `sort` defaults to `"votes"`.

- [ ] **Step 1: Write the failing tests for `FeatureRequestList`**

In `signal-web/src/components/feature-requests/FeatureRequestList.test.tsx`, update the existing assertions and add a new test. Replace:

```tsx
    expect(await screen.findByText("Request 1")).toBeInTheDocument()
    expect(api.listFeatureRequests).toHaveBeenCalledWith("p1", { cursor: undefined })
  })
```

with:

```tsx
    expect(await screen.findByText("Request 1")).toBeInTheDocument()
    expect(api.listFeatureRequests).toHaveBeenCalledWith("p1", { cursor: undefined, status: undefined, sort: "votes" })
  })
```

Replace the sentinel-intersection test's final assertion:

```tsx
    expect(spy).toHaveBeenLastCalledWith("p1", { cursor: "cursor-1" })
```

with:

```tsx
    expect(spy).toHaveBeenLastCalledWith("p1", { cursor: "cursor-1", status: undefined, sort: "votes" })
```

Add a new test to the `describe("FeatureRequestList", ...)` block:

```tsx
  it("passes status and sort through to listFeatureRequests", async () => {
    const spy = vi.spyOn(api, "listFeatureRequests").mockResolvedValue({ featureRequests: [], nextCursor: null })

    renderWithClient(<FeatureRequestList projectId="p1" projectOwnerId="owner-1" status="planned" sort="newest" />)

    await screen.findByText("No feature requests yet.")
    expect(spy).toHaveBeenCalledWith("p1", { cursor: undefined, status: "planned", sort: "newest" })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd signal-web && npx vitest run src/components/feature-requests/FeatureRequestList.test.tsx`
Expected: FAIL — `FeatureRequestList` doesn't accept `status`/`sort` props yet.

- [ ] **Step 3: Update `FeatureRequestList`**

Replace `signal-web/src/components/feature-requests/FeatureRequestList.tsx`'s props and query:

```tsx
interface FeatureRequestListProps {
  projectId: string
  projectOwnerId: string
  status?: string | null
  sort?: "votes" | "newest"
}

export function FeatureRequestList({
  projectId,
  projectOwnerId,
  status = null,
  sort = "votes",
}: FeatureRequestListProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["featureRequests", projectId, status, sort],
    queryFn: ({ pageParam }) =>
      listFeatureRequests(projectId, { cursor: pageParam, status: status ?? undefined, sort }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
```

(The rest of the component is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd signal-web && npx vitest run src/components/feature-requests/FeatureRequestList.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing tests for `ProjectPage`**

In `signal-web/src/pages/ProjectPage.test.tsx`, update the `project` fixture and the `FeatureRequestList` mock, and add new tests:

```tsx
const project = {
  id: "p1",
  name: "Signal",
  slug: "signal",
  description: "A product",
  ownerId: "o1",
  ownerName: "Ada",
  requestCount: 3,
  voteCount: 7,
  createdAt: "2026-06-21T00:00:00Z",
}

vi.mock("@/components/feature-requests/FeatureRequestList", () => ({
  FeatureRequestList: ({
    projectId,
    status,
    sort,
  }: {
    projectId: string
    status?: string | null
    sort?: string
  }) => (
    <div>
      FeatureRequestList:{projectId}:{String(status)}:{sort}
    </div>
  ),
}))
```

Add to the `describe("ProjectPage", ...)` block:

```tsx
  it("shows the request count and owner badges in the hero", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue({ project })

    renderAt("/projects/p1")

    expect(await screen.findByText("3 requests")).toBeInTheDocument()
    expect(screen.getByText("Ada")).toBeInTheDocument()
  })

  it("filters and sorts feature requests via FilterChips and SortSelect", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue({ project })

    renderAt("/projects/p1")

    expect(await screen.findByText("FeatureRequestList:p1:null:votes")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "planned" }))
    expect(screen.getByText("FeatureRequestList:p1:planned:votes")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("combobox", { name: "Sort" }))
    await userEvent.click(await screen.findByText("Newest"))
    expect(screen.getByText("FeatureRequestList:p1:planned:newest")).toBeInTheDocument()
  })
```

Add the `userEvent` import at the top of the file if not already present:

```tsx
import userEvent from "@testing-library/user-event"
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd signal-web && npx vitest run src/pages/ProjectPage.test.tsx`
Expected: FAIL — there's no hero banner, request-count/owner badges, `FilterChips`, or `SortSelect` yet.

- [ ] **Step 7: Update `ProjectPage`**

Replace the full contents of `signal-web/src/pages/ProjectPage.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { FeatureRequestList } from "@/components/feature-requests/FeatureRequestList"
import { Button } from "@/components/ui/button"
import { FilterChips } from "@/components/ui/filter-chips"
import { SortSelect } from "@/components/ui/sort-select"
import { statusOptions } from "@/components/ui/status-badge"
import { getProject } from "@/lib/api"

const featureRequestSortOptions = [
  { value: "votes", label: "Most votes" },
  { value: "newest", label: "Newest" },
]

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [status, setStatus] = useState<string | null>(null)
  const [sort, setSort] = useState("votes")

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
      <header className="bg-gradient-to-br from-primary via-primary to-accent px-6 py-10 text-primary-foreground">
        <Button
          variant="link"
          className="h-auto px-0 text-primary-foreground/80 hover:text-primary-foreground"
          onClick={() => navigate("/")}
        >
          ← Back to projects
        </Button>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">{project.name}</h1>
            {project.description && (
              <p className="mt-1 text-sm text-primary-foreground/80">{project.description}</p>
            )}
            <div className="mt-3 flex gap-2">
              <span className="rounded-full border border-white/30 px-2.5 py-0.5 font-mono text-xs">
                {project.requestCount} requests
              </span>
              <span className="rounded-full border border-white/30 px-2.5 py-0.5 font-mono text-xs">
                {project.ownerName}
              </span>
            </div>
          </div>
          {/* Revised in Task 15: this opens FeatureRequestFormDialog instead of navigating. */}
          <FeatureRequestFormDialog
            projectId={project.id}
            trigger={
              <Button className="gap-1.5">
                <Plus className="h-4 w-4" /> New feature request
              </Button>
            }
          />
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterChips value={status} onChange={setStatus} options={statusOptions} />
          <SortSelect value={sort} onChange={setSort} options={featureRequestSortOptions} />
        </div>
        <FeatureRequestList
          projectId={project.id}
          projectOwnerId={project.ownerId}
          status={status}
          sort={sort as "votes" | "newest"}
        />
      </main>
    </div>
  )
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd signal-web && npx vitest run src/pages/ProjectPage.test.tsx`
Expected: PASS

- [ ] **Step 9: Run the full suite to confirm no regressions**

Run: `cd signal-web && npm test`
Expected: all PASS

- [ ] **Step 10: Commit**

```bash
git add signal-web/src/pages/ProjectPage.tsx signal-web/src/pages/ProjectPage.test.tsx signal-web/src/components/feature-requests/FeatureRequestList.tsx signal-web/src/components/feature-requests/FeatureRequestList.test.tsx
git commit -m "feat(web): add gradient hero banner and status filter/sort to ProjectPage"
```

---

## Task 15: feature-request form → `FeatureRequestFormDialog` (modal)

> **Revised:** the `feature-request-create-modal` / `feature-request-edit-modal` mockups show a
> **modal**, not a page. The original `FeatureRequestFormPage` is therefore replaced by one shared
> dialog (mirroring the create/edit mockups) and its routes are removed.

**Files:**
- Add: `signal-web/src/components/feature-requests/FeatureRequestFormDialog.tsx`
- Add: `signal-web/src/components/feature-requests/FeatureRequestFormDialog.test.tsx`
- Modify: `signal-web/src/pages/ProjectPage.tsx` (hero CTA opens the dialog) + `ProjectPage.test.tsx`
- Modify: `signal-web/src/components/feature-requests/FeatureRequestCard.tsx` (edit button opens the dialog)
- Modify: `signal-web/src/components/feature-requests/FeatureRequestList.tsx` (empty-state CTA opens the dialog)
- Modify: `signal-web/src/App.tsx` (drop the two form-page routes)
- Remove: `signal-web/src/pages/FeatureRequestFormPage.tsx` + `FeatureRequestFormPage.test.tsx`

**Interfaces:**
- Consumes: `Dialog`/`DialogContent`/`DialogClose` (`ui/dialog`), `StatusBadge` (Task 2),
  `createFeatureRequest` / `updateFeatureRequest` (`lib/api`).
- Produces: `FeatureRequestFormDialog({ trigger, projectId, featureRequest? })` — create when
  `featureRequest` is absent, edit when present.

- [x] **Step 1: Build `FeatureRequestFormDialog`** — Radix `Dialog` (`max-w-lg rounded-2xl bg-card p-7`),
  top-right bordered close (X), accent eyebrow ("New request" / "Editing your request"), display title
  ("Suggest a feature" / "Edit feature request"), Title `Input` + Description `Textarea`, a status hint
  line (create: "New requests start as [OPEN] — only the project owner can change status"; edit:
  "Current status [StatusBadge] (set by owner)"), and a footer with a `flex-1` "Save request"/"Save
  changes" submit + outline "Cancel" (`DialogClose`). State resets on open; `useMutation` invalidates
  `["featureRequests", projectId]` and closes on success; `ApiError.message` shows inline.

- [x] **Step 2: Wire the triggers** — the `ProjectPage` hero button, the `FeatureRequestList`
  empty-state CTA, and the `FeatureRequestCard` edit button each render the dialog with the appropriate
  `trigger`/props instead of navigating.

- [x] **Step 3: Remove the old page + routes** — delete `FeatureRequestFormPage.tsx`/`.test.tsx` and the
  `/projects/:projectId/feature-requests/new` + `/feature-requests/:id/edit` routes from `App.tsx`.

- [x] **Step 4: Tests** — `FeatureRequestFormDialog.test.tsx` covers create-submit, edit-prefill +
  update-submit, and inline error; `ProjectPage.test.tsx` asserts the hero button opens the modal
  ("Suggest a feature"). Existing `FeatureRequestCard` edit/delete-affordance tests still pass (the edit
  button keeps its `aria-label="Edit feature request"`).

- [x] **Step 5: Final regression gate** — `cd signal-web && npm test -- --run` → all PASS (130);
  `npx tsc --noEmit` → clean.

- [x] **Step 6: Commit**

```bash
git add signal-web/src/components/feature-requests/FeatureRequestFormDialog.tsx \
        signal-web/src/components/feature-requests/FeatureRequestFormDialog.test.tsx \
        signal-web/src/components/feature-requests/FeatureRequestList.tsx \
        signal-web/src/components/feature-requests/FeatureRequestCard.tsx \
        signal-web/src/pages/ProjectPage.tsx signal-web/src/pages/ProjectPage.test.tsx \
        signal-web/src/App.tsx
git rm signal-web/src/pages/FeatureRequestFormPage.tsx signal-web/src/pages/FeatureRequestFormPage.test.tsx
git commit -m "feat(web): convert the feature request form to a modal (light/dark)"
```