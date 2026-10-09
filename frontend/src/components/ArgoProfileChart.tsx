'use client';

/**
 * OCEAN-X SIH26067 — Argo observation depth-profile charts (Phase 1D).
 *
 * Renders the in-situ Argo observation profile as scientific depth-vs-value
 * charts (temperature on X / depth on Y, salinity on X / depth on Y) using
 * the existing Recharts dependency.
 *
 * Scientific guarantees:
 * - The Y axis is oriented so increasing depth points downward — the standard
 *   oceanographic profile orientation (surface at top, deepest level at the
 *   bottom). The numerical depth values from the source dataset are plotted
 *   exactly as provided (no transformation, no vertical exaggeration); the
 *   orientation comes from the chart layout, not from altering the data.
 * - The depth field is used as supplied by the dataset (source-provided
 *   `depth_m`). No pressure-to-depth, TEOS-10 or GSW conversion is performed
 *   or implied.
 * - Missing observations (null/NaN) are never fabricated or bridged: each
 *   rendered line segment covers a contiguous run of valid levels only, so
 *   gaps in the profile stay visible.
 * - This is the ARGO OBSERVATION profile — not a HYCOM model profile, a
 *   validation result or a prediction.
 */

import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { AlertCircle } from 'lucide-react';
import {
  ArgoProfileChartPoint,
  ComparisonChartPoint,
  NormalizedArgoMatchup,
  NormalizedArgoProfile,
} from '../utils/argoProfileViz';

export interface ArgoProfileChartProps {
  /** Chart-normalized profile (see utils/argoProfileViz). */
  normalized: NormalizedArgoProfile;
  /** Optional existing-matchup values for the model comparison view. */
  comparison?: NormalizedArgoMatchup;
  /** Pixel height of each variable panel. */
  heightPx?: number;
}

type VariableKey = 'temperatureC' | 'salinityPsu';

interface VariablePanelSpec {
  key: VariableKey;
  /** Panel header — explicitly identifies the Argo observation origin. */
  header: string;
  /** X-axis (quantity) label with units. */
  xLabel: string;
  unitSuffix: string;
  color: string;
  unavailableText: string;
  validCount: number;
}

