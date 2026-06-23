# Signal visual redesign

Source: Claude Design project "Signal feature request platform redesign" (`Signal.dc.html`,
project id `84658833-ead9-4ae8-8018-43684f7b95c7`), which mocks up every existing Signal screen
in a bold, color-blocked visual direction (Nunito display type, IBM Plex Mono labels/metadata,
navy/blue/teal palette, ascending-chevron motif) with full light and dark variants.

This is a **visual restyle of existing functionality**, plus a handful of small real features the
mockup implies (theme toggle, server-side search/sort/filter, a status-change toast, and a
backend aggregate for project stats). No existing permission/business-rule logic changes.

## Design tokens & theme infrastructure

`signal-web/src/index.css` already defines shadcn-style CSS variables for `background`,
`foreground`, `primary`, `accent`, etc., and already loads Nunito (800/900) + IBM Plex Mono
(400/500/600). Tighten these to the doc's exact values and add a few raw tokens for one-off
gradients that don't map to a semantic role:

- Ink `#0B1A33`, Deep `#1E40AF`, Signal Blue `#2563EB` (primary), Teal `#14C8C8` (accent)
- Status palette (light/dark pairs): Open (blue), Planned (purple `#7C5CFC`/`#6D4FE0`),
  In progress (amber `#F5A524`/`#B7791F`), Completed (green `#16A34A`/`#15803D`), Rejected
  (gray `#94A3B8`/`#64748B`)

Add a `ThemeToggle` component: reads/writes `localStorage["signal_theme"]`, defaults to
`prefers-color-scheme` on first load, toggles the `dark` class on `<html>`. It lives in a shared
**`AppHeader`** (`components/layout/AppHeader.tsx`) — the global top navbar (logo · user
name/email · avatar-initials · ThemeToggle · Log out) rendered on **every authenticated page**
(`MainPage`, `ProjectPage`, and the form pages), so the navbar is identical everywhere and fixed
in one place.

Because the toggle only mounts on authenticated pages, an inline initializer in `index.html`
applies the persisted (or system) theme to `<html>` **before first paint**, so logged-out screens
(Login/Register) and any direct deep-link also render in the chosen theme with no flash. The
toggle remains the only place a signed-in user changes it.

Gradient hero panels read fixed brand tokens (`ink`, `deep`, raw `#2563EB`), not the
theme-dependent `primary`/`accent` CSS variables, so the navy→blue hero looks identical in light
and dark (where `primary` would otherwise shift to a light blue and wash the gradient out).

## New/changed shared primitives (`signal-web/src/components/ui/` and feature folders)

- **StatusBadge** — a soft per-status **tinted** pill (`bg-status-x/15 text-status-x`, uppercase,
  colored dot). Editable (Radix `Select` trigger) for the project owner, a plain span otherwise.
  The dropdown menu shows Title-case mono labels (`statusDisplayLabels`) with a leading colored
  dot, and tints the active/checked row with that status's own color + a check. Exported
  `statusLabels`/`statusOptions` stay lowercase (DOM/test-stable); `statusDisplayLabels` /
  `statusDisplayOptions` are display-only.
- **VoteControl** — fixed-width (`w-16`) vote box with ▲ + count + a wrapping mono caption, in
  three states: votable (outline, "VOTES"), voted (solid brand-blue `#2563EB`, "VOTES"), and own
  (dashed border, "YOUR REQUEST", no click handler). The blue uses a fixed hex (not `primary`) so
  it stays brand-blue in dark mode.
- **SearchInput** — text input filtering the project list by name, debounced (~300ms) and sent to
  the server as a `search` query param.
- **SortSelect** — small dropdown; options depend on context (projects listing: Newest / Most
  active; project page: Most votes / Newest). Selecting a value changes the `sort` query param.
- **FilterChips** — pill row for filtering a feature-request list by status (`All` + the 5
  statuses, Title-case via `statusDisplayOptions`), sent to the server as a `status` query param.
  Active chip is dark navy (`bg-ink text-white`, `border-white/20`); inactive chips are `bg-card`
  with foreground text.
