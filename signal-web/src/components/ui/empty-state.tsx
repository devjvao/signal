import type { ReactNode } from "react"

import { Logo } from "@/components/brand/logo"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  title: string
  description: string
  action?: ReactNode
  className?: string
}

/** Dashed-border placeholder with the brand chevron, a title, supporting copy, and an optional CTA. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center",
        className
      )}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Logo lockup="icon" size="default" />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-xl font-bold">{title}</h3>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}
