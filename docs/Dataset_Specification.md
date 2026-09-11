# OceanLens — Dataset Specification

## 1. Data Policy

The prototype uses a **real + simulated fallback** architecture.

Real data must retain source metadata.

Simulated data must be explicitly labelled.

## 2. Candidate Official Sources

### INCOIS Ocean State Forecast

INCOIS publishes ocean-state information including waves, winds, currents, water temperature and cyclone heat potential. Its service describes forecasts at 3-hour intervals for the next 5–10 days. Use the official service and its terms/access mechanisms rather than scraping blindly.

Official:
https://www.incois.gov.in/site/services/osf.jsp

Current OSF:
https://www.incois.gov.in/oceanservices/osfforecast.jsp

### Copernicus Marine Service

The Copernicus Marine Data Store provides global marine products. Current catalogue entries include physics analysis/forecast products with temperature, salinity, sea-surface height, velocity and wave-related products, plus biogeochemical products.

Official:
https://data.marine.copernicus.eu/

### NOAA IBTrACS

IBTrACS is a global tropical-cyclone best-track archive and provides historical/current best-track data through formats including NetCDF, CSV and shapefiles.

Official:
https://www.ncei.noaa.gov/products/international-best-track-archive

### NASA Earthdata

NASA Earthdata Search provides discovery of Earth-science observations with temporal and spatial search.

Official:
https://search.earthdata.nasa.gov/

## 3. Recommended Prototype Source Priority

### Priority 1

IBTrACS for historical cyclone tracks.

Reason: directly useful for the hero cyclone visualization and available in machine-readable formats.

### Priority 2

INCOIS OSF for Indian-ocean/bay-relevant ocean variables.

### Priority 3

Copernicus Marine for broader ocean physics/biogeochemistry.

### Priority 4

NASA Earthdata for additional Earth-observation datasets.

## 4. Data Acquisition Rule

Before implementation, verify:

- access method
- licence/terms
- required credentials
- request limits
- update frequency
- spatial/temporal coverage
- units
- coordinate reference system
- missing-data conventions

## 5. Initial Variables

MVP:

- cyclone position
- cyclone intensity where available
- wind
- wave height
- current
- sea-surface temperature
- salinity where available

Stretch:

- chlorophyll
- rainfall
- flood/storm surge
- coastal erosion
- marine protected areas

## 6. Normalization

All providers must be normalized into the OceanLens domain model.

Example:

```text
Provider field
     ↓
OceanLens variable
     ↓
standard unit
     ↓
API
     ↓
Cesium / chart
```

## 7. Simulated Data

Simulation is allowed for:

- demo-only environmental fields
- unavailable provider data
- controlled time-series replay

Simulation must include metadata:

```text
mode = simulated
```

## 8. Scientific Caution

Do not use a model product as if it were an independent observation.

The project research notes specifically identify data-assimilation concerns for some ocean reanalysis products. Therefore, model–observation comparisons must be described carefully.

## 9. Source Attribution

Every dataset shown in the UI should expose the provider name and source link.
