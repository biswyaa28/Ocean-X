# OceanLens — UI/UX Specification

## 1. Design Direction

Visual target:

- professional scientific dashboard
- dark ocean/navy base
- strong 3D globe focus
- restrained accent colours
- high information density without visual clutter

## 2. Main Screen

The main screen opens directly into the 3D Bay of Bengal experience.

### Layout

```text
┌────────────────────────────────────────────────────┐
│ Header / Navigation                                │
├──────────┬───────────────────────────┬─────────────┤
│ Layers   │                           │ Intelligence│
│          │       Cesium 3D Globe     │ / Alerts   │
│          │                           │             │
├──────────┴───────────────────────────┴─────────────┤
│ KPI / Status Strip                                 │
├────────────────────────────────────────────────────┤
│ Timeline / Playback                                │
└────────────────────────────────────────────────────┘
```

## 3. Primary Navigation

Suggested:

- Map
- Dashboard
- Analytics
- Datasets
- Hazards
- Stations
- Reports

## 4. Layer Panel

Initial layers:

- Coastline & borders
- Ocean currents
- Wind
- Sea-surface temperature
- Wave height
- Salinity
- Chlorophyll
- Cyclone
- Rainfall
- Flood/storm surge
- Coastal erosion
- Monitoring stations
- Risk zones
- Marine protected areas

Only implemented layers should be enabled.

## 5. Intelligence Panel

For a selected hazard:

- hazard type
- status
- source
- timestamp
- relevant measurements
- track/forecast information if available
- affected area
- prototype risk assessment
- evidence
- limitations

## 6. Time Controls

Support:

- play
- pause
- previous
- next
- current time
- historical time
- forecast/projection time where source data supports it

## 7. Status Labels

Every data visualization should make clear:

- LIVE/REAL
- FORECAST
- HISTORICAL
- SIMULATED

Avoid the word "LIVE" for cached or simulated data.

## 8. Research Mode

Focus:

- datasets
- variables
- stations
- time series
- spatial layers
- source metadata

## 9. Operations Mode

Focus:

- active hazards
- risk
- affected regions
- current conditions
- timeline
- impact analysis

## 10. General Public View

Simplify technical information:

- current hazard status
- location
- basic explanation
- safety-oriented informational context

The prototype should not present itself as an official warning authority.

## 11. Responsive Behaviour

Priority:

1. desktop
2. laptop
3. tablet

Mobile should be functional but not the primary design target for the 48-hour build.

## 12. Accessibility

- readable contrast
- non-colour-only status indicators
- keyboard-accessible controls where practical
- meaningful labels
- units shown with values
