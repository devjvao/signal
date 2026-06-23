import { useNavigate } from "react-router-dom"

import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { useAuth } from "@/context/AuthContext"

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return (first + last).toUpperCase()
}

/** Global top navbar shown on every authenticated page: logo, user identity, theme toggle, log out. */
export function AppHeader() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate("/login")
  }

  return (
    <header className="border-b border-border bg-background dark:bg-card">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
        <Logo />
        {user && (
          <div className="flex items-center gap-4">
            <div className="hidden flex-col items-end leading-tight sm:flex">
              <span className="text-sm font-semibold">{user.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{user.email}</span>
            </div>
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-mono text-xs font-semibold text-primary-foreground"
            >
              {getInitials(user.name)}
            </span>
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
