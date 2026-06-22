import { Button } from "@/components/ui/button"
import { Logo } from "@/components/brand/logo"

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background px-6 py-4">
        <Logo />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">
          Signal
        </h1>
        <Button>Get Started</Button>
      </main>
    </div>
  )
}
