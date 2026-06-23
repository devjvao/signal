import { cn } from "@/lib/utils"

export interface FilterChipOption {
  value: string
  label: string
}

interface FilterChipsProps {
  value: string | null
  onChange: (value: string | null) => void
  options: FilterChipOption[]
  allLabel?: string
}

function chipClass(active: boolean) {
  return cn(
    "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
    active
      ? "border-white/20 bg-ink text-white"
      : "border-border bg-card text-foreground hover:bg-muted"
  )
}

export function FilterChips({ value, onChange, options, allLabel = "All" }: FilterChipsProps) {
  return (
    <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={chipClass(value === null)}>
        {allLabel}
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={chipClass(value === option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}