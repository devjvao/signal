import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { cn } from "@/lib/utils"

// Lowercase canonical labels — kept stable; DOM text stays lowercase so tests assert getByText("open").
export const statusLabels: Record<string, string> = {
  open: "open",
  planned: "planned",
  in_progress: "in progress",
  completed: "completed",
  rejected: "rejected",
}

export const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }))

// Title/sentence-case labels for menus and filter chips (display only — never the value).
export const statusDisplayLabels: Record<string, string> = {
  open: "Open",
  planned: "Planned",
  in_progress: "In progress",
  completed: "Completed",
  rejected: "Rejected",
}

export const statusDisplayOptions = statusOptions.map((o) => ({
  value: o.value,
  label: statusDisplayLabels[o.value] ?? o.label,
}))

const statusDotClasses: Record<string, string> = {
  open: "bg-status-open",
  planned: "bg-status-planned",
  in_progress: "bg-status-in-progress",
  completed: "bg-status-completed",
  rejected: "bg-status-rejected",
}

const statusTintClasses: Record<string, string> = {
  open: "bg-status-open/15 text-status-open",
  planned: "bg-status-planned/15 text-status-planned",
  in_progress: "bg-status-in-progress/15 text-status-in-progress",
  completed: "bg-status-completed/15 text-status-completed",
  rejected: "bg-status-rejected/15 text-status-rejected",
}

const statusCheckedTint: Record<string, string> = {
  open: "data-[state=checked]:bg-status-open/10",
  planned: "data-[state=checked]:bg-status-planned/10",
  in_progress: "data-[state=checked]:bg-status-in-progress/10",
  completed: "data-[state=checked]:bg-status-completed/10",
  rejected: "data-[state=checked]:bg-status-rejected/10",
}

const pill = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"

interface StatusBadgeProps {
  status: string
  editable?: boolean
  onStatusChange?: (status: string) => void
  disabled?: boolean
  className?: string
}

export function StatusBadge({ status, editable = false, onStatusChange, disabled, className }: StatusBadgeProps) {
  const dotClass = statusDotClasses[status] ?? "bg-muted-foreground"
  const tintClass = statusTintClasses[status] ?? "bg-muted text-muted-foreground"
  const label = statusLabels[status] ?? status

  if (editable) {
    return (
      <Select value={status} onValueChange={onStatusChange} disabled={disabled}>
        <SelectTrigger aria-label="Status" className={cn(pill, tintClass, "border-0", className)}>
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
          <span>{label}</span>
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value} className={cn("font-mono", statusCheckedTint[option.value])}>
              <span className="flex items-center gap-2">
                <span aria-hidden className={cn("h-2 w-2 rounded-full", statusDotClasses[option.value])} />
                {statusDisplayLabels[option.value] ?? option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <span className={cn(pill, tintClass, className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
      {label}
    </span>
  )
}
