# Signal Identity System

Complete brand identity guidelines for Signal — the community platform for sharing and voting on feature requests.

## Overview

Signal's identity reflects its core purpose: **ascending momentum of community ideas**. The mark uses three brightening
chevrons (deep blue → signal blue → teal) to represent votes climbing, signal strengthening, and ideas gaining
visibility as the community engages.

### Design Philosophy

- **Sharp + Technical** — chevron language conveys developer-friendly precision
- **Friendly + Approachable** — Nunito rounded grotesque softens technical edges
- **Community-First** — upward motion metaphor shows collective power of voting
- **Scalable** — mark works cleanly from favicon (16px) to presentation (1000px+)

---

## Logo Usage

### Primary Lockup (Horizontal)

Use this for most applications: website headers, social profiles, presentations, and documentation.

```
[Icon] Signal
```

- Minimum width: 160px (including wordmark)
- Always maintain clearspace ≥ one chevron-step on all sides
- Icon and wordmark should never be separated

### Stacked Lockup (Vertical)

Use when horizontal space is constrained: narrow sidebars, app icons, small cards.

```
  [Icon]
  Signal
```

- Icon above wordmark, centered
- Minimum width: 80px
- Maintains same clearspace as horizontal variant

### Icon Only

Standalone chevron mark for app icons, favicons, and dense UI contexts.

- Use only when the Signal wordmark appears elsewhere in the same context
- Never break apart or rotate the chevron stack
- Minimum size: 16px (favicon)

---

## Color Palette

| Name            | Hex       | Usage                                                 |
|-----------------|-----------|-------------------------------------------------------|
| **Ink**         | `#0B1A33` | Primary text, dark mode foundation, mono reproduction |
| **Deep**        | `#1E40AF` | Bottom chevron (primary), authoritative backgrounds   |
| **Signal Blue** | `#2563EB` | Middle chevron (primary), upvote interactions, accent |
| **Teal**        | `#14C8C8` | Top chevron (primary), energy, community highlight    |

### Colorway Variations

**Primary (Light)**

- Use on white/light backgrounds
- Full three-color chevron gradient
- Dark text (#0B1A33)

**Reversed (Dark)**

- Use on dark backgrounds (#0A1830 or darker)
- Chevrons lighten: lighter blues + teal remain vibrant
- White text

**Monochrome (Ink)**

- Use when color is unavailable: printing, embroidery, single-color contexts
- All chevrons and text in #0B1A33
- Works on any background with sufficient contrast

---

## Typography

### Wordmark

**Nunito** (font-family: 'Nunito', sans-serif)

- Weights: 800 (primary), 900 (emphasis)
- Letter-spacing: -1.5px to -2.5px (tighter at larger sizes)
- Case: Title case ("Signal")

### UI Labels & Metadata

**IBM Plex Mono** (font-family: 'IBM Plex Mono', monospace)

- Weights: 400 (regular), 500 (medium), 600 (bold)
- Used for: section headers, specs, code, timestamps
- All-caps with 1.5–2px letter-spacing

---

## App Icon Specifications

The Signal app icon uses a gradient background with the chevron mark in light tones for contrast at any size.

### Icon Sizes & Export

| Size  | Use Case                     | Stroke Width | Format                      |
|-------|------------------------------|--------------|-----------------------------|
| 120px | App store, large displays    | 7px          | PNG (transparent bg) or ICO |
| 80px  | Dock icons, home screen      | 7.5px        | PNG                         |
| 52px  | Notification badges, toolbar | 8.5px        | PNG                         |
| 32px  | Tab favicons, small UI       | 9.5px        | PNG                         |
| 16px  | Browser favicon, tiny badges | 11px         | ICO/PNG                     |

### App Icon Gradient Background

```css
background:

linear-gradient
(
160
deg, #0E2A5E, #0A1830

)
;
```

- 160° angle (top-right to bottom-left)
- Box shadow: `0 8px 22px rgba(10,24,48,0.28)` (for large sizes)
- Corner radius: rounded—use 25% of size (e.g., 30px for 120px icon)
- Chevrons render in light blue (#3B82F6, #5FA0F8) and teal (#2DE0E0)

---

## Clearspace & Construction

Always maintain padding around the logo ≥ **one chevron-step** (the vertical height of a single chevron).

```
┌─────────────────────┐
│  [padding = 1x]     │
│  ┌───────────────┐  │
│  │   [Icon]      │  │
│  │   Signal      │  │
│  └───────────────┘  │
│  [padding = 1x]     │
└─────────────────────┘
```

- Never crop into the chevrons
- Never resize elements independently (keep aspect ratio)
- Never rotate or skew the mark

---

## Do's & Don'ts

### ✅ Do

- Use the primary logo on light backgrounds
- Use the reversed logo on dark backgrounds
- Maintain consistent clearspace
- Scale proportionally (keep aspect ratio)
- Place on solid or subtle backgrounds
- Use the official color palette

### ❌ Don't

- Stretch or skew the mark
- Change the chevron colors or order
- Add effects (shadows, glows, outlines) beyond approved shadows
- Rotate the mark
- Place on busy/high-contrast backgrounds without clearspace
- Invent new color variations
- Use the logo as a bullet point or decorator

---

## File Reference

| File                        | Purpose                                                         | Format |
|-----------------------------|-----------------------------------------------------------------|--------|
| `signal-identity.png`       | Quick reference visual guide (logo, colors, typography)         | PNG    |
| `prompts_claude_design.txt` | Design process documentation (for company challenge submission) | TXT    |

---

## Quick Start

### For Web

```html
<!-- Horizontal lockup -->
<svg width="200" height="60" viewBox="0 0 64 64" fill="none">
    <polyline points="14,50 32,38 50,50" stroke="#1E40AF" stroke-width="7.5" stroke-linecap="round"
              stroke-linejoin="round"/>
    <polyline points="14,38 32,26 50,38" stroke="#2563EB" stroke-width="7.5" stroke-linecap="round"
              stroke-linejoin="round"/>
    <polyline points="14,26 32,14 50,26" stroke="#14C8C8" stroke-width="7.5" stroke-linecap="round"
              stroke-linejoin="round"/>
</svg>
<span style="font-family: Nunito; font-size: 48px; font-weight: 900; color: #0B1A33;">Signal</span>
```

### For Dark Backgrounds

Swap stroke colors:

- `#1E40AF` → `#5FA0F8`
- `#2563EB` → `#7FB3FA`
- `#14C8C8` → `#2DE0E0`
- Text: `#fff`

### For Monochrome

All strokes and text: `#0B1A33`

---

## Contact & Questions

For brand usage questions or requests outside these guidelines, refer to the primary design file (
`Signal Logo - Stack.html`) or the design process documentation (`prompts_claude_design.txt`).

---

**Last updated:** June 21, 2026  
**Version:** 1.0 (Stack direction)
