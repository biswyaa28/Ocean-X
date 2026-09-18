# OCEAN-X Backend — Minimal FIXTURE-mode demo container
#
# This image runs the backend in FIXTURE mode by default (OCEANX_DATA_MODE=FIXTURE).
# No production HYCOM data is required: the committed synthetic schema-compatible
# fixtures from tests/fixtures/ are used automatically.
#
# For production/REAL mode you would need to mount or copy the production datasets
# and set OCEANX_DATA_MODE=REAL (and provide OCEANX_RAW_HYCOM_FILE etc.).
#
# Build:
#   docker build -t oceanx-backend .
# Run (FIXTURE mode, default):
#   docker run -p 8000:8000 oceanx-backend
# Run (REAL mode, with data mounted):
#   docker run -p 8000:8000 \
#     -v /your/data/path:/data \
#     -e OCEANX_DATA_MODE=REAL \
#     -e OCEANX_RAW_HYCOM_FILE=/data/RSMC_hycom_20260908.nc \
#     oceanx-backend

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for netCDF4 / HDF5
RUN apt-get update && apt-get install -y --no-install-recommends \
    libhdf5-dev \
    libnetcdf-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY app/ ./app/
# Copy committed test fixtures (required for FIXTURE mode)
COPY tests/fixtures/ ./tests/fixtures/

# Default: FIXTURE demo mode — synthetic data, no production files required.
# Override with -e OCEANX_DATA_MODE=REAL for production.
ENV OCEANX_DATA_MODE=FIXTURE
ENV HOST=0.0.0.0
ENV PORT=8000

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
