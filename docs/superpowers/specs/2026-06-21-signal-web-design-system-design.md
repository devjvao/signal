# Signal Web — Brand Design System (Design)

## Context

`signal-web` is a Vite + React + TypeScript app already scaffolded in a shadcn/ui-style pattern: Tailwind with HSL CSS-variable color tokens (`src/index.css` + `tailwind.config.js`), `class-variance-authority` + `tailwind-merge` + `clsx` for component variants, and one component (`Button`) following that pattern. None of it reflects Signal's brand yet — colors are the generic shadcn "slate" defaults, the favicon is the leftover default Vite logo, and `App.tsx` is a placeholder (centered heading + button).

Logo assets already exist under `src/assets/` (`signal-icon.svg`, `signal-icon-dark.svg`, `signal-icon-mono.svg`, `signal-app-icon.svg`, plus PNGs at multiple sizes) and the full brand spec lives at `docs/identity/README.md`.

This pass establishes the design-system foundation only: semantic color tokens (light + dark), brand typography, a reusable `Logo` component, wiring the logo into the app shell, and replacing the favicon/app-icon. It does not add new component primitives beyond `Button`, and does not add a theme-toggle UI (dark mode must render correctly via the `.dark` class, but nothing yet flips that class at runtime).

## Color Tokens

Keep the existing architecture (HSL CSS custom properties in `:root` / `.dark`, consumed via `tailwind.config.js` `theme.extend.colors`) — only the values change. Mapping decision: **Signal Blue → `primary`** (the doc calls it out for "upvote interactions, accent"), **Teal → `accent`**, **Deep** reserved for dark-mode surface tints (app-icon gradient), **Ink** is the light-mode foreground / dark-mode background base.

### Light mode (`:root`)

| Token | HSL | Hex source |
|---|---|---|
| `--background` | `0 0% 100%` | white (doc: "Primary (Light)") |
| `--foreground` | `217.5 65% 12%` | Ink `#0B1A33` |
| `--card`, `--popover` | `0 0% 100%` | white |
| `--card-foreground`, `--popover-foreground` | `217.5 65% 12%` | Ink |
| `--primary` | `221 83% 53%` | Signal Blue `#2563EB` |
| `--primary-foreground` | `0 0% 100%` | white |
| `--accent` | `180 82% 43%` | Teal `#14C8C8` |
| `--accent-foreground` | `217.5 65% 12%` | Ink (better contrast on teal than white) |
| `--secondary`, `--muted` | `217 33% 95%` | light tint of Ink hue (replaces generic slate) |
| `--secondary-foreground`, `--muted-foreground` | `217.5 65% 12%` / `217 16% 47%` | Ink / mid blue-gray |
| `--border`, `--input` | `217 33% 89%` | Ink-hue tint |
| `--ring` | `221 83% 53%` | Signal Blue (matches primary/focus) |
| `--destructive` | `0 84.2% 60.2%` | unchanged conventional red — **not** a brand color; the identity doc defines no error color, so a standard accessible red is kept for system/utility semantics only |
| `--destructive-foreground` | `210 40% 98%` | unchanged |
| `--radius` | `0.5rem` | unchanged — identity doc has no UI corner-radius spec |

### Dark mode (`.dark`)

Follows the doc's explicit "For Dark Backgrounds" swap table (`#1E40AF→#5FA0F8`, `#2563EB→#7FB3FA`, `#14C8C8→#2DE0E0`) and the reversed background `#0A1830`.

