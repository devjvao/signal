# User Authentication (signal-web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add registration and login pages, an auth context, and a route guard to `signal-web` so the main page redirects unauthenticated visitors to `/login`.

**Architecture:** A `fetch`-based API client talks to the routes documented in `contracts/auth-api.md`. An `AuthContext` holds the JWT (in `localStorage`) and the current user, hydrating from `GET /auth/me` on load. A `ProtectedRoute` component reads that context and redirects to `/login` when unauthenticated. `react-router-dom` provides the route table.

**Tech Stack:** React 19, TypeScript ~6.0.2, Vite 8, Tailwind CSS, react-router-dom 7, vitest 4 + @testing-library/react 16 (new test tooling — none exists in this project yet).

## Global Constraints

- All API requests/responses follow `contracts/auth-api.md` and `contracts/entities.md` at the
  repo root exactly — `camelCase` JSON keys, error bodies shaped `{"error": "<message>"}`. If
  anything here seems to contradict those files, stop and report it rather than resolving it
  unilaterally.
- `tsconfig.app.json` has `verbatimModuleSyntax: true` — every type-only import must use `import
  type { X }` or the inline `type` modifier (e.g. `import { type User, login }`). It also has
  `noUnusedLocals`/`noUnusedParameters: true` — no unused imports or variables — and
  `erasableSyntaxOnly: true` — no TS features that require runtime transforms (no `enum`, no
  parameter-property shorthand in constructors).
- Path alias `@/*` maps to `src/*` (see `vite.config.ts` and `tsconfig.app.json`); use it for all
  intra-`src` imports, matching the existing `@/components/...`, `@/lib/...` style.
- New UI primitives follow the existing shadcn-style pattern in
  `src/components/ui/button.tsx`: `React.forwardRef`, a `displayName`, props built from the
  relevant `React.*HTMLAttributes` type, styled with Tailwind classes via the `cn()` helper from
  `@/lib/utils`.
- No full-page UI tests in this feature (an explicit scope decision) — automated tests cover the
  `AuthContext` and `ProtectedRoute` logic; the three pages (`LoginPage`, `RegisterPage`,
  `MainPage`) are verified manually via the dev server.
- Commit messages follow `CONVENTIONAL_COMMIT_GUIDELINE.md`: `type(web): summary`, imperative,
  lowercase, no trailing period, no `Co-authored-by` trailer.
- Run all commands below from the `signal-web/` directory.

---

### Task 1: Test tooling (vitest + React Testing Library)

**Files:**
- Modify: `signal-web/package.json` (and `package-lock.json` via `npm install`)
- Modify: `signal-web/vite.config.ts`
- Create: `signal-web/src/test/setup.ts`
- Create: `signal-web/src/lib/utils.test.ts`

**Interfaces:**
- Produces: a working `npm run test` command; `src/test/setup.ts` (vitest setup file, referenced
  by `vite.config.ts`)

- [ ] **Step 1: Install the test dependencies**

```bash
npm install -D vitest@4.1.9 @testing-library/react@16.3.2 @testing-library/jest-dom@6.9.1 @testing-library/user-event@14.6.1 jsdom@29.1.1
```
Expected: `package.json` devDependencies gain these 5 packages.

- [ ] **Step 2: Configure vitest in vite.config.ts**

```ts
// signal-web/vite.config.ts
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
})
```

Note the import changes from `"vite"` to `"vitest/config"` — `vitest/config`'s `defineConfig` is a
superset that also types the `test` field; every other option behaves identically.

- [ ] **Step 3: Add the setup file and the test script**

```ts
// signal-web/src/test/setup.ts
import "@testing-library/jest-dom/vitest"
```

Add to `package.json` `scripts`:
```json
"test": "vitest run"
```

- [ ] **Step 4: Write a real test for the existing `cn()` helper**

`cn()` already exists in `src/lib/utils.ts` with no test coverage — this is the first test added
to the project, and a genuine gap worth closing while the test harness goes in.

```ts
// signal-web/src/lib/utils.test.ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test`
Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/test/setup.ts src/lib/utils.test.ts
git commit -m "test(web): add vitest and react testing library"
```

---

### Task 2: API client

**Files:**
- Create: `signal-web/src/vite-env.d.ts`
- Create: `signal-web/src/lib/api.ts`
- Create: `signal-web/src/lib/api.test.ts`
- Modify: `signal-web/.env.example` (create it if it doesn't already exist)

**Interfaces:**
- Produces: `User { id, name, email, createdAt: string }`; `ApiError extends Error { status:
  number }`; `getToken(): string | null`; `setToken(token: string): void`; `clearToken(): void`;
  `register(name, email, password): Promise<{ user: User }>`; `login(email, password):
  Promise<{ token: string; user: User }>`; `getMe(): Promise<{ user: User }>`

- [ ] **Step 1: Declare the `VITE_API_URL` env var type**

```ts
// signal-web/src/vite-env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
}
```

- [ ] **Step 2: Write the failing test**

```ts
// signal-web/src/lib/api.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, clearToken, getMe, getToken, login, register, setToken } from "./api"

