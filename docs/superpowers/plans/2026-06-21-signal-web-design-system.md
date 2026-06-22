# Signal Web — Brand Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Signal's brand identity (colors, typography, logo, favicon) to the `signal-web` Vite + React + TypeScript app, replacing the generic shadcn "slate" defaults.

**Architecture:** Pure design-system layer on top of the existing shadcn/ui-style scaffold — change HSL CSS-variable values consumed by `tailwind.config.js`, add self-hosted brand fonts, add one new `Logo` component (CVA-driven, matching `Button`'s pattern), add one new `Button` variant, and wire the result into `App.tsx` and the favicon/app-icon links. No new component primitives, no theme-toggle UI, no backend changes.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind CSS (HSL CSS-variable tokens), `class-variance-authority` + `clsx` + `tailwind-merge`, `@fontsource/nunito`, `@fontsource/ibm-plex-mono`.

## Global Constraints

- Keep the existing color-token architecture exactly as-is: HSL values in CSS custom properties under `:root` / `.dark` in `signal-web/src/index.css`, consumed through `tailwind.config.js` `theme.extend.colors`. Only the HSL *values* change — no new token names, no new consumption mechanism.
- Fonts must be self-hosted via `@fontsource/*` packages (no external/CDN font loading, no FOUC risk).
- Do not add component primitives beyond `Button` (no new shadcn-style components in this pass) and do not add any dark-mode toggle UI — dark mode must render correctly only via the `.dark` class already present in the codebase; nothing in this plan flips that class at runtime.
- This repo has no automated test framework configured (no `vitest`/`jest` in `signal-web/package.json`). Every task's verification step is `npm run build` (`tsc -b && vite build`), `npm run lint`, and a manual visual check in a running `npm run dev` session — exactly as specified in the design doc's own Testing Plan. Do not introduce a test framework as part of this plan.
- Commits in this repo must follow `CONVENTIONAL_COMMIT_GUIDELINE.md`: Conventional Commits format, **no** `Co-Authored-By` or other AI-attribution trailers.
- All file paths below are relative to the repo root `D:\Lab\signal` unless otherwise noted; the app itself lives in `signal-web/`.

---

### Task 1: Brand color tokens

**Files:**
- Modify: `signal-web/src/index.css:6-48` (the `:root` and `.dark` blocks inside the first `@layer base`)

**Interfaces:**
- Consumes: nothing new — `tailwind.config.js` already maps `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring` (with `-foreground` pairs) to Tailwind color utilities. This task only changes the HSL values assigned to those existing variable names.
- Produces: every later task (`Button` accent variant, `Logo`, `App.tsx`) renders using these new HSL values via the existing `bg-primary`, `text-foreground`, etc. utilities — no other task touches these variables again.

- [ ] **Step 1: Replace the `:root` and `.dark` blocks**

Open `signal-web/src/index.css`. Replace the entire `:root { ... }` and `.dark { ... }` blocks (currently lines 6–48) with:

```css
  :root {
    --background: 0 0% 100%;
    --foreground: 217.5 65% 12%;
    --card: 0 0% 100%;
    --card-foreground: 217.5 65% 12%;
    --popover: 0 0% 100%;
    --popover-foreground: 217.5 65% 12%;
    --primary: 221 83% 53%;
    --primary-foreground: 0 0% 100%;
    --secondary: 217 33% 95%;
    --secondary-foreground: 217.5 65% 12%;
    --muted: 217 33% 95%;
    --muted-foreground: 217 16% 47%;
    --accent: 180 82% 43%;
    --accent-foreground: 217.5 65% 12%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 217 33% 89%;
    --input: 217 33% 89%;
    --ring: 221 83% 53%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 218 65% 11%;
    --foreground: 0 0% 100%;
    --card: 219 74% 21%;
    --card-foreground: 0 0% 100%;
    --popover: 219 74% 21%;
    --popover-foreground: 0 0% 100%;
    --primary: 215 92% 74%;
    --primary-foreground: 217.5 65% 12%;
    --secondary: 217 33% 18%;
    --secondary-foreground: 0 0% 100%;
    --muted: 217 33% 18%;
    --muted-foreground: 215 25% 75%;
    --accent: 180 74% 53%;
    --accent-foreground: 217.5 65% 12%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217 33% 20%;
    --input: 217 33% 20%;
    --ring: 215 92% 74%;
  }
```

Leave the second `@layer base` block (the `* { @apply border-border }` / `body { @apply bg-background text-foreground }` rule) untouched.

- [ ] **Step 2: Build and lint**

Run: `cd signal-web && npm run build && npm run lint`
Expected: both commands exit 0, no TypeScript or ESLint errors (this task only touches CSS, so this mainly confirms nothing else broke).

- [ ] **Step 3: Manual visual check**

Run: `cd signal-web && npm run dev`, open the printed local URL in a browser.
Expected: the existing "Get Started" button (currently `bg-primary`) now renders with a blue background (`#2563EB`-ish) instead of the previous near-black slate. Open devtools, add the class `dark` to the `<html>` element, and confirm the page background turns navy (`#0A1830`-ish) and the button turns light blue (`#7FB3FA`-ish). Remove the `dark` class again before moving on.

- [ ] **Step 4: Commit**

```bash
cd signal-web
git add src/index.css
git commit -m "feat(web): apply signal brand color tokens"
```

---

### Task 2: Brand typography

**Files:**
- Modify: `signal-web/package.json` (via `npm install`, adds `@fontsource/nunito` and `@fontsource/ibm-plex-mono`)
- Modify: `signal-web/tailwind.config.js` (add `fontFamily` to `theme.extend`)
- Modify: `signal-web/src/index.css:1-3` (add font `@import`s before the `@tailwind` directives)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: Tailwind utility classes `font-display` (Nunito, for the wordmark/headings) and `font-mono` (IBM Plex Mono, for labels/metadata) become available; `font-sans` is explicitly pinned to Tailwind's default system stack. Task 3 (`Logo`) and Task 5 (`App.tsx`) consume `font-display`.

- [ ] **Step 1: Install the font packages**

Run: `cd signal-web && npm install @fontsource/nunito @fontsource/ibm-plex-mono`
Expected: exits 0, `signal-web/package.json` `dependencies` now lists both packages.

- [ ] **Step 2: Import the font weights in `index.css`**

Open `signal-web/src/index.css`. Above the existing three `@tailwind` lines (currently lines 1–3), add:

```css
@import "@fontsource/nunito/800.css";
@import "@fontsource/nunito/900.css";
@import "@fontsource/ibm-plex-mono/400.css";
@import "@fontsource/ibm-plex-mono/500.css";
@import "@fontsource/ibm-plex-mono/600.css";

@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: Add `fontFamily` to the Tailwind config**

Open `signal-web/tailwind.config.js`. Add the import at the top and the `fontFamily` key inside `theme.extend`:

```js
/** @type {import('tailwindcss').Config} */
import defaultTheme from "tailwindcss/defaultTheme"

export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: defaultTheme.fontFamily.sans,
        display: ["Nunito", ...defaultTheme.fontFamily.sans],
        mono: ["IBM Plex Mono", ...defaultTheme.fontFamily.mono],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
    },
  },
  plugins: [],
}
```

Only the `import` line and the `fontFamily` block are new; the rest of the file is reproduced unchanged so the whole file can be pasted as-is.

- [ ] **Step 4: Build and lint**

Run: `cd signal-web && npm run build && npm run lint`
Expected: both exit 0. If `vite build` fails resolving the `@import` specifiers, confirm the packages installed in Step 1 actually exist under `signal-web/node_modules/@fontsource/`.

- [ ] **Step 5: Manual visual check**

Run: `cd signal-web && npm run dev`, open the dev server URL, open browser devtools → Network tab, filter by "font", reload.
Expected: requests for the Nunito (800/900) and IBM Plex Mono (400/500/600) woff2 files succeed (status 200) with no console errors. The page itself won't visibly change yet — nothing uses `font-display`/`font-mono` until Tasks 3 and 5.

- [ ] **Step 6: Commit**

```bash
cd signal-web
git add package.json package-lock.json tailwind.config.js src/index.css
git commit -m "feat(web): add signal brand fonts"
```

---

### Task 3: Logo component

**Files:**
- Create: `signal-web/src/components/brand/logo.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils` (existing, used by `Button`); `signal-icon.svg` / `signal-icon-dark.svg` from `@/assets/`; the `font-display` utility from Task 2.
- Produces: `Logo` component and `logoVariants` (CVA function), both exported from `@/components/brand/logo`. Props: `lockup?: "horizontal" | "stacked" | "icon"` (default `"horizontal"`), `size?: "sm" | "default" | "lg"` (default `"default"`), plus standard `React.HTMLAttributes<HTMLDivElement>`. Task 5 (`App.tsx`) consumes `<Logo />` with no props (horizontal, default size).

- [ ] **Step 1: Create the component**

Create `signal-web/src/components/brand/logo.tsx`:

```tsx
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
```

- [ ] **Step 2: Build and lint**

Run: `cd signal-web && npm run build && npm run lint`
Expected: both exit 0. `Logo` isn't imported anywhere yet, so this only verifies the new file type-checks and lints cleanly on its own.

- [ ] **Step 3: Commit**

```bash
cd signal-web
git add src/components/brand/logo.tsx
git commit -m "feat(web): add Logo component"
```

---

### Task 4: Button accent variant

**Files:**
- Modify: `signal-web/src/components/ui/button.tsx:11-21`

**Interfaces:**
- Consumes: `--accent` / `--accent-foreground` tokens from Task 1.
- Produces: `buttonVariants({ variant: "accent" })` and `<Button variant="accent">`, usable by any future caller (not consumed elsewhere in this plan).

- [ ] **Step 1: Add the `accent` variant**

Open `signal-web/src/components/ui/button.tsx`. In the `variants.variant` object (lines 11–21), add one new entry after `secondary`:

```ts
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        accent: "bg-accent text-accent-foreground hover:bg-accent/90",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
```

- [ ] **Step 2: Build and lint**

Run: `cd signal-web && npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Manual visual check**

