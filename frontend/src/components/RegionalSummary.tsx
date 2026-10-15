'use client';

/**
 * OCEAN-X — Regional matchup summary (model levels).
 *
 * The per-profile drawer answers "how well does the model match this float".
 * This panel answers the regional question: how large is the model bias as a
 * function of DEPTH across the Bay of Bengal, which is what a model evaluation
 * actually reports.
 *
 * Everything rendered here comes from GET /api/argo/matchup/summary. The
 * frontend computes no statistic, no depth bin and no exclusion count: it
 * echoes the backend's aggregation so there is exactly one definition of the
 * number.
 *
 * Aggregation note (also documented in the backend): statistics are reduced
 * per profile and then per depth, so a profile that sampled finely does not
 * dominate the regional figure.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  MapPin,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Scatter,
  ScatterChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  ZAxis,
  XAxis,
  YAxis,
} from 'recharts';
import type { ArgoMatchupSummary, TchpScatterPoint } from '../types/oceanlens';
import { apiProvider } from '../services/ApiProvider';
import {
  modelDepthAxisNote,
  modelDepthLabel,
  modelDepthLabelCompact,
  type ModelDepthAxis,
} from '../utils/modelDepthLabel';

/** Human-readable exclusion reasons, mirroring the backend constants. */
const EXCLUSION_LABELS: Record<string, string> = {
  time_gap_too_large: 'Time gap too large',
  no_overlap_with_model_depth_range: 'No overlap with model depths',
  no_pairs_after_qc_and_sampling_gap: 'No pairs after QC / sampling gap',
  float_sampling_too_coarse: 'Float sampling too coarse',
  model_data_unavailable: 'Model data unavailable',
};

/**
 * The one-sentence explanation of WHY this chart shows a gap.
 *
 * Every number in it is computed at request time by the backend from the model's
 * own temperature profile (`tchpModelDefinition`). Nothing here is a stored
 * constant: if the ratio moved, this text moves with it, and if the backend
 * cannot compute it the note is withheld rather than replaced by a guess.
 */
function tchpDefinitionNote(
  definition: ArgoMatchupSummary['tchpModelDefinition'],
): string | null {
  if (!definition || definition.status !== 'OK') return null;
  const ratio = definition.ratioAtFloatIsothermMedian ?? definition.ratioAtFloatIsothermMean;
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null;

  const referenceIsotherm = definition.referenceIsothermC;
  const referenceRatio = definition.referenceRatio;
  const hasReference =
    referenceIsotherm !== null &&
    referenceIsotherm !== undefined &&
    Number.isFinite(referenceIsotherm) &&
    referenceRatio !== null &&
    referenceRatio !== undefined &&
    Number.isFinite(referenceRatio);

  const referenceClause = hasReference
    ? ` (consistent with a ~${referenceIsotherm!.toFixed(1)} °C reference isotherm, which reproduces the field to within ${Math.abs(
        (referenceRatio! - 1) * 100,
      ).toFixed(0)}%)`
    : '';

  return (
    `INCOIS's 2D TCHP is about ${ratio.toFixed(2)}x the TCHP recomputed from the model's ` +
    `own temperature using the same ${definition.floatIsothermC.toFixed(0)} °C definition as ` +
    `the float${referenceClause}; this is a definition difference, not model error.`
  );
}

const BIAS_COLOR = '#22d3ee';

interface BiasRow {
  modelDepthM: number;
  bias: number | null;
  n: number;
  /** ±RMSE band, so the plot shows spread as well as the mean. */
  spread: number | null;
}

function metric(value: number | null | undefined, digits = 3): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

/**
 * Tooltip heading for a per-depth bar. Extracted so its wording is testable.
 *
 * The per-depth n is NOT the overall n. The backend reduces each profile to a
 * single bias before the overall figures (so those count PROFILES), but the
 * per-depth figure is the length of a flat residual list fed one entry per
 * comparison row — so it counts MATCHED PAIRS. The two coincide only while
 * model depths stay unique per profile, which is a property of the data rather
 * than a guarantee of the code. Labelling this one "profiles" would silently
 * claim a per-profile guarantee it does not have.
 */
