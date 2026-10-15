# OceanLens — API Specification

## 1. API Style

REST JSON API using FastAPI.

Base path:

```text
/api
```

> [!NOTE]
> The actual base path is `/api`, not `/api/v1`. All routes below are relative to `/api`.

## 2. Health

### GET /api/health

Returns backend health.

Example:

```json
{
  "status": "ok"
}
```

## 3. System Status

### GET /api/status

Returns system status including Phase 3 data mode information.

Fields:

| Field | Type | Description |
|---|---|---|
| `mode` | string | Backward-compatible: `"REAL"` (production data present) or `"SIMULATED"` |
| `backendConnected` | bool | Always `true` when this endpoint is reached |
| `datasetLoaded` | bool | Whether a HYCOM dataset file is reachable at the configured path |
| `provider` | string | Data provider identifier |
| `dataMode` | `"REAL"\|"FIXTURE"` | **Phase 3** — explicit runtime data mode (set by `OCEANX_DATA_MODE` env var) |
| `datasetSynthetic` | bool | **Phase 3** — `true` when serving committed synthetic fixtures, not production data |

`dataMode` is determined exclusively by the `OCEANX_DATA_MODE` environment variable.
It is never inferred silently from file presence.

Do not expose secrets.

## Implemented Routes (as of Phase 3)

All routes are prefixed with `/api` (actual base path, not `/api/v1`).

