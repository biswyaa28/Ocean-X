# OceanLens — GIS / CesiumJS Specification

## 1. Goal

Use CesiumJS as the core 3D spatial visualization layer.

CesiumJS supports a 3D globe with terrain and imagery layers and is suitable for the intended globe-based experience.

## 2. Initial Camera

On application start:

```text
Earth
  ↓
Indian Ocean
  ↓
Bay of Bengal
```

The camera should use a smooth fly-to transition.

## 3. Base Globe

Preferred options:

- Cesium World Terrain / configured terrain source
- configured imagery source

Credentials and usage limits must be respected.

## 4. Vector Layers

### Coastline

Polyline / polygon boundary layer.

### Monitoring Stations

Point entities with:

- station icon
- status
- click interaction

### Cyclone Track

Time-aware polyline.

### Forecast Cone

Polygon geometry only when supplied/derived from a documented source or explicitly marked simulated.

### Risk Zones

Polygon or raster-derived geometry.

## 5. Environmental Layers

Possible visual approaches:

### Currents

- particle/flow visualization
- arrows/streamlines

### Wind

- particle/flow visualization

### SST

- raster/grid colour field

### Wave Height

- raster/grid or interpolated field

### Salinity

- raster/grid colour field

### Chlorophyll

- raster/grid colour field

The MVP may simulate some fields if real data access is not ready.

## 6. Time-Dynamic Visualization

Cesium entities should use time-aware positions/properties where appropriate.

Concept:

```text
Time
 ↓
Current layer state
 ↓
Cyclone position
 ↓
Risk state
 ↓
UI metrics
```

All time-dependent components must use the same application clock where practical.

## 7. Interaction

Clicking a spatial feature should open its information panel.

Examples:

- station → station details
- cyclone → cyclone details
- risk area → risk details
- current field → local value/metadata

## 8. Visual Hierarchy

The globe is the hero.

Avoid:

- excessive labels
- too many simultaneous overlays
- excessive animation
- unreadable particle density

## 9. Performance

For a 1–2 day prototype:

- limit active particles
- avoid rendering unnecessary layers simultaneously
- simplify geometry
- lazy-load nonessential panels
- keep data payloads small

## 10. Scientific Integrity

A visually realistic layer is not automatically a scientifically accurate layer.

Every simulated layer must be labelled.

The prototype must not imply that simulated particles represent measured ocean flow.
