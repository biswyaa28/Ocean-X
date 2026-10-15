# OceanLens — Bay of Bengal

OceanLens is a hackathon prototype for exploring Bay of Bengal marine and hazard information through an interactive 3D interface.

## Core Concept

**Observe → Analyze → Predict/Project → Explain → Assess Impact**

## Prototype Positioning

OceanLens is a visualization and decision-support prototype.

It is **not** an official warning system and does not claim to replace INCOIS, IMD, NOAA, or other authoritative forecasting services.

## Primary Hero Feature

### 3D Cyclone Intelligence & Impact Simulation

The prototype combines:

- CesiumJS 3D globe
- ocean-current visualization
- wind visualization
- cyclone tracks
- timeline playback
- monitoring stations
- risk visualization
- evidence-based explanation
- impact analysis

## Technology

### Frontend

- Next.js
- React
- TypeScript
- CesiumJS

### Backend

- FastAPI
- Python

### Deployment

- Vercel
- Railway

### Optional persistence

**Not used.** There is no database in this codebase — the backend reads NetCDF
and JSON files directly and serves them as a stateless REST API. PostgreSQL /
PostGIS appeared in early planning notes only.

## Data Strategy

Real data first, with an explicitly-labelled demo fallback when the backend is
unreachable. Sources actually integrated:

- **INCOIS** — RSMC HYCOM ocean model
- **Argo / INCOIS GDAC** — in-situ profiles
- **NOAA IBTrACS** — cyclone best tracks

See `Dataset_Specification.md` and the **Data** section of the root `README.md`
for exactly which files ship in Git and which must be installed separately.

## Repository Structure

```text
oceanlens/
├── frontend/
├── backend/
├── data/
├── docs/
├── tests/
├── .env.example
└── README.md
```

## Important Trust Rule

If data is simulated, the interface must say so.

Never display simulated values as live measurements.

## Local Development

Frontend and backend setup commands should be added once the exact package/tooling configuration is chosen.

Do not copy production credentials into the repository.

## Environment Variables

Expected categories may include:

```text
CESIUM_ION_TOKEN=
API_BASE_URL=
DATA_PROVIDER_*
```

Only variables actually used by the implementation should be added to `.env.example`.

## Demo Flow

1. Open OceanLens.
2. Fly to Bay of Bengal.
3. Enable currents and wind.
4. Select cyclone layer.
5. Select a cyclone.
6. Play the timeline.
7. Open impact analysis.
8. Inspect evidence.
9. Show risk category.
10. Show source/data status.

## Scientific Integrity

This project intentionally distinguishes:

- observations
- forecasts
- historical records
- simulations
- prototype risk calculations

The prototype must not claim independent cyclone forecasting unless a validated forecasting method is actually implemented and evaluated.

## Future Work

Potential future modules:

- observation–model agreement analysis
- anomaly explorer
- deeper ocean profiles
- research dataset comparison
- advanced predictive models
- operational integrations
- role-specific workflows