/**
 * Recharts types the Tooltip `label` prop as `ReactNode` (the XAxis value can
 * be any rendered node), so this must accept ReactNode too — narrowing it to
 * `string | number` fails typecheck under `next build`.
 */
export function depthTooltipLabel(
  label: React.ReactNode,
  row?: BiasRow,
  axis?: ModelDepthAxis,
): string {
  const text = typeof label === 'string' || typeof label === 'number' ? String(label) : '';
  const depth = Number(text);
  // The tooltip says which depth is being sampled AND what the file calls that
  // same level, because the two disagree on the thermocline levels.
  const depthText = Number.isFinite(depth)
    ? `DEPTH ${modelDepthLabel(depth, axis).toUpperCase()}`
    : `DEPTH ${text} M`;
  return typeof row?.n === 'number'
    ? `${depthText} · n = ${row.n} matched pairs`
    : depthText;
}

function BiasVsDepthChart({
  rows,
  unit,
  axis,
}: {
  rows: BiasRow[];
  unit: string;
  axis?: ModelDepthAxis;
}) {
  if (rows.length === 0) {
    return (
      <div
        role="status"
        className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-2.5 font-mono text-[9.5px] text-slate-400"
      >
        <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
        <span>NO PER-DEPTH BIAS AVAILABLE — NO PROFILE PRODUCED A PAIR.</span>
      </div>
    );
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 space-y-1">
      <div className="flex items-center justify-between font-mono px-0.5">
        <span className="text-[9px] font-bold text-slate-300 tracking-wider">
          BIAS VS DEPTH — {unit}
        </span>
        <span className="text-[8px] text-slate-500">
          BAR = MEAN BIAS · LINE = ±1 RMSE · DEPTH DOWNWARD · TICK = SAMPLED (FILE LABEL)
        </span>
      </div>
      <ResponsiveContainer
        width="100%"
        height={170}
        initialDimension={{ width: 372, height: 170 }}
      >
        {/* depth on Y (downward) so the profile reads like an ocean section */}
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 2, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="2 4" />
          <XAxis
            type="number"
            stroke="rgba(255,255,255,0.15)"
            tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'inherit' }}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey="modelDepthM"
            domain={[
              0,
              (dataMax: number) => (dataMax > 0 ? dataMax : 1),
            ]}
            reversed
            width={44}
            stroke="rgba(255,255,255,0.15)"
            tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'inherit' }}
            tickLine={false}
            tickFormatter={(value: number) => modelDepthLabelCompact(value, axis)}
            label={{
              value: 'DEPTH (M) · SAMPLED (FILE LABEL)',
              angle: -90,
              position: 'insideLeft',
              fill: '#64748b',
              fontSize: 8,
            }}
          />
          <Tooltip
            contentStyle={{
              background: '#05070a',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 8,
              fontSize: 10,
              fontFamily: 'inherit',
              padding: '4px 8px',
            }}
            labelFormatter={(label, payload) =>
              depthTooltipLabel(label, payload?.[0]?.payload as BiasRow | undefined, axis)
            }
            formatter={(value, name) => [
              typeof value === 'number' ? `${value.toFixed(3)} ${unit}` : '—',
              String(name),
            ]}
          />
          {/* Zero bias reference: bars right of it mean a warm/cold model bias. */}
          <ReferenceLine x={0} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
          {rows.some((row) => row.spread !== null) && (
            <Bar
              dataKey="spread"
              name="±1 RMSE"
              fill="rgba(148,163,184,0.25)"
              radius={[2, 2, 2, 2]}
              isAnimationActive={false}
            />
          )}
          <Bar dataKey="bias" name="BIAS" radius={[2, 2, 2, 2]} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell
                key={row.modelDepthM}
                fill={row.bias !== null && row.bias > 0 ? '#f97316' : BIAS_COLOR}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="font-mono text-[7.5px] text-slate-500 leading-relaxed">
        ORANGE = MODEL WARMER THAN THE FLOAT · CYAN = MODEL COOLER. THE GREY BAND IS THE
        SPREAD ACROSS PROFILES (±1 RMSE), NOT A CONFIDENCE INTERVAL.
      </div>
    </div>
  );
}


