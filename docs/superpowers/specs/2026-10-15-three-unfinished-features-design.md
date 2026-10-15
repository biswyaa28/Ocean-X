# Three unfinished features — design

**Date:** 2026-10-15
**Status:** approved

Three dead hooks were found during the lint cleanup: props and state that were
declared, wired on one side, and then never used. They are not new features so
much as three promises the code already makes and does not keep.

| Dead thing | Where | Promise it makes |
|---|---|---|
| `onClose` prop | `DataInspector` | the caller wires it, nothing renders it |
| `compact` prop | `RegionalSummary` | documented as inline-vs-standalone, never implemented |
| `riskLoading` state | `app/page.tsx` | set on every risk fetch, never read |

---

## 1. DataInspector close button

### Current state

`DataInspector` renders a fixed-position instrument whenever `activeLayer` is
non-null. It has two states: a populated card, and an empty state reading
"INSPECTOR READY — Click an active map layer".

`app/page.tsx` passed `onClose={() => setInspectionData(null)}` into a prop the
component ignored, so that callback was dead code.

### Decision

The close button **clears the current selection**. It does not hide the panel.

The panel is a persistent instrument, not a modal. It already owns an empty
state designed for exactly this, so clearing the selection returns it to a state
that already exists rather than inventing one. No new state is required and
there is no way to end up with the panel dismissed and no way to reopen it.

Rejected: dismissing the panel entirely. It would need a floating reopen
control, and would remove an instrument that is useful precisely when nothing is
selected.

### Design

- `onClose?: () => void` is restored on the props interface, optional so the
  component still renders without it.
- An icon-only `×` button sits in the header row, after the REAL / SIMULATED
  badge. The header is `justify-between`, so the badge and the button share the
  trailing group.
- `aria-label="Clear inspection"`, `type="button"`.
- Rendered only when `onClose` is supplied and there is a selection to clear.
- Hit target stays 24px+ (`p-1` with a `w-3.5 h-3.5` glyph), keyboard
  reachable, visible focus ring.

---

## 2. RegionalSummary compact variant

### Current state

`compact?: boolean` was documented as "Render inline (inside the drawer) or as
a standalone panel" and destructured but never read. Its only render site,
`ArgoMatchupDrawer.tsx:1431`, passes no props.

Building the variant alone would leave it dead — nothing would render it.

### Decision

The drawer decides from its **own available height**, so the variant is
exercised for real rather than shipped unused.

### Design

- `RegionalSummary` accepts `compact?: boolean`, defaulting to `false`, which
  keeps today's full layout unchanged.
- `compact` renders the panel's headline content and omits the long-form
  sections: the TCHP scatter plot and the per-depth statistics tables.
- Specifically, `compact` keeps: the loading and unavailable states, the
  model-depth provenance note, the TCHP definition note, the status chip, and
  the reload control.
- `compact` drops: the scatter plot, the per-depth temperature and salinity
  tables, and the per-variable aggregate grids.
- Nothing is summarised away into a smaller number. A figure that only exists
  in a dropped section is **absent**, not rounded, because a condensed view that
  invents aggregates would break the project's rule that nothing is reported
  that cannot be sourced.
- The drawer passes `compact` when its measured height is below a threshold,
  measured with a `ResizeObserver` so rotating a phone or resizing the window
  is handled. The threshold is a single named constant.

---

## 3. Risk assessment loading state

### Current state

`riskAssessment` is derived from `riskState`, which is null until the backend
answers. While a request is in flight the derived value is null, and the UI
renders the null branch — "UNAVAILABLE — No risk assessment received from the
backend."

That is a false statement. The backend has not declined; it has not answered
yet. This project does not report a state it cannot source, and "unavailable"
during a fetch is a state the backend never reported.

### Decision

Three distinct states, not two.

| State | Chip reads |
|---|---|
| request in flight | `SCORING…` with a spinner |
| backend declined or absent | `UNAVAILABLE` plus the real reason |
| score received | category and score, with the existing demo-scoring caveat |

### Design

- `riskLoading` returns as state, but is set inside the promise callbacks and
  cleared in both the resolve and reject paths, so no synchronous `setState`
  runs in an effect body.
- The derived `riskKey` already scopes staleness. Loading is scoped the same
  way: the chip asks whether `riskState.key === riskKey` to decide that a
  request is outstanding, rather than tracking it in a second independent flag
  that could disagree with the score's own identity.
- The chip's colour follows its existing convention: cyan for a working state,
  the muted slate already used for `UNAVAILABLE`, the existing severity colour
  for a real score.
- No spinner is shown in `LIVE` mode, where no risk request is made at all.

---

## Testing

Each feature is built test-first.

1. **Close button** — `DataInspector` renders the button only when `onClose`
   is given; clicking it calls the callback; it is absent when the prop is
   omitted and absent when there is no selection.
2. **compact** — `RegionalSummary` with `compact` renders the provenance and
   definition notes and does not render the scatter or the per-depth tables;
   without `compact` it renders them.
3. **Risk chip** — `SCORING…` while the request is pending; `UNAVAILABLE` with
   a reason once it rejects; the category and score once it resolves.

Regression bar: the existing 628 frontend tests, lint silent, `tsc` clean, and
`next build` succeeding.