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
