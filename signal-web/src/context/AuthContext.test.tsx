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