- **Toast** — minimal self-contained component (fixed bottom-right, auto-dismiss after ~3s, no
  new dependency) with structured `title` + optional `description`; the card is **theme-inverted**
  (dark ink in light mode / pale in dark) per the mock. A `variant` prop drives the leading chip:
  `success` (green check) or `error` (red X, `role="alert"`, sits above any open dialog overlay).
  Every toast is shown through a single **global `ToastProvider`** (`context/ToastContext.tsx`,
  mirroring `AuthProvider`) exposing `useToast().showToast({ variant, title, description })`. The
  provider holds the active toast and renders it at the app root, so a toast **survives the dialog
  or card that triggered it unmounting** — essential for deletes (the card disappears on the list
  refetch) and create-from-empty-state, where a dialog-local toast would vanish instantly. Toasts
  carry every create/edit/delete success plus page-level outcomes (the feature-request status
  change success/failure and auth failures). A monotonic key restarts the auto-dismiss timer when
  one toast replaces another. `useToast` throws outside the provider, the same contract as
  `useAuth`.
- **Alert** — soft-tint inline error block (`components/ui/alert.tsx`) for errors raised **inside a
  modal dialog**, where a corner toast reads as disconnected from the form: `rounded-lg border
  border-destructive/30 bg-destructive/10`, an `AlertCircle` icon + `text-sm text-destructive`
  message, `role="alert"`. One destructive style for now (no `variant` until a non-error use
  appears). Used by every dialog's failure path (project & feature-request create/edit, and both
  delete confirmations); the dialog stays open so the user can retry. The matching **success** path
  for those same dialogs closes the dialog and fires a success `Toast` via `useToast` (see Toast).
- **EmptyState** — shared dashed-border placeholder (brand chevron in a rounded-square chip, a
  title, supporting copy, and an optional action) used by `ProjectList` ("No projects yet" + a
  "Create your first project" CTA on the empty My-projects tab) and, later, `FeatureRequestList`.
- **AuthHero** — the Login/Register left panel is shared (not one-off): a navy→blue gradient
  (`from-ink via-deep to-[#2563EB]`) with the `inverted` `Logo`, a faint ascending-chevron SVG
  watermark, and `{eyebrow, headline}` props. Login and Register differ only by that copy.
- **Logo** gains an `inverted` prop (light icon + white wordmark regardless of theme) for use on
  dark gradient panels.
- **Label** is restyled to the mock's field-label treatment — IBM Plex Mono, uppercase,
  `text-xs`, tracked, muted — applied once on the shared primitive so every form inherits it.
- The project-page banner remains one-off composed markup (its gradient direction/copy differ).
- Shared **Select** (`select.tsx`, used by `SortSelect` and `StatusBadge`): the open/focused
  trigger shows a primary focus ring (not the browser-default black outline), and the
  highlighted/selected item uses primary (not the teal `accent`). Clickable **cards** show a
  primary `focus-visible` ring and stay tab-focusable, while the Tabs panel wrapping them is
  `tabIndex={-1}` so it isn't a redundant tab stop.
- Dark surfaces: the dark `--card` token is a muted deep navy (`216 55% 15%`) so cards read as a
  subtle elevation over the darker page background rather than a bright blue.
- `Button`'s `default` (primary) variant carries the mockup's signature glow
  (`shadow-lg shadow-primary/30`) so every primary action shares it. The `outline` and `ghost`
  variants hover to a neutral `bg-muted`/`text-foreground` instead of the teal `accent` (which read
  as an off-brand green). (Earlier the plan applied the glow per call site; it is now part of the
  variant.)

## Error surfaces — toasts vs. inline alerts

A single rule decides how an action's outcome is shown, by **where the action lives**:

- **On a full page** (auth submit on Login/Register; the inline status change on a feature-request
  card) → an **error `Toast`** (`variant="error"`, bottom-right) on failure. For the status change
  this is symmetric with its success toast. Page success that navigates away (login, register)
  needs no toast — the redirect is the feedback.
