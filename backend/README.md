# OCEAN-X Backend Service

**Smart India Hackathon SIH26067**  
*Web-Based Interactive 3D Visualization Platform Integrating Numerical Ocean Model Outputs and In-Situ Observations.*

Version `0.3.1-dev`

---

## 1. Backend Purpose & Architecture

The OCEAN-X backend provides a high-performance scientific REST API for ocean numerical models and in-situ observation comparisons. It establishes:

- **FastAPI Core**: Asynchronous API endpoints with strict Pydantic schemas.
- **Service Layer**: Clean separation of model slicing, observation parsing, spatial/temporal co-location, and statistical calculations.
- **Datasource Layer**: A swappable model backend (`fixture` or `netcdf`) behind a single interface. Switching sources changes no API contract and no service signature.
- **Scientific Pipeline**: Independently testable stages from raw Argo profile to residual statistics.
- **Deterministic Fixtures**: Offline fixtures mimicking Copernicus Marine GLORYS12V1 (40°E–100°E, 30°S–30°N) and Argo profiles.
- **Scientific Integrity**: Adheres to formal oceanographic nomenclature (**Analysis–Observation Residual**) and preserves observation quality control (QC) exclusions without zero-filling or silent interpolation.

### Directory Structure

```text
backend/
├── app/
│   ├── api/
│   │   ├── argo.py          # GET /api/argo, GET /api/argo/{profile_id}
│   │   ├── comparison.py    # GET /api/comparison/{profile_id}
│   │   ├── metadata.py      # GET /api/metadata
│   │   └── model.py         # GET /api/model/times, depths, slice
│   ├── core/
│   │   └── config.py        # Environment, region, QC and tolerance policy
│   ├── data/
│   │   ├── argo_repository.py # Argo profile store & lookup
│   │   └── fixtures.py      # Deterministic local scientific fixtures
│   ├── datasources/         # Swappable model data backends
│   │   ├── base.py          # ModelDataSource interface + value objects
│   │   ├── factory.py       # Cached source selected by settings.MODEL_SOURCE
│   │   ├── fixture_source.py # Offline deterministic fixture backend
│   │   ├── netcdf_source.py # xarray/NetCDF backend for real GLORYS12V1
│   │   └── variables.py     # Logical -> dataset variable name resolution (§5)
│   ├── models/
│   │   └── schemas.py       # Pydantic data schemas & Provenance definitions
│   ├── science/             # Scientific pipeline stages (§2, §21, §22)
│   │   ├── argo_profile.py  # Raw/processed observation profile types
│   │   ├── colocation.py    # Nearest-cell space & time matching (§12)
│   │   ├── depth.py         # TEOS-10 pressure <-> depth (§14)
│   │   ├── pipeline.py      # Stage orchestration & failure reporting
│   │   ├── profile_processing.py # DATA_MODE / adjusted-variable selection (§9)
│   │   ├── provenance.py    # Reproducibility metadata (§18)
│   │   ├── qc.py            # Argo quality-control policy (§7)
│   │   ├── residuals.py     # Residuals, bias, MAE, RMSE (§17)
│   │   └── vertical.py      # Vertical alignment / interpolation (§14)
│   ├── services/
│   │   ├── argo_service.py  # Profile retrieval & QC flag handling
│   │   ├── comparison_service.py # API mapping of pipeline results
│   │   └── model_service.py # Grid slicing & metadata provider
│   └── main.py              # FastAPI app creation & CORS configuration
├── tests/
│   ├── conftest.py          # Shared offline fixtures & profile builders
│   ├── test_argo.py
│   ├── test_comparison.py
│   ├── test_datasources.py
│   ├── test_health.py
│   ├── test_metadata.py
│   ├── test_model.py
│   ├── test_science_colocation.py
│   ├── test_science_depth.py
│   ├── test_science_pipeline.py
│   ├── test_science_qc.py
│   ├── test_science_residuals.py
│   └── test_science_vertical.py
├── requirements.txt
└── README.md
```

---

## 2. Environment Setup & Installation

### Prerequisites
- Python 3.10+ (developed against 3.11 and 3.14)

### Virtual Environment Setup
```bash
# Navigate to the backend folder
cd backend

# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate  # On macOS/Linux
# or .venv\Scripts\activate on Windows

# Install dependencies
pip install -r requirements.txt
```

---

## 3. Running FastAPI

To run the development server:

```bash
uvicorn app.main:app --reload --port 8000
```

- **Interactive Swagger Docs**: `http://localhost:8000/docs`
- **ReDoc Documentation**: `http://localhost:8000/redoc`
- **Health Endpoint**: `http://localhost:8000/api/health`

CORS is currently permissive (`allow_origins=["*"]`) so the Vite frontend can call the API during development. Tighten this before any deployment.

---

## 4. Running Tests

The test suite runs completely offline with 0 network calls (**255 tests** across 12 files):

```bash
pytest -v
```

