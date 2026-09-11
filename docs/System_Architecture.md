# OceanLens — System Architecture

## 1. Architecture Objective

Create a small, replaceable, source-agnostic architecture that can run with simulated data immediately and accept real datasets later without rewriting the frontend.

## 2. High-Level Architecture

```text
                    ┌─────────────────────┐
                    │      Next.js        │
                    │   React Frontend    │
                    └──────────┬──────────┘
                               │
                         REST / JSON
                               │
                    ┌──────────▼──────────┐
                    │       FastAPI       │
                    │ API + Data Adapter  │
                    └──────────┬──────────┘
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
      ┌──────▼─────┐    ┌──────▼─────┐    ┌──────▼─────┐
      │ Real Data  │    │ Simulated  │    │   Future   │
      │ Adapters   │    │  Fallback  │    │  Adapters  │
      └──────┬─────┘    └──────┬─────┘    └────────────┘
             │                 │
             └────────┬────────┘
                      ▼
               Normalized Domain
                     Model
```

## 3. Frontend

Recommended:

- Next.js
- React
- TypeScript
- CesiumJS
- A charting library such as Recharts or ECharts

Responsibilities:

- UI
- Cesium scene
- layer state
- timeline
- charts
- detail panels
- source/status display

The frontend must not contain provider-specific parsing logic.

## 4. Cesium Layer

CesiumJS is responsible for:

- 3D globe
- terrain/imagery
- camera
- entities
- polylines
- polygons
- time-dynamic entities
- visualization overlays

The project should keep environmental rendering components separate from business logic.

## 5. Backend

FastAPI responsibilities:

- normalized API
- data-source adapters
- simulation fallback
- basic risk calculation
- validation
- source metadata
- health endpoint

## 6. Data Adapter Pattern

Each provider should be isolated behind an adapter interface.

```text
Provider Adapter
    ↓
Provider-specific response
    ↓
Normalizer
    ↓
OceanLens domain object
    ↓
API
```

This allows a source to be replaced without changing Cesium components.

## 7. Data Modes

### Real

Data successfully obtained from a configured source.

### Simulated

Deterministic local data used when a real source is unavailable.

### Mixed

Some layers use real data while unavailable layers use simulated data.

The API should expose the mode per dataset/layer.

## 8. Risk Engine

For the prototype:

```text
Input evidence
   ↓
Validation
   ↓
Prototype risk rules
   ↓
Risk score/category
   ↓
Evidence list
   ↓
Explanation
```

Do not label this as a validated ML model.

## 9. Persistence

For the 1–2 day MVP, persistent storage is optional.

Preferred progression:

1. Static JSON/CSV for the first working demo.
2. PostgreSQL/PostGIS only if needed for persistent/queryable spatial data.
3. Add migrations after the core demo is stable.

## 10. Deployment

```text
Git repository
   │
   ├── Frontend → Vercel
   │
   └── Backend  → Railway
```

Environment variables must hold secrets and provider configuration.

## 11. Security Baseline

- No secrets in source code
- CORS restricted to frontend origin in deployed environments
- Validate incoming parameters
- Rate-limit external provider requests if required
- Do not expose provider credentials to the browser

## 12. Reliability Principle

A provider failure must degrade gracefully:

```text
Real source unavailable
        ↓
adapter error
        ↓
fallback dataset
        ↓
UI says "Simulated"
```

Never silently substitute simulated data while displaying it as real.