/** Split points into contiguous runs of valid values (gaps stay visible). */
function splitContiguousSegments(
  points: ArgoProfileChartPoint[],
  key: VariableKey
): ArgoProfileChartPoint[][] {
  const segments: ArgoProfileChartPoint[][] = [];
  let current: ArgoProfileChartPoint[] = [];
  for (const p of points) {
    if (p[key] !== null) {
      current.push(p);
    } else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

const DEPTH_AXIS_LABEL = 'DEPTH (M)';

const VariableChart: React.FC<{
  points: ArgoProfileChartPoint[];
  spec: VariablePanelSpec;
  heightPx: number;
}> = ({ points, spec, heightPx }) => {
  const segments = useMemo(() => splitContiguousSegments(points, spec.key), [points, spec.key]);

  // Depth domain: surface (0) at top, deepest observation at the bottom.
  // A degenerate all-zero profile gets a 1 m axis so the chart stays usable.
  const depthDomain = useMemo<[number, (dataMax: number) => number]>(
    () => [0, (dataMax: number) => (dataMax > 0 ? dataMax : 1)],
    []
  );

  return (
    <ResponsiveContainer
      width="100%"
      height={heightPx}
      /* Deterministic first paint (and jsdom rendering) before the
         ResizeObserver reports the real drawer width. */
      initialDimension={{ width: 372, height: heightPx }}
    >
      <LineChart data={points} layout="vertical" margin={{ top: 6, right: 10, bottom: 2, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="2 4" />
        {/* Value axis (X): the observed quantity exactly as reported. */}
        <XAxis
          type="number"
          domain={['auto', 'auto']}
          stroke="rgba(255,255,255,0.15)"
          tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'inherit' }}
          tickLine={false}
          label={{
            value: spec.xLabel,
            position: 'insideBottomRight',
            offset: -2,
            fill: '#64748b',
            fontSize: 8,
          }}
        />
        {/* Depth axis (Y): in Recharts vertical layout the depth axis runs
            top-to-bottom by construction — surface (0 m) at the top, the
            deepest observation at the bottom. The depth values themselves
            are plotted unmodified; no data transformation occurs. */}
        <YAxis
          type="number"
          dataKey="depthM"
          domain={depthDomain}
          width={46}
          stroke="rgba(255,255,255,0.15)"
          tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'inherit' }}
          tickLine={false}
          label={{
            value: DEPTH_AXIS_LABEL,
            angle: -90,
            position: 'insideLeft',
            fill: '#64748b',
            fontSize: 8,
          }}
        />
        <Tooltip
          cursor={{ stroke: 'rgba(148,163,184,0.35)', strokeWidth: 1 }}
          contentStyle={{
            background: '#05070a',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            fontSize: 10,
            fontFamily: 'inherit',
            padding: '4px 8px',
          }}
          labelFormatter={(label) => `DEPTH ${label} M`}
          formatter={(value) => [`${value} ${spec.unitSuffix}`, 'ARGO OBS']}
        />
        {segments.map((segment, i) => (
          <Line
            key={`${spec.key}-segment-${i}`}
            data={segment}
            dataKey={spec.key}
            stroke={spec.color}
            strokeWidth={1.5}
            dot={{ r: 2, fill: spec.color, strokeWidth: 0 }}
            activeDot={{ r: 3.5, stroke: spec.color, strokeWidth: 1 }}
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

const UnavailablePanel: React.FC<{ text: string }> = ({ text }) => (
  <div
    role="status"
    className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-2.5 font-mono text-[9.5px] text-slate-400"
  >
    <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
    <span>{text}</span>
  </div>
);

const ComparisonVariableChart: React.FC<{
  points: ComparisonChartPoint[];
  xLabel: string;
  unitSuffix: string;
  heightPx: number;
  /** model_levels mode: the model has only a few depth levels. */
  modelLevels?: boolean;
}> = ({ points, xLabel, unitSuffix, heightPx, modelLevels }) => {
  const argo = points.filter((point) => point.series === 'ARGO OBSERVATION');
  const model = points.filter((point) => point.series === 'HYCOM MODEL');
  // Native levels are solid dots; interpolated ones are hollow, so an
  // interpolated point can never be mistaken for a directly sampled one.
  const modelNative = model.filter(
    (point) => point.method !== 'interpolated' && point.method !== 'float_interpolated'
  );
  const modelInterpolated = model.filter(
    (point) => point.method === 'interpolated' || point.method === 'float_interpolated'
  );
  const deepest = points.reduce((max, point) => Math.max(max, point.depthM), 0);
  const depthDomain: [number, number] = [0, deepest > 0 ? deepest : 1];

  return (
    <ResponsiveContainer width="100%" height={heightPx} initialDimension={{ width: 372, height: heightPx }}>
      <LineChart layout="vertical" margin={{ top: 6, right: 10, bottom: 2, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="2 4" />
        <XAxis
          type="number"
          domain={['auto', 'auto']}
          stroke="rgba(255,255,255,0.15)"
          tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'inherit' }}
          tickLine={false}
          label={{ value: xLabel, position: 'insideBottomRight', offset: -2, fill: '#64748b', fontSize: 8 }}
        />
        <YAxis
          type="number"
          dataKey="depthM"
          domain={depthDomain}
          width={46}
          stroke="rgba(255,255,255,0.15)"
          tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'inherit' }}
          tickLine={false}
          label={{ value: DEPTH_AXIS_LABEL, angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 8 }}
        />
        <Tooltip
          cursor={{ stroke: 'rgba(148,163,184,0.35)', strokeWidth: 1 }}
          contentStyle={{
            background: '#05070a',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            fontSize: 10,
            fontFamily: 'inherit',
            padding: '4px 8px',
          }}
          labelFormatter={(label) => `DEPTH ${label} M`}
          formatter={(value, name) => [`${value} ${unitSuffix}`, name]}
        />
        <Line
          data={argo}
          type="linear"
          dataKey="value"
          name="ARGO OBSERVATION"
          stroke="#22d3ee"
          strokeWidth={1.8}
          dot={{ r: 2.5, fill: '#22d3ee', strokeWidth: 0 }}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          data={model}
          type="linear"
          dataKey="value"
          name="HYCOM MODEL"
          // In model_levels mode the model contributes only a handful of levels,
          // so they are joined by a thin dashed guide rather than a curve that
          // would imply the model resolves the column between them.
          stroke="#f97316"
          strokeWidth={modelLevels ? 1 : 1.8}
          strokeDasharray={modelLevels ? '2 3' : '5 3'}
          // The per-point marking is handled by the two overlay series below,
          // so this line draws the connecting guide only.
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          data={modelNative}
          type="linear"
          dataKey="value"
          name="HYCOM MODEL (NATIVE LEVEL)"
          stroke="none"
          dot={{ r: 2.5, fill: '#f97316', strokeWidth: 0 }}
          legendType="none"
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          data={modelInterpolated}
          type="linear"
          dataKey="value"
          name="HYCOM MODEL (INTERPOLATED)"
          stroke="none"
          dot={{ r: 3, fill: 'transparent', stroke: '#f97316', strokeWidth: 1.5 }}
          legendType="none"
          isAnimationActive={false}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

const ComparisonLegend: React.FC<{
  interpolationApplied: boolean;
  modelLevels?: boolean;
}> = ({ interpolationApplied, modelLevels }) => (
  <div className="flex items-center gap-3 font-mono text-[8px] text-slate-400">
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-0.5 bg-cyan-400" />
      ARGO OBSERVATION
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-0.5 bg-orange-400" />
      HYCOM MODEL
    </span>
    {interpolationApplied && (
      <>
        <span
          className="flex items-center gap-1"
          title={
            modelLevels
              ? 'Float value taken from a native float level'
              : 'Model value taken from one native HYCOM level'
          }
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400" />
          NATIVE
        </span>
        <span
          className="flex items-center gap-1"
          title={
            modelLevels
              ? 'Float value interpolated between two float levels onto this model level'
              : 'Model value linearly interpolated between two native HYCOM levels'
          }
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full border border-orange-400" />
          INTERPOLATED
        </span>
      </>
    )}
  </div>
);

export const ArgoProfileChart: React.FC<ArgoProfileChartProps> = ({
  normalized,
  comparison,
  heightPx = 200,
}) => {
  const { points, stats } = normalized;

  const panels: VariablePanelSpec[] = [
    {
      key: 'temperatureC',
      header: 'ARGO OBSERVATION — TEMPERATURE',
      xLabel: 'TEMPERATURE (°C)',
      unitSuffix: '°C',
      color: '#22d3ee',
      unavailableText: 'TEMPERATURE UNAVAILABLE — NO VALID TEMPERATURE OBSERVATIONS IN THIS PROFILE',
      validCount: stats.validTemperatureCount,
    },
    {
      key: 'salinityPsu',
      header: 'ARGO OBSERVATION — SALINITY',
      xLabel: 'SALINITY (PSU)',
      unitSuffix: 'PSU',
      color: '#fbbf24',
      unavailableText: 'SALINITY UNAVAILABLE — NO VALID SALINITY OBSERVATIONS IN THIS PROFILE',
      validCount: stats.validSalinityCount,
    },
  ];

  if (comparison) {
    const interpolationApplied = comparison.stats.interpolationApplied;
    // model_levels: the response carries one row per MODEL depth level.
    const modelLevelsMode = comparison.stats.matchMode === 'model_levels';
    const modelLevelCount = new Set(
      comparison.temperaturePoints
        .filter((point) => point.series === 'HYCOM MODEL')
        .map((point) => point.depthM)
    ).size;
    const panels = [
      {
        key: 'temperature',
        header: 'PROFILE COMPARISON — TEMPERATURE',
        xLabel: 'TEMPERATURE (°C)',
        unitSuffix: '°C',
        points: comparison.temperaturePoints,
        available:
          comparison.stats.temperatureArgoCount > 0 && comparison.stats.temperatureModelCount > 0,
        unavailableText:
          comparison.stats.temperatureArgoCount === 0
          ? 'TEMPERATURE COMPARISON UNAVAILABLE — ARGO HAS NO VALID MATCHED OBSERVATION VALUES'
            : comparison.stats.temperatureModelCount === 0
          ? 'TEMPERATURE COMPARISON UNAVAILABLE — HYCOM HAS NO VALID MATCHED MODEL VALUES'
            : 'TEMPERATURE COMPARISON UNAVAILABLE — NO VALID MATCHED VALUES',
      },
      {
        key: 'salinity',
        header: 'PROFILE COMPARISON — SALINITY',
        xLabel: 'SALINITY (PSU)',
        unitSuffix: 'PSU',
        points: comparison.salinityPoints,
        available: comparison.stats.salinityAvailable,
        unavailableText:
          comparison.stats.salinityArgoCount === 0
          ? 'SALINITY COMPARISON UNAVAILABLE — ARGO HAS NO VALID MATCHED OBSERVATION VALUES'
            : comparison.stats.salinityModelCount === 0
          ? 'SALINITY COMPARISON UNAVAILABLE — HYCOM HAS NO VALID MATCHED MODEL VALUES'
            : 'SALINITY COMPARISON UNAVAILABLE — NO VALID MATCHED VALUES',
      },
    ];

    return (
      <div className="space-y-3">
        <ComparisonLegend
          interpolationApplied={interpolationApplied}
          modelLevels={modelLevelsMode}
        />
        {panels.map((panel) => (
          <div key={panel.key} className="bg-white/5 border border-white/10 rounded-xl p-2.5 space-y-1">
            <div className="flex items-center justify-between font-mono px-0.5">
              <span className="text-[9px] font-bold text-slate-300 tracking-wider">{panel.header}</span>
              <span className="text-[8px] text-slate-500">
                {modelLevelsMode
                  ? `MODEL, ${modelLevelCount} LEVEL${modelLevelCount === 1 ? '' : 'S'}`
                  : interpolationApplied
                    ? 'NATIVE LEVELS + VERTICAL INTERPOLATION'
                    : 'NATIVE DEPTHS · NO INTERPOLATION'}
              </span>
            </div>
            {panel.available ? (
              <ComparisonVariableChart
                points={panel.points}
                xLabel={panel.xLabel}
                unitSuffix={panel.unitSuffix}
                heightPx={heightPx}
                modelLevels={modelLevelsMode}
              />
            ) : (
              <UnavailablePanel text={panel.unavailableText} />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {panels.map((spec) => (
        <div key={spec.key} className="bg-white/5 border border-white/10 rounded-xl p-2.5 space-y-1">
          <div className="flex items-center justify-between font-mono px-0.5">
            <span className="text-[9px] font-bold text-slate-300 tracking-wider">{spec.header}</span>
            <span className="text-[8px] text-slate-500">{spec.validCount} VALID LEVELS</span>
          </div>
          {spec.validCount > 0 ? (
            <VariableChart points={points} spec={spec} heightPx={heightPx} />
          ) : (
            <UnavailablePanel text={spec.unavailableText} />
          )}
        </div>
      ))}
    </div>
  );
};
