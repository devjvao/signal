import { Logo } from "@/components/brand/logo"
import { cn } from "@/lib/utils"

interface AuthHeroProps {
  eyebrow: string
  headline: string
  /** "navy" (Login) or "teal" (Register). The teal variant darkens in dark mode to match the mock. */
  tone?: "navy" | "teal"
}

// Fixed-token gradients (not theme-dependent `primary`/`accent`) so the hero matches the mock.
const toneGradients: Record<NonNullable<AuthHeroProps["tone"]>, string> = {
  navy: "from-ink via-deep to-[#2563EB]",
  teal: "from-[#14C8C8] via-[#1E8FD0] to-[#2563EB] dark:from-[#0C6B6B] dark:via-[#114B7A] dark:to-ink",
}

/**
 * Gradient split-screen hero used on the left of the Login and Register pages:
 * a brand gradient, white logo, and a faint ascending-chevron motif.
 */
export function AuthHero({ eyebrow, headline, tone = "navy" }: AuthHeroProps) {
  return (
    <div
      className={cn(
        "relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br p-10 text-white lg:flex",
        toneGradients[tone]
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute -bottom-12 -right-8 h-[32rem] w-[32rem] text-white/10"
      >
        <polyline points="14,50 32,38 50,50" />
        <polyline points="14,38 32,26 50,38" />
        <polyline points="14,26 32,14 50,26" />
      </svg>
      <Logo inverted className="relative" />
      <div className="relative flex max-w-lg flex-col gap-3">
        <span className="font-mono text-xs uppercase tracking-widest text-white/70">{eyebrow}</span>
        <h2 className="font-display text-7xl font-extrabold leading-[1.05] tracking-tight">{headline}</h2>
      </div>
      <span className="relative" />
    </div>
  )
}