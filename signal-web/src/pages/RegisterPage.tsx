import { useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "react-router-dom"

import { AuthHero } from "@/components/auth/AuthHero"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext"
import { useToast } from "@/context/ToastContext"
import { ApiError } from "@/lib/api"

export default function RegisterPage() {
  const { register } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      await register(name, email, password)
      navigate("/login")
    } catch (err) {
      showToast({
        variant: "error",
        title: "Couldn't create account",
        description: err instanceof ApiError ? err.message : "something went wrong",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

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
            <Button type="submit" className="w-full shadow-lg shadow-primary/30" disabled={isSubmitting}>
              {isSubmitting ? "Creating account..." : "Create account"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="font-semibold text-primary hover:underline"
            >
              Log in
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