| Token | HSL | Hex source |
|---|---|---|
| `--background` | `218 65% 11%` | `#0A1830` |
| `--foreground` | `0 0% 100%` | white (reversed colorway) |
| `--card`, `--popover` | `219 74% 21%` | `#0E2A5E` (app-icon gradient's top stop, used as an elevated-panel tint) |
| `--card-foreground`, `--popover-foreground` | `0 0% 100%` | white |
| `--primary` | `215 92% 74%` | `#7FB3FA` |
| `--primary-foreground` | `217.5 65% 12%` | Ink (dark text reads better on the lightened blue than white) |
| `--accent` | `180 74% 53%` | `#2DE0E0` |
| `--accent-foreground` | `217.5 65% 12%` | Ink |
| `--secondary`, `--muted` | `217 33% 18%` | dark Ink-hue tint |
| `--secondary-foreground` | `0 0% 100%` | white |
| `--muted-foreground` | `215 25% 75%` | light blue-gray |
| `--border`, `--input` | `217 33% 20%` | dark Ink-hue tint |
| `--ring` | `215 92% 74%` | matches dark-mode primary |
| `--destructive` | `0 62.8% 30.6%` | unchanged |
| `--destructive-foreground` | `210 40% 98%` | unchanged |

## Typography

- Add `@fontsource/nunito` (weights 800, 900) and `@fontsource/ibm-plex-mono` (weights 400, 500, 600) as dependencies; import in `src/index.css`. Self-hosted — no external network dependency, no FOUC from a slow CDN.
- `tailwind.config.js` `theme.extend.fontFamily`:
  - `sans`: default system stack (body copy — undefined by the brand doc, left neutral)
  - `display`: `["Nunito", ...defaultSans]` — reserved for the wordmark and brand-moment headings only, per the doc scoping Nunito to "Wordmark"
  - `mono`: `["IBM Plex Mono", ...defaultMono]` — for labels, metadata, timestamps, code, per the doc scoping Plex Mono to "UI Labels & Metadata"

## Logo Component

New file `src/components/brand/logo.tsx`, CVA-driven, matching the doc's three lockups:

- `lockup` variant: `"horizontal"` (icon + wordmark side by side, default) | `"stacked"` (icon above wordmark, centered) | `"icon"` (icon only, wordmark omitted)
- `size` variant: `"sm" | "default" | "lg"` — controls icon dimensions, gap, and wordmark text size together as one coordinated step (not independently configurable)
- Renders both `signal-icon.svg` (light/primary colorway) and `signal-icon-dark.svg` (reversed colorway) as `<img>` tags, toggled via `dark:hidden` / `hidden dark:block` Tailwind classes — so the icon auto-adapts to the `.dark` class on `<html>` with no JS theme detection, consistent with this pass not adding a theme toggle.
- Wordmark: `<span className="font-display font-extrabold tracking-tight">Signal</span>`, colored via inherited `text-foreground` so it's correct in both themes automatically. Omitted when `lockup="icon"`.

## App Shell Integration

`src/App.tsx`:
- Add a minimal `<header>`: `border-b border-border bg-background`, standard horizontal padding, containing `<Logo />` (horizontal, default size) left-aligned.
- Existing placeholder content (heading + button) stays, restyled to use the new tokens/fonts: heading uses `font-display`, body text uses default `font-sans`.

## Button

The existing CVA variants (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`) already reference `bg-primary` / `bg-secondary` / `bg-destructive` etc., so they pick up the new brand colors automatically once the CSS variables change — no variant-shape changes needed there.

Add one new variant: `accent` (`bg-accent text-accent-foreground hover:bg-accent/90`), since the doc explicitly calls out Teal for "upvote interactions, accent" and no existing variant currently renders with `--accent` at all.

## Favicon / App Icon

- `public/favicon.svg` currently contains the leftover default Vite logo (purple lightning bolt) — replace its contents with `signal-app-icon.svg`'s markup (gradient background + rounded corners), which is the variant the doc's App Icon Sizes table lists for "Browser favicon, tiny badges."
- Add `apple-touch-icon` and sized PNG `<link>` tags to `index.html`, pointing at the existing `src/assets/png/apple-touch-icon-180.png`, `favicon-32.png`, `favicon-16.png`. These are relative paths into `src/`, which Vite resolves and fingerprints at build time through its HTML asset handling — no file moves needed.

## Files Touched

- `signal-web/package.json` — add `@fontsource/nunito`, `@fontsource/ibm-plex-mono`
- `signal-web/tailwind.config.js` — `fontFamily` extend
- `signal-web/src/index.css` — new color token values, font imports
- `signal-web/src/components/brand/logo.tsx` — new
- `signal-web/src/components/ui/button.tsx` — add `accent` variant
- `signal-web/src/App.tsx` — header + Logo integration, restyled placeholder content
- `signal-web/public/favicon.svg` — replaced contents
- `signal-web/index.html` — additional favicon `<link>` tags

## Testing Plan

- `npm run dev`, visually verify header/logo/button in light mode
- Toggle the `dark` class on `<html>` via devtools, verify dark-mode token values render correctly (background, card, primary, accent, text contrast)
- `npm run build` (runs `tsc -b && vite build`) to confirm typed build passes and favicon/PNG link paths resolve without errors
