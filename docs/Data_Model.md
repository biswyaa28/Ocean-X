# OceanLens — Data Model

## 1. Design Principle

The model is provider-neutral. External data is normalized into a small set of domain objects used by the UI and risk engine.

## 2. Dataset

```text
Dataset
- id
- name
- provider
- variable
- description
- unit
- source_url
- mode: real | simulated | mixed
- temporal_coverage
- spatial_coverage
- update_status
- last_updated
```

## 3. Observation

```text
Observation
- id
- dataset_id
- variable
- latitude
- longitude
- depth
- value
- unit
- observed_at
- source_type
- quality_status
```

## 4. Forecast Point

```text
ForecastPoint
- forecast_id
- latitude
- longitude
- valid_time
- variable
- value
- unit
- source
- confidence
```

Confidence must only be shown when the source or prototype calculation actually defines it.

## 5. Cyclone

```text
Cyclone
- id
- name
- basin
- source
- status
- timestamp
- center_latitude
- center_longitude
- max_wind
- pressure
- track_points[]
```

Do not invent cyclone names or values in production data.

## 6. Track Point

```text
TrackPoint
- latitude
- longitude
- valid_time
- category
- wind
- pressure
- source
```

## 7. Monitoring Station

```text
Station
- id
- name
- latitude
- longitude
- region
- status
- source
- available_variables[]
```

## 8. Hazard

```text
Hazard
- id
- type
- severity
- geometry
- valid_from
- valid_to
- source
- confidence
- evidence[]
```

## 9. Risk Assessment

```text
RiskAssessment
- id
- hazard_id
- score
- category
- assessed_at
- model_type
- evidence[]
```

`model_type` should identify whether the result is:

- prototype_rule_based
- provider_forecast
- future_ml_model

## 10. Evidence

```text
Evidence
- variable
- value
- unit
- direction: increasing | decreasing | neutral | unknown
- source
- timestamp
- relevance
```

## 11. Explanation

```text
Explanation
- summary
- evidence[]
- limitations
- generated_at
```

An explanation must be traceable to the evidence supplied to it.

## 12. Data Provenance

Every displayed scientific value should retain:

- source
- timestamp
- unit
- variable
- processing status
- real/simulated status

## 13. Missing Data

Missing values must remain missing.

Do not replace missing scientific observations with arbitrary numbers.

Fallback data is allowed only at the dataset/application level and must be labelled.
