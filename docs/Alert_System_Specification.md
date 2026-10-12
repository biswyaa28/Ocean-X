# OceanLens — Alert System Specification

## 1. Purpose

Provide a clear hazard-intelligence interface for the prototype.

This is a decision-support visualization, not an official public warning service.

## 2. Alert Types

Initial types:

- cyclone
- high wave
- strong wind
- heavy rainfall
- flood/storm surge
- coastal erosion
- other configured hazards

## 3. Severity

Use:

- Low
- Moderate
- High
- Critical

Severity thresholds must be documented for every implemented rule.

## 4. Prototype Risk Engine

For the MVP, use transparent rules rather than claiming a validated ML model.

Possible evidence variables:

- cyclone proximity
- cyclone intensity
- wind
- wave height
- sea-surface temperature
- coastline proximity
- exposure/population when reliable data is available

Example conceptual flow:

```text
Evidence
  ↓
Rule evaluation
  ↓
Risk score
  ↓
Severity
  ↓
Explanation
```

Do not hard-code arbitrary scientific thresholds without a source or an explicit prototype assumption.

## 5. Alert Object

```text
Alert
- id
- type
- severity
- title
- location
- geometry
- source
- issued_at
- valid_until
- evidence[]
- status
```

## 6. Explanation

Every prototype alert should answer:

1. What is happening?
2. Where?
3. When?
4. Which evidence contributed?
5. What is the confidence/source status?
6. What are the limitations?

## 7. AI Explanation

AI may convert structured evidence into readable language.

The AI must not:

- invent measurements
- invent sources
- invent confidence
- invent forecast tracks
- claim official warning authority

The safest architecture is:

```text
Verified data
     ↓
Structured evidence
     ↓
AI explanation
     ↓
Human-readable summary
```

## 8. Alert UI

Main alert card:

```text
HIGH RISK

Hazard:
Cyclone

Location:
[location]

Evidence:
Wind ↑
Wave height ↑
Cyclone approaching

Source:
[provider]

Data status:
REAL / FORECAST / SIMULATED

[View per-depth bias panel]
```

## 9. Future Production Requirements

Not part of the 48-hour prototype:

- SMS
- push notifications
- email alerting
- escalation workflows
- acknowledgement tracking
- official warning integration
