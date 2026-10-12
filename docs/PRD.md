# OceanLens — Product Requirements Document

## 1. Product

**Name:** OceanLens — Bay of Bengal  
**Type:** Hackathon / college prototype  
**Primary product direction:** Disaster-intelligence-first 3D ocean visualization and decision-support prototype.

## 2. Product Goal

Demonstrate a credible workflow that turns marine and atmospheric information into:

**Observe → Analyze → Predict/Project → Explain → Assess Impact**

The prototype is not intended to replace official forecasting systems or provide operational warnings.

## 3. Target Users

The prototype supports four user groups:

1. Researchers
2. Disaster-management authorities
3. Government/coastal authorities
4. General public

For the hackathon demo, the primary workflow is disaster/hazard intelligence.

## 4. Product Priority

1. Disaster / hazard intelligence
2. Monitoring dashboard
3. Predictive / forecast visualization
4. Research and data exploration

## 5. Hero Experience

### 3D Cyclone Intelligence & Impact Simulation

The main demo should show:

- 3D Bay of Bengal globe
- Ocean-current visualization
- Wind visualization
- Sea-surface temperature
- Wave height
- Monitoring stations
- Cyclone track / forecast visualization
- Risk zones
- Timeline playback
- Impact analysis
- Evidence-based explanation

The timeline must support historical replay and forecast/projection views where source data supports them.

## 6. MVP Requirements

### Must work

- CesiumJS 3D globe
- Bay of Bengal camera positioning
- Layer controls
- Ocean-current visualization
- Wind visualization
- Cyclone track visualization
- Time slider / playback
- Monitoring stations
- Hazard/risk visualization
- Station detail panel
- Cyclone detail panel
- Impact-analysis panel
- Dashboard KPI cards
- Real-data adapter with simulated fallback
- Responsive desktop UI
- Basic Research Mode / Operations Mode separation

### Stretch

- SST visualization
- Wave-height visualization
- Salinity
- Chlorophyll
- Rainfall
- Flood/storm-surge layer
- Coastal-erosion layer
- Marine-protected-area layer
- Historical cyclone replay
- Scenario controls

## 7. Non-Goals for the 1–2 Day Prototype

Do not claim or implement as production capabilities:

- Independent cyclone forecasting
- Operational disaster warnings
- A new numerical ocean model
- A validated ML cyclone-prediction model
- Full national-scale data infrastructure
- Full user-management system
- Production-grade alert delivery
- Scientific validation of a model using assimilated observations without accounting for data assimilation

## 8. AI / Intelligence Positioning

The prototype should use the term **AI-assisted risk explanation** rather than claiming that the system independently forecasts cyclones.

The risk explanation should be based on available structured evidence such as:

- cyclone track/intensity information
- wind
- wave height
- sea-surface temperature
- location
- proximity to coastline
- population/exposure data when available

If the prototype uses a deterministic or weighted risk score, it must be labelled as a **prototype risk model / heuristic**, not a validated predictive model.

## 9. Success Criteria

A judge should be able to:

1. Open the 3D Bay of Bengal view.
2. Toggle environmental layers.
3. Play a time sequence.
4. Select a cyclone or an Argo float.
5. See the relevant measurements/track information.
6. See a per-depth model-vs-observation bias panel (the regional summary).
7. Understand why the prototype assigns a risk level, and that it is unvalidated.
8. See the source/data status for displayed information.

## 10. Trust Requirements

Every real-data visualization should expose:

- source
- timestamp
- units
- data status: Real / Simulated
- forecast vs observation status where applicable

Mock values must never be presented as live observations.

## 11. Source Strategy

Sources actually in use:

- **INCOIS** — RSMC HYCOM ocean model (currents, SST, salinity, SSH, MLD, TCHP)
- **Argo / INCOIS GDAC** — in-situ temperature & salinity profiles
- **NOAA NCEI** — IBTrACS North Indian Ocean best tracks

Copernicus Marine and NASA Earthdata were evaluated as candidates but no adapter
was ever built; there is no Copernicus or NASA integration in this codebase.

## 12. Constraints

- Build window: 1–2 days
- Stack: Next.js/React, CesiumJS, FastAPI/Python
- Deployment target: Vercel (frontend) + Railway or VPS (backend)
  - **Phase 3 assessment**: The frontend can deploy to Vercel as a standard Next.js app.
    The backend requires a persistent server (Railway, Fly.io, or VPS) because it uses
    xarray/netCDF4 — incompatible with Vercel's serverless runtime.
    Production REAL mode requires external dataset hosting (e.g., S3/GCS) for the 9.85 GB
    HYCOM NetCDF file. FIXTURE mode (committed synthetic fixtures) can deploy to Railway
    immediately without dataset hosting. See `docs/DEMO_RUNBOOK.md`.
- Real data + simulated fallback
- No dataset/API is currently supplied by the project owner

## 13. Future Direction

After the hackathon, the product can expand into:

- deeper research workflows
- observation–model agreement analysis
- anomaly exploration
- scientific validation tools
- additional datasets
- richer forecasting integrations
- role-specific operational dashboards