| Test file | Tests | Focus |
|---|---|---|
| `test_datasources.py` | 59 | Source swapping, variable discovery, unit normalisation |
| `test_science_vertical.py` | 35 | Vertical alignment and interpolation |
| `test_science_residuals.py` | 34 | Residual sign convention, bias, MAE, RMSE |
| `test_science_pipeline.py` | 34 | End-to-end stage ordering and failure modes |
| `test_science_qc.py` | 31 | Argo QC flag acceptance and exclusion reporting |
| `test_science_colocation.py` | 31 | Spatial/temporal matching and tolerance validation |
| `test_science_depth.py` | 18 | TEOS-10 pressure ↔ depth conversion |
| `test_model.py` / `test_argo.py` | 8 | Model and observation API endpoints |
| `test_comparison.py` / `test_metadata.py` / `test_health.py` | 5 | Comparison API, metadata and health |

---

## 5. API Endpoints Summary

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status |
| `GET` | `/api/metadata` | Target dataset (`GLOBAL_MULTIYEAR_PHY_001_030`) and runtime metadata |
| `GET` | `/api/model/times` | Available model time steps (7 daily steps) |
| `GET` | `/api/model/depths` | Available standard depth levels (0m to 1000m, 13 levels) |
| `GET` | `/api/model/slice` | 2D horizontal field slice (`?time=0&depth=0&variable=temperature`) |
| `GET` | `/api/argo` | List of available Argo observation summaries |
| `GET` | `/api/argo/{profile_id}` | Vertical observation levels with QC flags |
| `GET` | `/api/comparison/{profile_id}` | Co-located model slice vs observation with Analysis–Observation Residual & provenance |

---

## 6. Scientific Pipeline

Stage order, as implemented in `app/science/pipeline.py`:

```text
Argo profile
  -> quality control
  -> adjusted-variable selection where available
  -> DATA_MODE handling
  -> pressure to depth conversion (TEOS-10)
  -> model spatial co-location (nearest grid cell)
  -> model temporal co-location (nearest timestamp)
  -> tolerance validation (±12 h)
  -> vertical alignment (linear interpolation)
  -> residual calculation (D = M - O)
  -> bias / MAE / RMSE
  -> provenance
```

Each stage lives in its own module and is independently testable. The pipeline only
sequences them, and reports failures without fabricating a comparison.

### Terminology

- **Residual Definition**: Residuals are calculated strictly as `D = M - O`
  (model analysis value minus in-situ observation value) and labeled
  **`Analysis–Observation Residual`**, reflecting GLORYS12V1's nature as an
  assimilative analysis. It is never labeled "model error".
- **QC Handling**: Levels whose QC flag is not in `ACCEPTABLE_QC_FLAGS`
  (`{1, 2}` by default) are excluded from statistical metrics (`bias`, `mae`,
  `rmse`, `max_abs_residual`) and reported in provenance metadata, together with
  the reason for each exclusion. Missing values are never treated as zero.
- **Units**: Recognised unit spellings are normalised via `UNIT_ALIASES` in
  `core/config.py`. An unrecognised spelling resolves to `unknown` rather than
  being assumed (§19).
- **Provenance**: A first-class scientific output carrying enough information to
  reproduce the reasoning behind a comparison. Unavailable metadata is reported
  as `None` — never invented, never defaulted to a plausible-looking value (§18).

### Failure Reporting

When no scientifically defensible comparison exists, the endpoint returns
`is_valid: false`, empty residuals and `None` metrics — never `0.0`, which would
be a physical claim of perfect agreement. Provenance explains which of these
applied: `no_observations_passed_qc`, `no_valid_model_match`,
`no_common_comparison_depths`, `variable_unavailable`, `data_mode_rejected`.

---

## 7. Model Data Sources

The model backend is selected by `settings.MODEL_SOURCE` in `app/core/config.py`:

| Value | Implementation | Behaviour |
|---|---|---|
| `fixture` *(default)* | `fixture_source.py` | Deterministic offline data; no network, no files |
| `netcdf` | `netcdf_source.py` | Real NetCDF/xarray dataset at `MODEL_NETCDF_PATH` |

Both implementations satisfy the same interface, so switching sources requires no
change to any API contract or service signature — this equivalence is asserted by
`test_the_pipeline_runs_unchanged_against_a_real_netcdf_source`.

When reading NetCDF, logical variable names are resolved against
`VARIABLE_CANDIDATES` (e.g. `temperature` → `thetao`), and the actual resolved
name is always reported in provenance. A missing required variable is a hard
failure, never a silent fallback. Chunking is passed to `xarray.open_dataset`
and degrades gracefully when no chunk manager (dask) is installed.

---

## 8. Current Limitations

1. **Deterministic Local Fixtures (default)**: The default `fixture` source reads
   from synthetic data in `app/data/fixtures.py`. No live connection to
   Copernicus Marine or the Argo GDAC is made. The `netcdf` source path exists and
   is tested, but requires a local GLORYS12V1 file to be configured.
2. **Horizontal Grid**: The demonstration fixture uses a **1° × 1°** grid
   (61 × 61 cells over 40°E–100°E, 30°S–30°N) with 13 depth levels and 7 daily
   time steps — coarse enough to stay lightweight, fine enough that
   nearest-grid-cell co-location distances remain representative (≲80 km),
   pending ingestion of the full 1/12° dataset.
3. **Salinity**: Supported by the backend contract, but treated as a Phase 2
   extension in the demonstration frontend.