Temporarily change the `<Button>` in `signal-web/src/App.tsx` to `<Button variant="accent">Get Started</Button>`, run `npm run dev`, confirm the button renders teal (`#14C8C8`-ish) with ink-colored text. Revert the temporary change in `App.tsx` afterward (Task 5 restyles `App.tsx` for real).

- [ ] **Step 4: Commit**

```bash
cd signal-web
git add src/components/ui/button.tsx
git commit -m "feat(web): add accent button variant"
```

---

### Task 5: App shell integration

**Files:**
- Modify: `signal-web/src/App.tsx` (entire file)

**Interfaces:**
- Consumes: `Logo` from `@/components/brand/logo` (Task 3), `Button` from `@/components/ui/button` (existing), `font-display` utility (Task 2), `border-border` / `bg-background` tokens (Task 1, already wired via the base `@layer` rule).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Restyle `App.tsx`**

Replace the full contents of `signal-web/src/App.tsx` with:

```tsx
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/brand/logo"

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background px-6 py-4">
        <Logo />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">
          Signal
        </h1>
        <Button>Get Started</Button>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Build and lint**

Run: `cd signal-web && npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Manual visual check**

Run: `cd signal-web && npm run dev`, open the dev server URL.
Expected: a header bar with a bottom border containing the horizontal Signal logo (chevron icon + "Signal" wordmark in Nunito) appears above the centered "Signal" heading (also Nunito, bold) and the blue "Get Started" button. Toggle the `dark` class on `<html>` in devtools: header background and text invert correctly, the icon swaps from the light-colorway SVG to the dark-colorway SVG (confirm via Elements panel — the `dark:hidden` image disappears and the `hidden dark:block` image appears), and no layout shift occurs.

