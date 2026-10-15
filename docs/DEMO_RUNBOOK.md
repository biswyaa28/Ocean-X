# OCEAN-X — Demo & Judge Runbook

**SIH26067 · Phase 3 · September 2026**

This runbook explains how to reproduce, run, and demonstrate the OCEAN-X prototype. It covers both FIXTURE demo mode (no production data required) and REAL mode (with production HYCOM data installed).

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | ≥ 3.10 | For backend |
| Node.js | ≥ 20.9 | For frontend (Next.js 16 requires `>=20.9.0`) |
| npm | ≥ 9.0 | |
| Git | Any | Clone repo |
| Ports | 8000, 3000 | Backend and frontend |

No Rust, Docker, or cloud infrastructure is required for a local demo.

---

## Environment Variables

| Variable | Values | Default | Purpose |
|---|---|---|---|
| `OCEANX_DATA_MODE` | `REAL`, `FIXTURE` | `REAL` | Explicit data mode switch |
| `OCEANX_RAW_HYCOM_FILE` | path | auto | Override raw HYCOM NetCDF path |
| `OCEANX_PROCESSED_OCEAN_FILE` | path | auto | Override processed surface NetCDF path |
| `NEXT_PUBLIC_API_URL` | URL | `http://127.0.0.1:8000/api` | Frontend API base |

---

## Option A — FIXTURE Mode (Recommended for Demo)

FIXTURE mode uses committed synthetic schema-compatible NetCDF fixtures. **No production data download is required.** All API endpoints work. Values are constant placeholders — not real ocean measurements.

### 1. Clone and setup

```bash
git clone <repo-url>
cd Ocean-X

# Backend dependencies
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Verify fixtures are present

```bash
OCEANX_DATA_MODE=FIXTURE python ../scripts/check-data.py
```

Expected output:
```
OCEAN-X Data Mode: FIXTURE
...
Required HYCOM data available: YES (synthetic fixtures)
NOTE: These are SYNTHETIC TEST FIXTURES.
```

### 3. Start backend in FIXTURE mode

```bash
cd backend
OCEANX_DATA_MODE=FIXTURE .venv/bin/uvicorn app.main:app --reload --port 8000
```

### 4. Verify backend status

```bash
curl http://localhost:8000/api/status
```

Expected:
```json
{
  "mode": "SIMULATED",
  "backendConnected": true,
  "datasetLoaded": true,
  "provider": "INCOIS & NOAA IBTrACS",
  "dataMode": "FIXTURE",
  "datasetSynthetic": true
}
```

Verify layer coherence:
```bash
curl http://localhost:8000/api/layers | python3 -c "import json,sys; [print(l['id'], l['status']) for l in json.load(sys.stdin)]"
```

Expected: HYCOM layers (`currents`, `sst`, `salinity`, `tchp`) → `SIMULATED`. Argo → `REAL`.

### 5. Start frontend

```bash
cd frontend
npm install
npm run dev
```

Open: **http://localhost:3000**

### 6. Confirm synthetic banner

The Header must display:
```
DATA: SYNTHETIC FIXTURE — NOT SCIENTIFIC EVIDENCE
```
in amber. This banner is always visible in FIXTURE mode and cannot be dismissed.

---

## Option B — REAL Mode (Production Data)

> [!WARNING]
> REAL mode requires the INCOIS HYCOM raw NetCDF file (~10.58 GB). This file must be installed separately.

### 1. Preflight check

```bash
python scripts/check-data.py
```

Expected when data is installed:
```
Required HYCOM data available: YES
```

If data is missing:
```
Required HYCOM data available: NO
Run: python scripts/setup-data.py
```

### 2. Install data (if missing)

```bash
python scripts/setup-data.py --check       # see what's needed
python scripts/setup-data.py --download    # download (~10.58 GB, confirmation required)
python scripts/setup-data.py --process     # generate processed surface file
```

### 3. Start backend

```bash
cd backend
OCEANX_DATA_MODE=REAL .venv/bin/uvicorn app.main:app --reload --port 8000
```

### 4. Verify status

```bash
curl http://localhost:8000/api/status
```

Expected with data present:
```json
{
  "mode": "REAL",
  "datasetLoaded": true,
  "dataMode": "REAL",
  "datasetSynthetic": false
}
```

Frontend shows: `DATA: REAL` (emerald).

---

## Demo Workflow

### Argo Profile Matchup (Phase 2A / 2B / 2C)

```
1. Open http://localhost:3000
2. In the left LayerControl, enable ARGO OBSERVATIONS
3. Click any Argo float marker on the globe
4. In the right drawer: click PROFILE tab
   → See in-situ depth profile (temperature / salinity vs depth)
