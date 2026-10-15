## What

<!-- What does this change, and why? -->

## Why

<!-- The problem this solves. Link the issue if there is one. -->

## Verification

<!-- Paste the commands you ran and their results. Do not claim a check you
     did not run. -->

- [ ] `cd backend && python -m pytest -q`
- [ ] `cd frontend && npm run lint`
- [ ] `cd frontend && npx tsc --noEmit`
- [ ] `cd frontend && npm test`
- [ ] `cd frontend && npm run build`

## Data honesty

This project reports no figure it cannot source. If the change touches a value
shown in the UI, a caption, an alt attribute, or a provenance label:

- [ ] Every number shown is measured from the backend or a committed dataset.
- [ ] Anything unavailable is reported as unavailable, not replaced with a
      placeholder, a zero, or a plausible constant.
- [ ] Captions and alt text describe what the screenshot or field actually shows.
- [ ] `FIXTURE` / synthetic mode, when active, is announced in the UI.

## Risk

<!-- Anything destructive, irreversible, or needing a migration. -->