- [ ] **Step 4: Commit**

```bash
cd signal-web
git add src/App.tsx
git commit -m "feat(web): wire Logo into app shell"
```

---

### Task 6: Favicon and app icon

**Files:**
- Modify: `signal-web/public/favicon.svg` (replace entire contents)
- Modify: `signal-web/index.html:1-8`

**Interfaces:**
- Consumes: existing PNG assets at `signal-web/src/assets/png/apple-touch-icon-180.png`, `favicon-32.png`, `favicon-16.png` (already in the repo, no changes).
- Produces: nothing consumed by later tasks (last task in this plan).

- [ ] **Step 1: Replace the favicon SVG**

Replace the full contents of `signal-web/public/favicon.svg` with:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <defs>
    <linearGradient id="sg" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0E2A5E"></stop>
      <stop offset="1" stop-color="#0A1830"></stop>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#sg)"></rect>
  <polyline points="15,49 32,38 49,49" fill="none" stroke="#3B82F6" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline>
  <polyline points="15,38 32,27 49,38" fill="none" stroke="#5FA0F8" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline>
  <polyline points="15,27 32,16 49,27" fill="none" stroke="#2DE0E0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline>
</svg>
```

This is the same markup as `signal-web/src/assets/signal-app-icon.svg` — gradient background with rounded corners, the variant the brand doc's App Icon Sizes table designates for "Browser favicon, tiny badges."

- [ ] **Step 2: Add sized favicon links to `index.html`**

Open `signal-web/index.html`. Replace the `<head>` block with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" sizes="180x180" href="/src/assets/png/apple-touch-icon-180.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="/src/assets/png/favicon-32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/src/assets/png/favicon-16.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Signal</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Build**

Run: `cd signal-web && npm run build`
Expected: exits 0, no errors resolving the `/src/assets/png/*` paths in the built `dist/index.html` (Vite rewrites these to fingerprinted asset URLs at build time).

- [ ] **Step 4: Manual visual check**

Run: `cd signal-web && npm run dev`, open the dev server URL, look at the browser tab.
Expected: the tab icon shows the navy gradient square with the three light-blue/teal chevrons (no more purple Vite lightning bolt). Inspect the `<head>` in devtools to confirm all four `<link rel="icon"...>`/`<link rel="apple-touch-icon"...>` tags resolved (no 404s in the Network tab).

- [ ] **Step 5: Commit**

```bash
cd signal-web
git add public/favicon.svg index.html
git commit -m "feat(web): replace favicon and app icons with signal brand"
```

---

## Self-Review

**Spec coverage:** Color Tokens → Task 1. Typography → Task 2. Logo Component → Task 3. App Shell Integration → Task 5. Button accent variant → Task 4. Favicon/App Icon → Task 6. All "Files Touched" entries from the design doc are covered by exactly one task each.

**Placeholder scan:** No TBD/TODO markers; every step has literal, complete code or an exact shell command with a stated expected result.

**Type consistency:** `Logo` / `logoVariants` names match between Task 3 (definition) and Task 5 (consumption: `import { Logo } from "@/components/brand/logo"`, used as `<Logo />`). `buttonVariants` variant key `accent` matches between Task 4 (definition) and Task 5's continued use of plain `<Button>` (default variant, unaffected). CSS variable names in Task 1 match the names already consumed by `tailwind.config.js` (verified against the current file — no renames).