/**
 * Float-derived vs model heat potential, one point per profile.
 *
 * The 1:1 line is the reference that makes the plot readable: points on it are
 * profiles where the model carries exactly the heat the float measured. The
 * widely quoted rule-of-thumb value is drawn as a SECOND, explicitly labelled
 * screening line. It is a published threshold used for context, NOT a
 * threshold this model is being judged against and NOT a forecast of anything.
 */
const TchpScatter: React.FC<{
  points: TchpScatterPoint[];
  ruleOfThumb: number;
}> = ({ points, ruleOfThumb }) => {
  if (points.length === 0) {
    return (
      <div
        role="status"
        className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-2.5 font-mono text-[9.5px] text-slate-400"
      >
        <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
        <span>
          NO TCHP COMPARISON AVAILABLE — NO PROFILE PRODUCED BOTH A FLOAT-DERIVED VALUE
          AND AN INCOIS TCHP VALUE.
        </span>
      </div>
    );
  }

  const values = points.flatMap((p) => [p.tchpFloatKjCm2, p.tchpModelKjCm2]);
  const max = Math.max(...values, ruleOfThumb) * 1.08;
  const cleanMax = Math.ceil(max);
  const below = points.filter((p) => p.residualKjCm2 !== null && p.residualKjCm2 < 0).length;

  const cleanTickFormatter = (val: number | string) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return '';
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 space-y-1">
      <div className="flex items-center justify-between font-mono px-0.5">
        <span className="text-[9px] font-bold text-slate-300 tracking-wider">
          FLOAT-DERIVED TCHP vs INCOIS TCHP PRODUCT — kJ/cm2
        </span>
        <span className="text-[8px] text-slate-500">N = {points.length}</span>
      </div>
      <ResponsiveContainer
        width="100%"
        height={190}
        initialDimension={{ width: 372, height: 190 }}
      >
        <ScatterChart margin={{ top: 22, right: 16, bottom: 16, left: 4 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="tchpFloatKjCm2"
            name="Float"
            domain={[0, cleanMax]}
            tickFormatter={cleanTickFormatter}
            stroke="rgba(255,255,255,0.15)"
            tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'inherit' }}
            tickLine={false}
            label={{
              value: 'FLOAT-DERIVED TCHP kJ/cm2',
              position: 'insideBottomRight',
              offset: -2,
              fill: '#64748b',
              fontSize: 8,
            }}
          />
          <YAxis
            type="number"
            dataKey="tchpModelKjCm2"
            name="INCOIS TCHP"
            domain={[0, cleanMax]}
            tickFormatter={cleanTickFormatter}
            width={44}
            stroke="rgba(255,255,255,0.15)"
            tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'inherit' }}
            tickLine={false}
            label={{
              value: 'INCOIS TCHP kJ/cm2',
              angle: -90,
              position: 'insideLeft',
              fill: '#64748b',
              fontSize: 8,
            }}
          />
          <ZAxis range={[70, 71]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{
              background: '#05070a',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 8,
              fontSize: 10,
              fontFamily: 'inherit',
              padding: '4px 8px',
            }}
            formatter={(value, name) => [
              typeof value === 'number' ? `${value.toFixed(1)} kJ/cm2` : '—',
              String(name),
            ]}
          />
          {/* 1:1 agreement: model heat potential equal to the float's. */}
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: max, y: max },
            ]}
            stroke="rgba(255,255,255,0.45)"
            strokeWidth={1.2}
          />
          {/* Widely quoted screening value. Context, not a pass/fail line. */}
          {ruleOfThumb > 0 && ruleOfThumb < max && (
            <>
              <ReferenceLine
                x={ruleOfThumb}
                stroke="#f97316"
                strokeDasharray="4 3"
                strokeWidth={1}
                label={{
                  value: `${ruleOfThumb} rule of thumb`,
                  position: 'top',
                  fill: '#f97316',
                  fontSize: 7.5,
                  fontFamily: 'inherit',
                  offset: 4,
                }}
              />
              <ReferenceLine
                y={ruleOfThumb}
                stroke="#f97316"
                strokeDasharray="4 3"
                strokeWidth={1}
              />
            </>
          )}
          <Scatter
            data={points}
            fill="#22d3ee"
            isAnimationActive={false}
            shape="circle"
          />
        </ScatterChart>
      </ResponsiveContainer>
      <div className="font-mono text-[7.5px] text-slate-500 leading-relaxed">
        THE DIAGONAL IS 1:1 AGREEMENT. ABOVE IT THE MODEL CARRIES MORE HEAT THAN THE FLOAT
        MEASURED. {below} OF {points.length} PROFILE{points.length === 1 ? '' : 'S'} FALL BELOW
        IT. THE ORANGE LINES MARK A COMMONLY QUOTED SCREENING VALUE, SHOWN FOR CONTEXT ONLY.
        THIS IS A COMPARISON, NOT A FORECAST.
      </div>
    </div>
  );
};