5. Click MODEL COMPARISON tab
   → See HYCOM model values overlaid on Argo observations
   → See residuals (ΔT = HYCOM − Argo)
   → In FIXTURE mode: note "HYCOM MODEL — SYNTHETIC FIXTURE" label
6. Scroll to MATCHUP STATISTICS
   → N (valid matched pairs), Mean Residual, MAE, RMSE
   → In FIXTURE mode: banner "SYNTHETIC FIXTURE-BACKED STATISTICS"
7. Scroll to MATCHUP DIAGNOSTICS
   → Coverage %, time separation, horizontal distance, depth context
```

### Cyclone Storm Intelligence

```
1. The globe opens on the Bay of Bengal
2. Click the cyclone track → Storm Intelligence panel opens (right)
3. KPI ribbon: active cyclones, max wind, SST, coastal risk
4. Timeline (bottom): scrub through track timestamps
5. Risk Assessment: score, category, evidence factors, limitations
```

---

## Running Tests

### Backend

```bash
cd backend
source .venv/bin/activate

# Full suite (uses fixture mode automatically when no production data)
python -m pytest -q tests/

# Data mode coherence tests specifically (Phase 3)
python -m pytest -q tests/test_data_mode.py

# Fixture mode API tests
OCEANX_DATA_MODE=FIXTURE python -m pytest -q tests/test_api.py
```

Expected: all pass, ~10 skipped (real-data-only integration tests).

### Frontend

```bash
cd frontend
npx tsc --noEmit         # TypeScript check
npx vitest run           # full Vitest suite
```

---

## API Endpoint Quick Reference

| Endpoint | Fixture Mode Response |
|---|---|
| `GET /api/status` | `dataMode=FIXTURE`, `datasetSynthetic=true`, `mode=SIMULATED` |
| `GET /api/layers` | HYCOM layers: `status=SIMULATED`, Argo: `status=REAL` |
| `GET /api/layers/currents` | `status=SIMULATED`, synthetic u/v values |
| `GET /api/model/depth-slice` | `status=SIMULATED`, synthetic grid |
| `GET /api/argo/{id}/matchup` | `modelDataStatus=SIMULATED`, synthetic comparison |

---

## Deployment Notes

**Real-production HYCOM runtime verification: NOT PERFORMED**

Production data (`RSMC_hycom_20260908.nc`, ~10.58 GB) is not installed in the CI/CD environment. All runtime verification was performed in FIXTURE mode.

### Current deployment status

| Target | Status | Blocker |
|---|---|---|
| **Local (FIXTURE mode)** | ✅ Fully supported | None |
| **Local (REAL mode)** | ✅ Supported with data | Requires 10.58 GB HYCOM file |
| **Docker (FIXTURE mode)** | ✅ Dockerfile provided | Build and run `backend/Dockerfile` |
| **Railway (backend)** | ⚠️ Partial | FIXTURE mode works; REAL mode blocked by 10.58 GB dataset hosting |
| **Vercel (frontend)** | ✅ Standard Next.js deploy | Set `NEXT_PUBLIC_API_URL` to backend URL |
| **Vercel (backend)** | ❌ Not supported | Vercel serverless is incompatible with xarray/netCDF4 |

The PRD claim of "Vercel + Railway" is partially accurate: the **frontend** can deploy to Vercel; the **backend** requires a persistent server (Railway, Fly.io, or a VPS). Production data hosting requires external storage (e.g., S3/GCS) linked to the deployment.

---

## Data Mode Honesty Policy

| Situation | `dataMode` | `datasetSynthetic` | Frontend indicator |
|---|---|---|---|
| REAL mode, production data present | `REAL` | `false` | `DATA: REAL` (emerald) |
| REAL mode, no production data | `REAL` | `false` | `DATA: REAL — DATASET UNAVAILABLE` |
| FIXTURE mode | `FIXTURE` | `true` | `DATA: SYNTHETIC FIXTURE — NOT SCIENTIFIC EVIDENCE` (amber, persistent) |

FIXTURE mode never activates silently. It requires explicit `OCEANX_DATA_MODE=FIXTURE`.