const originalFetch = global.fetch

beforeEach(() => {
  localStorage.clear()
  global.fetch = vi.fn()
})

afterEach(() => {
  global.fetch = originalFetch
})

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe("token storage", () => {
  it("returns null when no token is stored", () => {
    expect(getToken()).toBeNull()
  })

  it("stores and clears a token", () => {
    setToken("abc")
    expect(getToken()).toBe("abc")
    clearToken()
    expect(getToken()).toBeNull()
  })
})

describe("register", () => {
  it("posts to /auth/register and returns the created user", async () => {
    const user = { id: "1", name: "Ada Lovelace", email: "ada@example.com", createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(201, { user }))

    const result = await register("Ada Lovelace", "ada@example.com", "correct-horse-battery")

    expect(result.user).toEqual(user)
    const [url, options] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toContain("/auth/register")
    expect(JSON.parse(options?.body as string)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
    })
  })

  it("throws an ApiError with the server message on failure", async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(409, { error: "email is already registered" }))

    await expect(register("Ada Lovelace", "ada@example.com", "correct-horse-battery")).rejects.toMatchObject({
      status: 409,
      message: "email is already registered",
    })
  })
})

describe("login", () => {
  it("posts to /auth/login and returns the token and user", async () => {
    const user = { id: "1", name: "Ada Lovelace", email: "ada@example.com", createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, { token: "jwt-token", user }))

    const result = await login("ada@example.com", "correct-horse-battery")

    expect(result).toEqual({ token: "jwt-token", user })
  })

  it("throws an ApiError on invalid credentials", async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(401, { error: "invalid email or password" }))

    await expect(login("ada@example.com", "wrong-password")).rejects.toBeInstanceOf(ApiError)
  })
})

describe("getMe", () => {
  it("sends the stored token as a bearer header", async () => {
    setToken("stored-token")
    const user = { id: "1", name: "Ada Lovelace", email: "ada@example.com", createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, { user }))

    await getMe()

    const [, options] = vi.mocked(global.fetch).mock.calls[0]
    const headers = options?.headers as Record<string, string>
    expect(headers["Authorization"]).toBe("Bearer stored-token")
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- src/lib/api.test.ts`
Expected: FAIL — `Cannot find module './api'`

- [ ] **Step 4: Write the implementation**

```ts
// signal-web/src/lib/api.ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080"
const TOKEN_KEY = "signal_token"

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "ApiError"
  }
}

interface ErrorBody {
  error?: string
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers })
  const body: unknown = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = (body as ErrorBody).error ?? "request failed"
    throw new ApiError(response.status, message)
  }

  return body as T
}

export interface User {
  id: string
  name: string
  email: string
  createdAt: string
}

export function register(
  name: string,
  email: string,
  password: string
): Promise<{ user: User }> {
  return request<{ user: User }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  })
}

export function login(
  email: string,
  password: string
): Promise<{ token: string; user: User }> {
  return request<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
}

export function getMe(): Promise<{ user: User }> {
  return request<{ user: User }>("/auth/me")
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/lib/api.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Add the env var to `.env.example`**

```
VITE_API_URL=http://localhost:8080
```

- [ ] **Step 7: Commit**

```bash
git add src/vite-env.d.ts src/lib/api.ts src/lib/api.test.ts .env.example
git commit -m "feat(web): add auth api client"
```

---

### Task 3: AuthContext

**Files:**
- Create: `signal-web/src/context/AuthContext.tsx`
- Create: `signal-web/src/context/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `getToken`, `setToken`, `clearToken`, `login`, `register`, `getMe`, `User`, `ApiError`
  from `@/lib/api` (Task 2)
- Produces: `AuthProvider({ children }: { children: ReactNode })`, `useAuth(): { status: "loading"
  | "authenticated" | "unauthenticated"; user: User | null; login(email, password): Promise<void>;
  register(name, email, password): Promise<void>; logout(): void }`

- [ ] **Step 1: Write the failing tests**

```tsx
// signal-web/src/context/AuthContext.test.tsx
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import { AuthProvider, useAuth } from "./AuthContext"

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    getToken: vi.fn(),
    setToken: vi.fn(),
    clearToken: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
  }
})

