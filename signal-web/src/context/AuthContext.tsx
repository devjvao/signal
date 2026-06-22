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
  const [status, setStatus] = useState<AuthStatus>(() =>
    getToken() ? "loading" : "unauthenticated"
  )
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const token = getToken()
    if (!token) {
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