- **Inside a modal dialog** (project & feature-request create/edit; project & feature-request
  delete) → **failure** shows an inline `Alert` within the dialog, which **stays open** so the user
  can fix and retry (a corner toast would read as detached from the form); **success** closes the
  dialog and shows a success `Toast` (`Project created/updated/deleted`,
  `Request created/updated/deleted`, description = the entity name/title).
- **Hosting:** every toast goes through the global `ToastProvider` / `useToast()` (see primitives),
  never per-dialog or per-list state. That is what lets a delete's success toast appear even though
  the dialog **and its card** unmount on the refetch. The earlier per-page/per-list toast hosting
  and the `onStatusToast` prop chain are removed in favor of `useToast`.

This replaces the earlier interim behavior where `ProjectFormDialog` showed its failure as a toast,
the other dialogs/pages showed bare `text-destructive` text, and only project create/edit gave any
success feedback.

## Screen-by-screen mapping

| Doc screen | File(s) | Change |
|---|---|---|
| Login / Register | `pages/LoginPage.tsx`, `pages/RegisterPage.tsx`, `components/auth/AuthHero.tsx` | Split-panel: shared `AuthHero` left (inverted logo, eyebrow, headline, chevron motif), form right. Form column is left-aligned in a `max-w-sm` block with a colored eyebrow above the heading, mono field labels, a full-width primary submit, and a centered cross-link ("New to Signal? Register" / "Already have an account? Log in") rather than a separate outline button. `AuthHero` takes a `tone` prop: Login uses `navy` (fixed navy→blue); Register uses `teal` (teal→blue that darkens in dark mode to match the mock). Login copy: hero eyebrow "Community feature requests" / headline "Vote the future into focus." + right eyebrow "Welcome back". Register copy: hero eyebrow "Join the community" / headline "Shape the software you love." + right eyebrow "Join Signal". A failed submit shows an error `Toast` via `useToast` ("Couldn't log in" / "Couldn't create account") instead of inline text; success redirects. |
| Projects listing | `pages/MainPage.tsx`, `components/projects/ProjectList.tsx`, `components/projects/ProjectCard.tsx`, `lib/api.ts` | Header: logo left; right shows the user name over their email (stacked, mono), an avatar-initials chip, ThemeToggle, and Log out. The header bar is full-bleed (white in light / a lighter `bg-card` in dark, so the navbar sits a shade above the page) but its contents are constrained to the page `max-w-7xl`, and the page body sits on a subtly muted background (light) / the darkest `bg-background` (dark) so the `bg-card` cards read against it. Hero: eyebrow "Browse & build" (primary blue) + title "Projects", with a "+ New project" button on the right of the same row. One controls row: lightly-rounded tab switcher ("All projects" / "My projects") on the left, SearchInput (magnifier icon) + SortSelect (defaulting to **Most active**) on the right (both `rounded-md`, matched `h-10`) — both server-side (query key includes `scope, sort, search`, resetting pagination on change). `ProjectList` renders a responsive grid (`sm:grid-cols-2 lg:grid-cols-3`). `ProjectCard` is a `bg-card` grid card with a left accent bar — blue→teal gradient for owned projects, gray (`before:bg-border`) for others — owner-only edit/delete actions as small (`h-8`) bordered rounded-square **icon** buttons whose background matches the card (edit glyph in primary with a gray border in light / primary border in dark; delete glyph and border in destructive) in the top-right, a meta line ("You"/owner name · `MMM D, YYYY`), and a stats line fully in primary (`▲ {votes} · {requests} requests`). Card hover adds a subtle primary glow + border; the icon hovers tint primary/destructive (not the `ghost` variant's default teal `accent`). |
| New/Edit project | `components/projects/ProjectFormDialog.tsx` (replaces `pages/ProjectFormPage.tsx`) | **Modal** (matches the `project-*-modal` mockups), not a page. One shared dialog serves create + edit, opened from the "+ New project" button (MainPage), the projects empty-state CTA, and each owned card's edit button. Eyebrow ("New project" primary / "Editing" accent), display title ("Create a project" / "Edit project"), top-right close (X), "Project name" + "Description" fields with placeholders, and a "Save project"/"Save changes" + "Cancel" footer. On save it fires a success `Toast` via `useToast` ("Project created"/"Project updated", closing the dialog) or shows an inline `Alert` on failure (the dialog stays open). The old full page and its `/projects/new` + `/projects/:id/edit` routes are removed. |
| Delete project modal | `components/projects/DeleteProjectDialog.tsx` | Same Radix `Dialog`, restyled to the `project-delete-dialog` mockup: `rounded-2xl` card, a rounded-square destructive icon badge inline-left of a dynamic title `Delete "{name}"?`, the "This permanently removes the project and all its feature requests. This action cannot be undone." copy, and two equal-width (50/50) footer buttons ("Cancel" + destructive "Delete project"). A successful delete closes the dialog and fires a `Project deleted` toast via `useToast`; a failed delete shows an inline `Alert` and keeps the dialog open. |
| Project page | `pages/ProjectPage.tsx`, `components/feature-requests/FeatureRequestList.tsx`, `lib/api.ts` | The global `AppHeader` sits above a navy→blue gradient banner (full-bleed, content in `max-w-7xl`, chevron-motif watermark): "← All projects" breadcrumb, title, description, a "{n} requests" pill and a primary "+ New feature request" CTA. Below: a "FILTER" mono label + Title-case `FilterChips` (left) and `SortSelect` (right) — both server-side (query key includes `status, sort`, resetting pagination on change); the whole toolbar is hidden when `requestCount === 0`. `FeatureRequestList` shows the cards, an `EmptyState` ("No feature requests yet" + CTA) when the project is genuinely empty (a plain "No requests match this filter." when a filter yields nothing). The status-change toast now fires through `useToast` (the list no longer hosts a `Toast`). Page body sits on the muted/`bg-background` page surface. |
| New/Edit feature request | `components/feature-requests/FeatureRequestFormDialog.tsx` (replaces `pages/FeatureRequestFormPage.tsx`) | **Modal** (matches the `*-modal` mockups), not a page. One shared dialog serves create + edit, opened from the project hero CTA, the empty-state CTA, and each card's edit button. Accent eyebrow ("New request" / "Editing your request"), display title ("Suggest a feature" / "Edit feature request"), top-right close (X), Title + Description fields, a status hint line (new requests start `open`; edit shows the current status as a read-only StatusBadge + "(set by owner)"), and a "Save request"/"Save changes" + "Cancel" footer. A successful save closes the dialog and fires a success `Toast` via `useToast` ("Request created"/"Request updated"); a failed save shows an inline `Alert` (the dialog stays open). The old full page and its `/projects/:projectId/feature-requests/new` + `/feature-requests/:id/edit` routes are removed. |
| Feature request card | `components/feature-requests/FeatureRequestCard.tsx` | `bg-card` card: `VoteControl` box on the left, title + `StatusBadge` (editable for the project owner, read-only otherwise) on a `justify-between` row, description, a meta line (`You`/author · `MMM D, YYYY`, plus `· N upvotes` for your own request), and owner/author edit/delete as small bordered icon-square buttons. The owner's status change fires toasts directly via `useToast` — a success toast on change and an **error** toast on failure (no inline card error, no `onStatusToast` prop). A successful delete (via `DeleteFeatureRequestDialog`) fires a `Request deleted` toast; a failed delete shows an inline `Alert` in that dialog. |

All existing permission branching (`isAuthor`, `isProjectOwner`, `canEdit`, `canDelete`,
`canUpvote`) is preserved exactly as implemented — only presentation changes. Existing tests are
updated for new markup/queries (e.g. `getByRole` selectors), not rewritten for logic.

## Backend: project aggregate, server-side search/sort/filter (signal-api)

Both list endpoints already use **keyset (cursor) pagination**, not offset — `projects.go` and
`feature_requests.go` each define their own cursor struct, encode/decode functions, and a
matching SQL `WHERE`/`ORDER BY` (no shared generic cursor utility exists, and this work doesn't
introduce one). Sorting and filtering must stay cursor-correct, so:

**`GET /projects` and `GET /projects/mine`** gain `requestCount` and `voteCount` per project,
plus `search` and `sort` query params:

- Extend `db/queries/projects.sql`'s `ListProjects`/`ListProjectsByOwner` with `LEFT JOIN
  feature_requests` + `LEFT JOIN votes`, `GROUP BY` project columns, `COUNT(DISTINCT
  feature_requests.id)` and `COUNT(votes.id)` as `requestCount`/`voteCount`.
- `search` (optional string) adds a `WHERE name ILIKE '%' || $search || '%'` predicate — applies
  under either sort mode, doesn't affect cursor shape.
- `sort` (`newest` default | `active`):
  - `newest` keeps today's cursor/order: keyset on `(created_at, id)` descending.
  - `active` is a new cursor variant keyed on `(requestCount + voteCount, created_at, id)`
    descending — the comparison predicate re-derives the aggregate (via the same JOIN, wrapped so
    the keyset `WHERE` can compare against the cursor's stored score) rather than trusting a
    stale client-supplied count.
  - Each sort mode gets its own cursor struct/encode/decode pair, following the existing
    per-endpoint pattern; a cursor encodes which sort produced it isn't required since the
    frontend always restarts pagination (no cursor) when `sort`/`search` changes.
- Regenerate via `sqlc generate`.
- Add `requestCount`/`voteCount` to `projectResponse` in `internal/handlers/projects.go`.

**`GET /projects/:id/feature-requests`** gains `status` and `sort` query params:

- `status` (optional, one of the 5 enum values) adds a `WHERE status = $status` predicate —
  orthogonal to sort, no cursor impact.
- `sort` (`votes` default | `newest`):
  - `votes` is today's existing behavior, unchanged: keyset on `(upvote_count, created_at, id)`.
  - `newest` is a new cursor variant keyed on `(created_at, id)` descending.

- Update/add Go handler tests covering: aggregate fields, `search`, both `sort` values on each
  endpoint, `status` filter, and pagination continuing correctly across a second page under a
  non-default sort.
- Backend changes committed separately from the frontend restyle commits per
  `CONVENTIONAL_COMMIT_GUIDELINE.md`.

## Testing

- Backend: update/add Go tests in `internal/handlers/projects_test.go` and
  `internal/handlers/feature_requests_test.go` (or equivalent) covering the new aggregate fields,
  `search`/`status` filters, both sort modes per endpoint, and cross-page pagination under a
  non-default sort.
- Frontend: existing component/page tests (`*.test.tsx`) are updated where markup/selectors
  change; `ProjectList`/`FeatureRequestList` tests extended to assert the right query params are
  sent when search/sort/filter change; new primitives (`StatusBadge`, `VoteControl`,
  `SearchInput`, `SortSelect`, `FilterChips`, `Toast`, `Alert`, `ThemeToggle`) get their own
  focused tests following the existing testing-library conventions in the repo. `ToastProvider` /
  `useToast` get a focused test (showToast renders a toast; dismiss clears it; `useToast` throws
  outside the provider); components that call `useToast` are rendered inside a `ToastProvider` in
  their tests. The error-surface rule is covered end-to-end: Login/Register show an error toast
  (not inline text) on a failed submit; a feature-request status-update failure shows the error
  toast; each create/edit/delete success shows its success toast (`Project created/updated/deleted`,
  `Request created/updated/deleted`); and each dialog (`ProjectFormDialog`,
  `FeatureRequestFormDialog`, `DeleteProjectDialog`, `DeleteFeatureRequestDialog`) renders an inline
  `Alert` and stays open on failure.
- No new test infra or libraries beyond what's already installed.