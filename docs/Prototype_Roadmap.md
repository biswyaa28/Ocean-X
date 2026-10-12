# OceanLens — 48-Hour Prototype Roadmap

## Objective

Produce a visually impressive but genuinely interactive prototype with one strong hero workflow.

## Phase 0 — Setup

Target: first few hours

- create repository
- configure Next.js
- configure TypeScript
- install CesiumJS
- configure Cesium ion/token if required
- create FastAPI backend
- establish frontend/backend connection
- add environment variables
- create basic deployment targets

## Phase 1 — 3D Globe

Target: early build

- render globe
- set initial camera
- add Bay of Bengal view
- add base imagery/terrain
- add navigation controls

Definition of done:

> User can open the application and reach an interactive 3D Bay of Bengal view.

## Phase 2 — Hero Hazard Visualization

- cyclone entities
- track
- time-aware movement
- intensity/status panel
- forecast/projection visualization where source data supports it
- simulated fallback

Definition of done:

> User can select a cyclone and inspect its track through time.

## Phase 3 — Environmental Layers

Implement first:

1. currents
2. wind
3. SST
4. wave height

Then, only if stable:

5. salinity
6. chlorophyll
7. rainfall

Definition of done:

> User can toggle layers without breaking the globe.

## Phase 4 — Intelligence

- risk panel
- transparent prototype risk rules
- evidence list
- explanation
- source status
- per-depth bias panel (shipped, replaces the planned impact-analysis screen)

Definition of done:

> User can understand why the prototype reports a risk category.

## Phase 5 — Timeline

- play/pause
- current time
- historical replay
- forecast/projection section when supported

Definition of done:

> Time changes the displayed spatial state consistently.

## Phase 6 — Dashboard Polish

- KPI cards
- charts
- station panel
- research/operations mode
- responsive layout
- loading states
- empty states
- error states

## Phase 7 — Data Integration

Only after the UI works:

- connect IBTrACS
- test INCOIS access (done; no Copernicus adapter was built)
- normalize responses
- preserve fallback
- add source metadata

## Phase 8 — Deployment

- frontend → Vercel
- backend → Railway
- configure CORS
- configure environment variables
- test production API
- test Cesium token/configuration
- verify fallback

## Definition of MVP

The MVP is complete when:

- globe works
- cyclone workflow works
- timeline works
- at least two environmental layers work
- risk explanation works
- source/simulation status is visible
- production deployment works

## Scope Rule

If a feature threatens the stability of the hero workflow, postpone it.

The priority is:

**3D globe → cyclone → timeline → evidence/risk → impact analysis → polish**