const mockUser: api.User = {
  id: "1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  createdAt: "2026-06-21T00:00:00Z",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("AuthProvider", () => {
  it("starts unauthenticated when there is no stored token", async () => {
    vi.mocked(api.getToken).mockReturnValue(null)

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await waitFor(() => expect(result.current.status).toBe("unauthenticated"))
    expect(result.current.user).toBeNull()
  })

  it("hydrates the user when a stored token is valid", async () => {
    vi.mocked(api.getToken).mockReturnValue("stored-token")
    vi.mocked(api.getMe).mockResolvedValue({ user: mockUser })

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await waitFor(() => expect(result.current.status).toBe("authenticated"))
    expect(result.current.user).toEqual(mockUser)
  })

  it("clears the stored token when it is invalid", async () => {
    vi.mocked(api.getToken).mockReturnValue("stale-token")
    vi.mocked(api.getMe).mockRejectedValue(new api.ApiError(401, "unauthorized"))

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await waitFor(() => expect(result.current.status).toBe("unauthenticated"))
    expect(api.clearToken).toHaveBeenCalled()
  })

  it("logs in and stores the token", async () => {
    vi.mocked(api.getToken).mockReturnValue(null)
    vi.mocked(api.login).mockResolvedValue({ token: "new-token", user: mockUser })

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"))

    await act(async () => {
      await result.current.login("ada@example.com", "correct-horse-battery")
    })

    expect(api.setToken).toHaveBeenCalledWith("new-token")
    expect(result.current.status).toBe("authenticated")
    expect(result.current.user).toEqual(mockUser)
  })

  it("registers without changing auth status", async () => {
    vi.mocked(api.getToken).mockReturnValue(null)
    vi.mocked(api.register).mockResolvedValue({ user: mockUser })

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"))

    await act(async () => {
      await result.current.register("Ada Lovelace", "ada@example.com", "correct-horse-battery")
    })

    expect(api.register).toHaveBeenCalledWith("Ada Lovelace", "ada@example.com", "correct-horse-battery")
    expect(result.current.status).toBe("unauthenticated")
  })

  it("logs out and clears the token", async () => {
    vi.mocked(api.getToken).mockReturnValue("stored-token")
    vi.mocked(api.getMe).mockResolvedValue({ user: mockUser })

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.status).toBe("authenticated"))

    act(() => {
      result.current.logout()
    })

    expect(api.clearToken).toHaveBeenCalled()
    expect(result.current.status).toBe("unauthenticated")
    expect(result.current.user).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/context/AuthContext.test.tsx`
Expected: FAIL — `Cannot find module './AuthContext'`

- [ ] **Step 3: Write the implementation**

```tsx
// signal-web/src/context/AuthContext.tsx
import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"

import {
  clearToken,
  getMe,
  getToken,
  login as loginRequest,
  register as registerRequest,
  setToken,
  type User,
} from "@/lib/api"

type AuthStatus = "loading" | "authenticated" | "unauthenticated"

interface AuthContextValue {
  status: AuthStatus
  user: User | null
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setStatus("unauthenticated")
      return
    }

    getMe()
      .then(({ user: fetchedUser }) => {
        setUser(fetchedUser)
        setStatus("authenticated")
      })
      .catch(() => {
        clearToken()
        setStatus("unauthenticated")
      })
  }, [])

  async function login(email: string, password: string) {
    const { token, user: loggedInUser } = await loginRequest(email, password)
    setToken(token)
    setUser(loggedInUser)
    setStatus("authenticated")
  }

  async function register(name: string, email: string, password: string) {
    await registerRequest(name, email, password)
  }

  function logout() {
    clearToken()
    setUser(null)
    setStatus("unauthenticated")
  }

  return (
    <AuthContext.Provider value={{ status, user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/context/AuthContext.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/context/AuthContext.tsx src/context/AuthContext.test.tsx
git commit -m "feat(web): add auth context"
```

---

### Task 4: ProtectedRoute

**Files:**
- Create: `signal-web/src/components/auth/ProtectedRoute.tsx`
- Create: `signal-web/src/components/auth/ProtectedRoute.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3)
- Produces: `ProtectedRoute({ children }: { children: ReactNode })`

- [ ] **Step 1: Write the failing tests**

```tsx
// signal-web/src/components/auth/ProtectedRoute.test.tsx
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import { ProtectedRoute } from "./ProtectedRoute"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return {
    ...actual,
    useAuth: vi.fn(),
  }
})

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <div>secret content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe("ProtectedRoute", () => {
  it("renders nothing while loading", () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "loading",
      user: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })

    renderProtected()
    expect(screen.queryByText("secret content")).not.toBeInTheDocument()
    expect(screen.queryByText("login page")).not.toBeInTheDocument()
  })

  it("redirects to /login when unauthenticated", () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "unauthenticated",
      user: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })

    renderProtected()
    expect(screen.getByText("login page")).toBeInTheDocument()
  })

  it("renders its children when authenticated", () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      status: "authenticated",
      user: { id: "1", name: "Ada Lovelace", email: "ada@example.com", createdAt: "2026-06-21T00:00:00Z" },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })

    renderProtected()
    expect(screen.getByText("secret content")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm install react-router-dom@7.18.0 && npm run test -- src/components/auth/ProtectedRoute.test.tsx`
Expected: FAIL — `Cannot find module './ProtectedRoute'`

- [ ] **Step 3: Write the implementation**

```tsx
// signal-web/src/components/auth/ProtectedRoute.tsx
import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"

import { useAuth } from "@/context/AuthContext"

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth()

  if (status === "loading") {
    return null
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />
  }

  return children
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/components/auth/ProtectedRoute.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/auth/ProtectedRoute.tsx src/components/auth/ProtectedRoute.test.tsx
git commit -m "feat(web): add protected route guard"
```

---

### Task 5: Input and Label primitives

**Files:**
- Create: `signal-web/src/components/ui/input.tsx`
- Create: `signal-web/src/components/ui/input.test.tsx`
- Create: `signal-web/src/components/ui/label.tsx`
- Create: `signal-web/src/components/ui/label.test.tsx`

**Interfaces:**
- Produces: `Input` (forwards `React.InputHTMLAttributes<HTMLInputElement>` to a styled
  `<input>`), `Label` (forwards `React.LabelHTMLAttributes<HTMLLabelElement>` to a styled
  `<label>`) — both used by `LoginPage` and `RegisterPage` (Tasks 6–7)

- [ ] **Step 1: Write the failing tests**

```tsx
// signal-web/src/components/ui/input.test.tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Input } from "./input"

describe("Input", () => {
  it("renders an input and forwards props", () => {
    render(<Input aria-label="email" placeholder="Email" />)
    const input = screen.getByLabelText("email")
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute("placeholder", "Email")
  })
})
```

```tsx
// signal-web/src/components/ui/label.test.tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Label } from "./label"

describe("Label", () => {
  it("renders its children and an htmlFor attribute", () => {
    render(<Label htmlFor="email">Email</Label>)
    const label = screen.getByText("Email")
    expect(label).toBeInTheDocument()
    expect(label).toHaveAttribute("for", "email")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/components/ui/input.test.tsx src/components/ui/label.test.tsx`
Expected: FAIL — `Cannot find module './input'` / `Cannot find module './label'`

- [ ] **Step 3: Write the implementations**

```tsx
// signal-web/src/components/ui/input.tsx
import * as React from "react"

import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
```

```tsx
// signal-web/src/components/ui/label.tsx
import * as React from "react"

import { cn } from "@/lib/utils"

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => {
    return (
      <label
        className={cn(
          "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Label.displayName = "Label"

export { Label }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/components/ui/input.test.tsx src/components/ui/label.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/input.tsx src/components/ui/input.test.tsx src/components/ui/label.tsx src/components/ui/label.test.tsx
git commit -m "feat(web): add input and label primitives"
```

---

### Task 6: LoginPage

**Files:**
- Create: `signal-web/src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3), `Button` (existing), `Input`/`Label` (Task 5), `ApiError` (Task 2)
- Produces: `export default function LoginPage()`

No automated test for this task (page-level UI tests are out of scope — see Global Constraints);
verify manually in Step 2.

- [ ] **Step 1: Write the implementation**

```tsx
// signal-web/src/pages/LoginPage.tsx
import { useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext"
import { ApiError } from "@/lib/api"

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await login(email, password)
      navigate("/")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Log in</h1>
      <form className="flex w-full max-w-sm flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Logging in..." : "Log in"}
        </Button>
      </form>
      <Button variant="outline" onClick={() => navigate("/register")}>
        Register
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Manual verification**

This page isn't wired into routing until Task 9. Defer the visual check to Task 9's manual
verification, which exercises this page as part of the full flow. For now just confirm it compiles:

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/LoginPage.tsx
git commit -m "feat(web): add login page"
```

---

### Task 7: RegisterPage

**Files:**
- Create: `signal-web/src/pages/RegisterPage.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3), `Button` (existing), `Input`/`Label` (Task 5), `ApiError` (Task 2)
- Produces: `export default function RegisterPage()`

- [ ] **Step 1: Write the implementation**

```tsx
// signal-web/src/pages/RegisterPage.tsx
import { useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext"
import { ApiError } from "@/lib/api"

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await register(name, email, password)
      navigate("/login")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Register</h1>
      <form className="flex w-full max-w-sm flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" required value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating account..." : "Create account"}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Compile check**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/RegisterPage.tsx
git commit -m "feat(web): add register page"
```

---

### Task 8: MainPage

**Files:**
- Create: `signal-web/src/pages/MainPage.tsx`
- Modify: `signal-web/src/App.tsx` (only to stop it being the page itself — full route wiring
  happens in Task 9; for now just leave `App.tsx` rendering `MainPage` directly so the app keeps
  building)

**Interfaces:**
- Consumes: `useAuth` (Task 3), existing `Button`, existing `Logo`
- Produces: `export default function MainPage()`

- [ ] **Step 1: Move the landing content into MainPage.tsx, extended with user info and logout**

```tsx
// signal-web/src/pages/MainPage.tsx
import { useNavigate } from "react-router-dom"

import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"

export default function MainPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

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
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        )}
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Signal</h1>
        <Button>Get Started</Button>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Point App.tsx at it temporarily**

```tsx
// signal-web/src/App.tsx
import MainPage from "@/pages/MainPage"

export default function App() {
  return <MainPage />
}
```

This is intentionally temporary — Task 9 replaces this with the real route table. It exists so the
app still builds and runs after this task on its own.

- [ ] **Step 3: Compile check**

Run: `npx tsc -b`
Expected: no errors (note: `MainPage` calling `useAuth()` requires an `AuthProvider` ancestor to
render without throwing at runtime — that's wired up in Task 9's `main.tsx` change; a plain
compile check is the right verification for this task in isolation)

- [ ] **Step 4: Commit**

```bash
git add src/pages/MainPage.tsx src/App.tsx
git commit -m "feat(web): add main page with user info and logout"
```

---

### Task 9: Wire routing and AuthProvider

**Files:**
- Modify: `signal-web/src/main.tsx`
- Modify: `signal-web/src/App.tsx`

**Interfaces:**
- Consumes: `AuthProvider` (Task 3), `ProtectedRoute` (Task 4), `LoginPage` (Task 6),
  `RegisterPage` (Task 7), `MainPage` (Task 8)
- Produces: the final route table — `/` (guarded, renders `MainPage`), `/login` (`LoginPage`),
  `/register` (`RegisterPage`)

- [ ] **Step 1: Wrap the app in BrowserRouter and AuthProvider**

```tsx
// signal-web/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/context/AuthContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 2: Replace App.tsx with the real route table**

```tsx
// signal-web/src/App.tsx
import { Route, Routes } from "react-router-dom"

import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import LoginPage from "@/pages/LoginPage"
import MainPage from "@/pages/MainPage"
import RegisterPage from "@/pages/RegisterPage"

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainPage />
          </ProtectedRoute>
        }
      />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
    </Routes>
  )
}
```

- [ ] **Step 3: Run the full test suite and the build**

Run: `npm run test && npx tsc -b && npm run lint`
Expected: all tests pass, no type errors, no lint errors (warnings on `logo.tsx`/`button.tsx`
about fast-refresh are pre-existing and unrelated to this change)

- [ ] **Step 4: Manual end-to-end verification**

Run: `npm run dev`, then open the printed local URL in a browser.

If `signal-api` is also running locally (`go run ./cmd/api` from `signal-api/`, with `DB_URL` and
`JWT_SECRET` set and migrations applied) and `VITE_API_URL` points at it, exercise the full flow:
1. Visit `/` with no stored token → redirected to `/login`.
2. Click "Register" → fill the form → submit → redirected to `/login`.
3. Log in with the same credentials → redirected to `/` → see your name/email and a "Log out"
   button.
4. Click "Log out" → redirected to `/login`; visiting `/` again redirects back to `/login`.

If `signal-api` isn't reachable yet, at minimum confirm: visiting `/login` and `/register` render
without runtime errors, and visiting `/` redirects to `/login` (the guard works even without a
live API, since there's no token to validate). Do the full live-API walkthrough once both halves
of this feature are merged.

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx src/App.tsx
git commit -m "feat(web): wire auth routing and provider"
```