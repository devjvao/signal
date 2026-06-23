import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface VoteControlProps {
  count: number
  state: "votable" | "voted" | "own"
  onClick?: () => void
  disabled?: boolean
  className?: string
}

const boxBase = "flex h-auto w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2"
const caption = "w-full text-center font-mono text-[9px] uppercase leading-tight tracking-tight"

export function VoteControl({ count, state, onClick, disabled, className }: VoteControlProps) {
  if (state === "own") {
    return (
      <div className={cn(boxBase, "border border-dashed border-border text-muted-foreground", className)}>
        <span aria-hidden className="text-xs leading-none">▲</span>
        <span className="text-base font-bold leading-none">{count}</span>
        <span className={caption}>Your request</span>
      </div>
    )
  }

  const voted = state === "voted"

  return (
    <Button
      type="button"
      variant={voted ? "default" : "outline"}
      aria-label={voted ? "Remove upvote" : "Upvote"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        boxBase,
        voted
          ? "border-0 bg-[#2563EB] text-white shadow-none hover:bg-[#2563EB]/90"
          : "bg-card text-foreground hover:bg-muted",
        className
      )}
    >
      <span aria-hidden className="text-xs leading-none">▲</span>
      <span className="text-base font-bold leading-none">{count}</span>
      <span className={caption}>votes</span>
    </Button>
  )
}
