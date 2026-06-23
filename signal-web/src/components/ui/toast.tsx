import { Check, X } from "lucide-react"
import { useEffect } from "react"

import { cn } from "@/lib/utils"

interface ToastProps {
  title: string
  description?: string
  onDismiss: () => void
  durationMs?: number
  variant?: "success" | "error"
}

export function Toast({ title, description, onDismiss, durationMs = 3000, variant = "success" }: ToastProps) {
  useEffect(() => {
    const timeout = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timeout)
  }, [onDismiss, durationMs])

  const isError = variant === "error"

  return (
    <div
      role={isError ? "alert" : "status"}
      // Inverted card: dark in light theme, pale in dark theme — matches the mock.
      // z above the dialog overlay (z-50) so a failure toast stays visible over an open modal.
      className="fixed bottom-6 right-6 z-[100] flex items-center gap-3 rounded-2xl bg-ink px-5 py-4 text-white shadow-xl dark:bg-[#EAF1FC] dark:text-ink"
    >
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white",
          isError ? "bg-red-500" : "bg-green-500"
        )}
      >
        {isError ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
      </span>
      <div className="flex flex-col">
        <span className="font-display text-sm font-bold">{title}</span>
        {description && (
          <span className="font-mono text-xs text-slate-300 dark:text-slate-600">{description}</span>
        )}
      </div>
    </div>
  )
}
