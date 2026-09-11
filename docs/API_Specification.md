# OceanLens — API Specification

## 1. API Style

REST JSON API using FastAPI.

Base path:

```text
/api/v1
```

## 2. Health

### GET /health

Returns backend health.

Example:

```json
{
  "status": "ok"
}
```

## 3. System Status

### GET /status

Returns:

- backend status
- data mode
- configured providers
- last successful source access

Do not expose secrets.

## 4. Datasets

### GET /datasets

Query parameters:

- variable
- provider
- mode
- start
- end

Returns dataset metadata.

## 5. Stations

### GET /stations

Optional:

- bbox
- variable
- status

### GET /stations/{station_id}

Returns station metadata and available measurements.

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

Possible MVP layers:

- currents
- wind
- sea_surface_temperature
- wave_height
- cyclone
- stations
- risk

## 12. Data Source Metadata

Every scientific response should include:

```json
{
  "source": "provider name",
  "source_url": "provider URL",
  "mode": "real",
  "retrieved_at": "timestamp",
  "units": "unit"
}
```

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
