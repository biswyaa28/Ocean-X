# OCEAN-X Backend Service

**Smart India Hackathon SIH26067**  
*Web-Based Interactive 3D Visualization Platform Integrating Numerical Ocean Model Outputs and In-Situ Observations.*

---

## 1. Backend Purpose & Architecture

The OCEAN-X backend provides a high-performance scientific REST API for ocean numerical models and in-situ observation comparisons. It establishes:

- **FastAPI Core**: Asynchronous API endpoints with strict Pydantic schemas.
- **Service Layer**: Clean separation of model slicing, observation parsing, spatial/temporal co-location, and statistical calculations.
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
│   │   └── config.py        # Environment & demonstration region config
│   ├── data/
│   │   └── fixtures.py      # Deterministic local scientific fixtures
│   ├── models/
│   │   └── schemas.py       # Pydantic data schemas & Provenance definitions
│   ├── services/
│   │   ├── argo_service.py  # Profile retrieval & QC flag handling
│   │   ├── comparison_service.py # 4D matching, RMSE, bias, residual calculation
│   │   └── model_service.py # Grid slicing & metadata provider
│   └── main.py              # FastAPI app creation & CORS configuration
├── tests/
│   ├── test_argo.py
│   ├── test_comparison.py
│   ├── test_health.py
│   ├── test_metadata.py
│   └── test_model.py
├── requirements.txt
└── README.md
```

---

## 2. Environment Setup & Installation

### Prerequisites
- Python 3.10+ (Tested on Python 3.14)

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

---

## 4. Running Tests

The test suite runs completely offline with 0 network calls:

```bash
pytest -v
```

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

## 6. Scientific Terminology & Future Pipeline

- **Residual Definition**: Residuals are calculated strictly as `Model Analysis Value - In-situ Observation Value` and labeled **`Analysis–Observation Residual`** (reflecting GLORYS12V1's nature as an assimilative analysis).
- **QC Handling**: Levels with `QC != 1` are excluded from statistical metrics (`bias`, `MAE`, `RMSE`, `max_residual`) and reported in provenance metadata.
- **Future Integration (Step 3B / Step 4)**: The service layer boundaries in `model_service.py` and `argo_service.py` will connect to xarray/NetCDF loaders and the scientific pipeline (using `depth = -gsw.z_from_p(p, latitude)`) without changing the API schema.

---

## 7. Current Limitations

1. **Deterministic Local Fixtures**: Endpoints currently read from synthetic fixtures in `app/data/fixtures.py`. No live connection to Copernicus Marine or Argo GDAC is made.
2. **Horizontal Grid**: Demonstration fixture uses a 5° grid representation for rapid testing before full 1/12° dataset ingestion.