interface RegionalSummaryProps {
  /**
   * Condensed layout for short viewports: keeps the headline counts, the depth
   * provenance note and the TCHP definition note, and drops the long-form
   * charts and statistics blocks.
   *
   * Nothing is condensed INTO a smaller number. A figure that only exists in a
   * dropped section is simply absent, because a summarised aggregate the full
   * view never computed would be a value this project could not source.
   */
  compact?: boolean;
}

export const RegionalSummary: React.FC<RegionalSummaryProps> = ({ compact = false }) => {
  const [summary, setSummary] = useState<ArgoMatchupSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);

  // Retrying bumps a token instead of re-entering the effect by hand, so the
  // load lives in exactly one place and every state update stays inside the
  // promise callback rather than in the effect body.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void apiProvider.getArgoMatchupSummary(controller.signal).then((data) => {
      if (cancelled) return;
      if (data) setSummary(data);
      else {
        setSummary(null);
        setUnavailable('REGIONAL SUMMARY UNAVAILABLE FROM THE BACKEND — NOTHING IS FABRICATED.');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadToken]);

  // Sampled axis vs the file's own DEPTH labels. Passed down so every depth this
  // panel shows carries the file's label when the two disagree.
  const depthAxis = useMemo<ModelDepthAxis | undefined>(
    () =>
      summary
        ? { modelDepths: summary.modelDepths, storedFileDepths: summary.storedFileDepths }
        : undefined,
    [summary]
  );
  const depthAxisNote = useMemo(() => modelDepthAxisNote(depthAxis), [depthAxis]);

  const tchpDefinitionNoteText = useMemo(
    () => tchpDefinitionNote(summary?.tchpModelDefinition),
    [summary]
  );

  const temperatureRows = useMemo<BiasRow[]>(
    () =>
      (summary?.byModelDepth ?? []).map((row) => ({
        modelDepthM: row.modelDepthM,
        bias: row.temperature.bias,
        n: row.temperature.n,
        spread: row.temperature.rmse,
      })),
    [summary]
  );
  const salinityRows = useMemo<BiasRow[]>(
    () =>
      (summary?.byModelDepth ?? []).map((row) => ({
        modelDepthM: row.modelDepthM,
        bias: row.salinity.bias,
        n: row.salinity.n,
        spread: row.salinity.rmse,
      })),
    [summary]
  );

  return (
    <div className="bg-white/5 border border-cyan-500/20 rounded-xl p-2.5 space-y-2 font-mono">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-cyan-300 tracking-wider">
          <MapPin className="w-3.5 h-3.5" />
          <span>REGIONAL SUMMARY</span>
        </div>
        <button
          onClick={() => {
            setUnavailable(null);
            setLoading(true);
            setReloadToken((n) => n + 1);
          }}
          title="Reload the regional summary"
          className="p-1 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <BarChart3 className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[9.5px] text-cyan-300">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>AGGREGATING MATCHUPS…</span>
        </div>
      )}

      {!loading && unavailable && (
        <div
          role="status"
          className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2.5 text-[9.5px]"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{unavailable}</span>
        </div>
      )}

      {!loading && summary && (
        <>
          <div className="font-mono text-[7.5px] text-slate-500 leading-relaxed">
            COMPARED AT THE MODEL’S OWN DEPTH LEVELS. STATISTICS ARE REDUCED PER PROFILE AND
            THEN PER DEPTH, SO EVERY PROFILE COUNTS ONCE REGARDLESS OF HOW FINELY IT SAMPLED.
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-[9px]">
            <div className="bg-[#05070a] p-2 rounded-lg border border-white/10 text-center">
              <div className="text-[7.5px] text-slate-500 uppercase">Profiles in</div>
              <div className="text-cyan-300 font-bold mt-0.5">
                {summary.includedProfileCount}/{summary.totalProfileCount}
              </div>
            </div>
            <div className="bg-[#05070a] p-2 rounded-lg border border-white/10 text-center">
              <div className="text-[7.5px] text-slate-500 uppercase">Excluded</div>
              <div className="text-amber-300 font-bold mt-0.5">{summary.excludedProfileCount}</div>
            </div>
            <div className="bg-[#05070a] p-2 rounded-lg border border-white/10 text-center">
              <div className="text-[7.5px] text-slate-500 uppercase">Runs</div>
              <div className="text-slate-200 font-bold mt-0.5">{summary.modelRuns.length}</div>
            </div>
          </div>

          {compact && temperatureRows.length === 0 && (
            <div
              role="status"
              className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-2.5 font-mono text-[9.5px] text-slate-400"
            >
              <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
              <span>NO PER-DEPTH BIAS AVAILABLE — NO PROFILE PRODUCED A PAIR.</span>
            </div>
          )}

          {!compact && (
          <>
          <TchpScatter
            points={summary.tchpScatter}
            ruleOfThumb={summary.tchpRuleOfThumbKJPerCm2}
          />

          {summary.tchp.n > 0 && (
            <div className="bg-[#05070a] border border-white/10 rounded-lg p-2 font-mono text-[8.5px] space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">MEAN DIFFERENCE (INCOIS − FLOAT)</span>
                <span className="text-slate-200 font-bold">
                  {metric(summary.tchp.bias, 1)} kJ/cm2
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">MEDIAN DIFFERENCE</span>
                <span className="text-slate-200 font-bold">
                  {metric(summary.tchp.medianBias, 1)} kJ/cm2
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">RMSE</span>
                <span className="text-slate-200 font-bold">
                  {metric(summary.tchp.rmse, 1)} kJ/cm2
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">MEAN FLOAT / INCOIS TCHP</span>
                <span className="text-slate-200 font-bold">
                  {metric(summary.tchp.meanFloat, 1)} / {metric(summary.tchp.meanModel, 1)} kJ/cm2
                </span>
              </div>
            </div>
          )}

          {tchpDefinitionNoteText && (
            <div
              data-testid="regional-tchp-definition-note"
              className="font-mono text-[8.5px] text-slate-300 leading-relaxed px-0.5 border-l-2 border-amber-400/50 pl-2"
            >
              {tchpDefinitionNoteText}
            </div>
          )}

          {summary.tchpDefinitionStatus && (
            <details className="text-[7.5px] text-slate-500 leading-relaxed">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-300">
                HOW COMPARABLE IS THE INCOIS TCHP PRODUCT?
              </summary>
              <p className="mt-1">{summary.tchpDefinitionStatus}</p>
            </details>
          )}

          <BiasVsDepthChart rows={temperatureRows} unit="°C" axis={depthAxis} />
          <BiasVsDepthChart rows={salinityRows} unit="PSU" axis={depthAxis} />

          <div className="bg-[#05070a] border border-white/10 rounded-lg p-2 font-mono text-[8.5px] space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">T OVERALL BIAS</span>
              <span className="text-slate-200 font-bold">
                {metric(summary.overall.temperature.bias)} °C
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">
                T OVERALL MAE (n = {summary.overall.temperature.n ?? summary.includedProfileCount} profiles)
              </span>
              <span className="text-slate-200 font-bold">
                {metric(summary.overall.temperature.mae)} °C
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">
                T OVERALL RMSE (n = {summary.overall.temperature.n ?? summary.includedProfileCount} profiles)
              </span>
              <span className="text-slate-200 font-bold">
                {metric(summary.overall.temperature.rmse)} °C
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">S OVERALL BIAS</span>
              <span className="text-slate-200 font-bold">
                {metric(summary.overall.salinity.bias)} PSU
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">
                S OVERALL MAE (n = {summary.overall.salinity.n ?? summary.includedProfileCount} profiles)
              </span>
              <span className="text-slate-200 font-bold">
                {metric(summary.overall.salinity.mae)} PSU
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">
                S OVERALL RMSE (n = {summary.overall.salinity.n ?? summary.includedProfileCount} profiles)
              </span>
              <span className="text-slate-200 font-bold">
                {metric(summary.overall.salinity.rmse)} PSU
              </span>
            </div>
            <div className="flex justify-between border-t border-white/5 pt-1">
              <span className="text-slate-500">FLOAT BRACKET MAX GAP</span>
              <span className="text-slate-300 font-bold">
                ≤{summary.floatBracketMaxGapM} m ≤{summary.floatBracketDeepBreakpointM} m ·{' '}
                {summary.floatBracketMaxGapDeepM} m below
              </span>
            </div>
          </div>

          <div
            data-testid="regional-depth-axis-note"
            className="font-mono text-[8.5px] text-slate-400 leading-relaxed px-0.5"
          >
            {depthAxisNote ?? 'Model levels use the producer\'s native depth axis. Layer definition pending confirmation from INCOIS.'}
          </div>

          <div className="bg-[#05070a] border border-white/10 rounded-lg p-2 font-mono text-[8.5px] space-y-1">
            <div className="text-slate-400 font-bold tracking-wider">EXCLUDED PROFILES</div>
            {summary.excludedProfileCount === 0 ? (
              <div className="text-slate-500">NONE — EVERY PROFILE CONTRIBUTED.</div>
            ) : (
              Object.entries(summary.excludedProfileReasons).map(([reason, count]) => (
                <div key={reason} className="flex justify-between">
                  <span className="text-slate-500">
                    {EXCLUSION_LABELS[reason] ?? reason}
                  </span>
                  <span className="text-amber-300 font-bold">{count}</span>
                </div>
              ))
            )}
          </div>

          <button
            onClick={() => setExpanded((value) => !value)}
            className="w-full flex items-center justify-center gap-1.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[8px] font-mono text-slate-300 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'HIDE PER-PROFILE DETAIL' : `PER-PROFILE DETAIL (${summary.profiles.length})`}
          </button>

          {expanded && (
            <div className="border border-white/15 rounded-xl overflow-hidden font-mono text-[8.5px]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#05070a] text-slate-400 text-[7.5px] uppercase border-b border-white/15">
                    <th className="py-1.5 px-1.5">Float</th>
                    <th className="py-1.5 px-1.5 text-center">Gap h</th>
                    <th className="py-1.5 px-1.5 text-center">Pairs</th>
                    <th className="py-1.5 px-1.5 text-center">T bias</th>
                    <th className="py-1.5 px-1.5 text-center">S bias</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 bg-[#080c14]/50">
                  {summary.profiles.map((row) => (
                    <tr key={row.profileId} className="hover:bg-white/5 transition-colors">
                      <td className="py-1 px-1.5 text-slate-300 font-bold">{row.floatId}</td>
                      <td className="py-1 px-1.5 text-center text-slate-400">
                        {metric(row.timeDifferenceHours, 2)}
                      </td>
                      <td className="py-1 px-1.5 text-center text-cyan-300 font-bold">
                        {row.pairCount}
                      </td>
                      <td className="py-1 px-1.5 text-center text-slate-200">
                        {metric(row.temperature.bias)}
                      </td>
                      <td className="py-1 px-1.5 text-center text-slate-200">
                        {metric(row.salinity.bias)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </>
          )}
        </>
      )}
    </div>
  );
};

export default RegionalSummary;