| Route | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/status` | GET | System status + data mode (Phase 3) |
| `/api/datasets` | GET | Dataset metadata list |
| `/api/cyclones` | GET | Cyclone tracks |
| `/api/cyclones/inspect` | GET | Point/time cyclone inspection |
| `/api/hazards` | GET | Active hazards |
| `/api/risk/{hazard_id}` | GET | Risk assessment |
| `/api/timeseries` | GET | Available model timestamps |
| `/api/layers` | GET | GIS layer list (status coherent with data mode) |
| `/api/layers/{name}` | GET | Layer grid data |
| `/api/model/depth-slice` | GET | HYCOM depth slice (Phase 1A) |
| `/api/argo/floats` | GET | Argo float list |
| `/api/argo/profiles` | GET | Argo profile list |
| `/api/argo/profiles/{id}` | GET | Single Argo profile |
| `/api/argo/nearest` | GET | Nearest Argo profile by lat/lon |
| `/api/argo/{id}/observations` | GET | Profile depth observations |
| `/api/argo/{id}/matchup` | GET | Model–observation matchup (Phase 2A/2B/2C) |
| `/api/inspect` | GET | Point ocean data inspection |

> [!WARNING]
> `/api/v1/impact-analysis` is **not implemented** and does not exist in the current codebase.
> Remove any client references to this route.



## 4. Datasets

### GET /datasets

Query parameters:

- variable
- provider
- mode
- start
- end

Returns dataset metadata.

## 5. Stations — REMOVED

The `/stations` endpoint was removed. It returned three hardcoded buoys with
invented coordinates and measurements (one off the Saffir–Simpson scale), and
no real station feed is connected. It is intentionally absent rather than
mislabelled `SIMULATED`.

## 6. Observations

### GET /observations

Parameters:

- variable
- bbox
- start
- end
- depth
- source

Returns normalized observations.

## 7. Cyclones

### GET /cyclones

Parameters:

- start
- end
- basin
- status

### GET /cyclones/{cyclone_id}

Returns normalized track and metadata.

## 8. Hazards

### GET /hazards

Parameters:

- type
- severity
- bbox
- start
- end

## 9. Risk

### GET /risk/{hazard_id}

Returns the prototype risk assessment and evidence.

Example:

```json
{
  "score": 84,
  "category": "high",
  "model_type": "prototype_rule_based",
  "evidence": []
}
```

The example score is illustrative only and must not be hard-coded as a scientific result.

## 10. Time Series

### GET /timeseries

Parameters:

- variable
- latitude
- longitude
- start
- end

## 11. Layer Data

### GET /layers/{layer_name}

Supported layer names are determined by the configured data adapters.

Actually served (all backed by real INCOIS HYCOM output):

- currents
- sst
- salinity
- tchp
- ssh
- mld
- argo

Removed: `wind` (parametric model, no data) and `wave_height` (no data feed).
Masked land cells are returned as `null`, never `0.0`, and each response
reports `validCellCount` / `missingCellCount`.

## 11a. HYCOM Model Depth Slice (Phase 1A)

### GET /api/model/depth-slice

Returns a **HYCOM model depth slice**: the field from the single native
HYCOM model depth level nearest to the requested depth. Depth is **never
interpolated**; the response always reports both the requested depth and
the matched native model depth.

Query parameters:

- `variable` (required): `temperature` (aliases: `temp`, `sst`),
  `salinity`, `currents` (returns u/v), `ssh`, `tchp`, `mld`
- `depth` (required): requested depth in meters (>= 0)
- `timestamp` (optional): ISO timestamp; defaults to the first available
  model time. Must be within the dataset's time coverage.
- `stride` (optional, default 3): spatial downsampling stride

Response fields (beyond the standard layer grid shape):

- `requested_depth_m`: the depth the caller asked for
- `matched_depth_m`: the native HYCOM model depth actually used
- `available_depths_m`: all native model depth levels
- `depth_selection`: selection semantics description
- `missing_values`: count of NaN/missing grid cells (reported as `null`,
  never as 0.0)
- `dataset_file`: provenance - which NetCDF file served the slice
- `provenance`: compact scientific provenance object. Its `data_status` is
  one of `REAL`, `SIMULATED`, `DEMO`, or `UNAVAILABLE`; depth slices include
  provider, dataset, variable, units, matched timestamp, requested depth and
  matched native depth. The legacy top-level fields remain for compatibility.

Errors:

- `404` - unsupported variable (lists supported variables)
- `404` - timestamp outside dataset coverage (reports available range)
- `400` - malformed timestamp, negative/non-finite/too-deep depth
  (reports available depths)
- `422` - missing required query parameters
- `503` - depth-resolved HYCOM dataset not installed on the server

The dataset is opened once and cached; xarray lazy selection ensures only
the requested time/depth/variable slice is read from disk.

## 12. Data Source Metadata

Scientific visualization responses use the following compact provenance shape
where the metadata is genuinely available:

```json
{
  "source": "provider product or archive",
  "provider": "INCOIS",
  "dataset": "RSMC_hycom_20260908.nc",
  "variable": "temperature",
  "units": "°C",
  "timestamp": "2026-09-08T00:00:00Z",
  "requested_depth_m": 50,
  "matched_depth_m": 50,
  "processing_status": "native depth selection; no interpolation",
  "data_status": "REAL",
  "asset_id": "safe dataset/profile identifier",
  "source_url": "safe public reference"
}
```

`REAL` describes the origin of the underlying data and does not mean live or
uncached. Cached/static real data is not labeled `LIVE`. Curated fallback
profiles and synthetic demonstration content are labeled `DEMO`; unavailable
scientific values remain `UNAVAILABLE` rather than being replaced.

## 13. Error Contract

```json
{
  "error": {
    "code": "DATA_SOURCE_UNAVAILABLE",
    "message": "Source unavailable",
    "fallback_available": true
  }
}
```

## 14. Implementation Rule

The frontend must not call provider-specific APIs directly unless there is a deliberate architectural reason.

FastAPI remains the normalization boundary.

## 11b. Argo Model Matchup (Phase 2A/2B/2C)

### GET /api/argo/{profile_id}/matchup

Returns HYCOM model comparison data for an Argo profile. This endpoint
delivers all Phase 2A (model–observation matchup), Phase 2B (matchup
statistics), and Phase 2C (matchup diagnostics) information.

Response fields (key):

- `comparisons`: per-depth comparison rows (Argo vs HYCOM at nearest native model depth)
- `statistics.temperature` / `statistics.salinity`: N, meanResidual, MAE, RMSE
- `diagnostics`: coverage, time separation, horizontal distance, tolerance context
- `modelDataStatus`: `"REAL"` (production HYCOM) or `"SIMULATED"` (fixture)
- `residualConvention`: `"ΔT = HYCOM - Argo, ΔS = HYCOM - Argo"`

> [!IMPORTANT]
> When `modelDataStatus == "SIMULATED"`, the model values are synthetic
> fixture data — not scientific measurements. The frontend must display
> a clear warning.
