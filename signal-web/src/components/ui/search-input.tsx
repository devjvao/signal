import { Search } from "lucide-react"
import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)

  // Resync the draft when the value prop changes externally. This is the
  // React-recommended render-time adjustment, not a setState-in-effect.
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(value)
  }

  useEffect(() => {
    if (draft === value) return
    const timeout = setTimeout(() => onChange(draft), 300)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Search projects"
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="pl-9"
      />
    </div>
  )
}