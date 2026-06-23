import { createContext, useCallback, useContext, useRef, useState } from "react"
import type { ReactNode } from "react"

import { Toast } from "@/components/ui/toast"

interface ToastOptions {
  variant?: "success" | "error"
  title: string
  description?: string
}

interface ActiveToast extends ToastOptions {
  id: number
}

interface ToastContextValue {
  showToast: (toast: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null)
  const idRef = useRef(0)

  const showToast = useCallback((options: ToastOptions) => {
    setToast({ ...options, id: idRef.current++ })
  }, [])

  const dismiss = useCallback(() => setToast(null), [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Toast
          key={toast.id}
          variant={toast.variant}
          title={toast.title}
          description={toast.description}
          onDismiss={dismiss}
        />
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return context
}
