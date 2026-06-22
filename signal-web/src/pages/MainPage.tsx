import { useNavigate } from "react-router-dom"

import { Logo } from "@/components/brand/logo"
import { ProjectList } from "@/components/projects/ProjectList"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
      <main className="flex flex-1 flex-col gap-6 px-6 py-8">
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All projects</TabsTrigger>
            <TabsTrigger value="mine">My projects</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <ProjectList scope="all" />
          </TabsContent>
          <TabsContent value="mine">
            <ProjectList scope="mine" />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}