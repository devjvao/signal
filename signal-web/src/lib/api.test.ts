import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, clearToken, getMe, getToken, listMyProjects, listProjects, login, register, setToken } from "./api"

const originalFetch = globalThis.fetch

beforeEach(() => {
  localStorage.clear()
  globalThis.fetch = vi.fn()
})

afterEach(() => {
  globalThis.fetch = originalFetch
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
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(201, { user }))

    const result = await register("Ada Lovelace", "ada@example.com", "correct-horse-battery")

    expect(result.user).toEqual(user)
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/auth/register")
    expect(JSON.parse(options?.body as string)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
    })
  })

  it("throws an ApiError with the server message on failure", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(409, { error: "email is already registered" }))

    await expect(register("Ada Lovelace", "ada@example.com", "correct-horse-battery")).rejects.toMatchObject({
      status: 409,
      message: "email is already registered",
    })
  })
})

describe("login", () => {
  it("posts to /auth/login and returns the token and user", async () => {
    const user = { id: "1", name: "Ada Lovelace", email: "ada@example.com", createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { token: "jwt-token", user }))

    const result = await login("ada@example.com", "correct-horse-battery")

    expect(result).toEqual({ token: "jwt-token", user })
  })

  it("throws an ApiError on invalid credentials", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(401, { error: "invalid email or password" }))

    await expect(login("ada@example.com", "wrong-password")).rejects.toBeInstanceOf(ApiError)
  })
})

describe("getMe", () => {
  it("sends the stored token as a bearer header", async () => {
    setToken("stored-token")
    const user = { id: "1", name: "Ada Lovelace", email: "ada@example.com", createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { user }))

    await getMe()

    const [, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    const headers = options?.headers as Record<string, string>
    expect(headers["Authorization"]).toBe("Bearer stored-token")
  })
})

describe("listProjects", () => {
  it("requests /projects with no query string by default", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { projects: [], nextCursor: null }))

    await listProjects()

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/projects")
    expect(url).not.toContain("?")
  })

  it("includes cursor and limit when provided", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { projects: [], nextCursor: null }))

    await listProjects({ cursor: "abc", limit: 5 })

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("cursor=abc")
    expect(url).toContain("limit=5")
  })

  it("returns the parsed projects page", async () => {
    const page = { projects: [{ id: "1", name: "Signal", slug: "signal", description: null, ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" }], nextCursor: "next" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, page))

    const result = await listProjects()

    expect(result).toEqual(page)
  })
})

describe("listMyProjects", () => {
  it("requests /projects/mine", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { projects: [], nextCursor: null }))

    await listMyProjects()

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/projects/mine")
  })
})
