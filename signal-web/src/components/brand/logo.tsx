import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import signalIcon from "@/assets/signal-icon.svg"
import signalIconDark from "@/assets/signal-icon-dark.svg"
import { cn } from "@/lib/utils"

const logoVariants = cva("inline-flex items-center", {
  variants: {
    lockup: {
      horizontal: "flex-row",
      stacked: "flex-col",
      icon: "flex-row",
    },
    size: {
      sm: "gap-1.5",
      default: "gap-2",
      lg: "gap-3",
    },
  },
  defaultVariants: {
    lockup: "horizontal",
    size: "default",
  },
})

const iconSizes = {
  sm: "h-6 w-6",
  default: "h-8 w-8",
  lg: "h-12 w-12",
} as const

const wordmarkSizes = {
  sm: "text-lg",
  default: "text-2xl",
  lg: "text-4xl",
} as const

export interface LogoProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof logoVariants> {}

function Logo({
  className,
  lockup = "horizontal",
  size = "default",
  ...props
}: LogoProps) {
  const resolvedSize = size ?? "default"

  return (
    <div
      className={cn(logoVariants({ lockup, size }), className)}
      {...props}
    >
      <img
        src={signalIcon}
        alt=""
        className={cn(iconSizes[resolvedSize], "dark:hidden")}
      />
      <img
        src={signalIconDark}
        alt=""
        className={cn(iconSizes[resolvedSize], "hidden dark:block")}
      />
      {lockup !== "icon" && (
        <span
          className={cn(
            "font-display font-extrabold tracking-tight text-foreground",
            wordmarkSizes[resolvedSize]
          )}
        >
          Signal
        </span>
      )}
    </div>
  )
}

export { Logo, logoVariants }