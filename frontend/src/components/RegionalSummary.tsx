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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ArgoMatchupSummary } from '../types/oceanlens';
import { apiProvider } from '../services/ApiProvider';

/** Human-readable exclusion reasons, mirroring the backend constants. */
const EXCLUSION_LABELS: Record<string, string> = {
  time_gap_too_large: 'Time gap too large',
  no_overlap_with_model_depth_range: 'No overlap with model depths',
  no_pairs_after_qc_and_sampling_gap: 'No pairs after QC / sampling gap',
  float_sampling_too_coarse: 'Float sampling too coarse',
  model_data_unavailable: 'Model data unavailable',
};

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

function BiasVsDepthChart({ rows, unit }: { rows: BiasRow[]; unit: string }) {
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
          BAR = MEAN BIAS · LINE = ±1 RMSE · DEPTH DOWNWARD
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
            label={{
              value: 'DEPTH (M)',
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
            labelFormatter={(label) => `DEPTH ${label} M`}
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

interface RegionalSummaryProps {
  /** Render inline (inside the drawer) or as a standalone panel. */
  compact?: boolean;
}

export const RegionalSummary: React.FC<RegionalSummaryProps> = ({ compact }) => {
  const [summary, setSummary] = useState<ArgoMatchupSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setUnavailable(null);
    const data = await apiProvider.getArgoMatchupSummary(signal);
    if (signal.aborted) return;
    if (data) setSummary(data);
    else {
      setSummary(null);
      setUnavailable('REGIONAL SUMMARY UNAVAILABLE FROM THE BACKEND — NOTHING IS FABRICATED.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

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
          onClick={() => void load(new AbortController().signal)}
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

          <BiasVsDepthChart rows={temperatureRows} unit="°C" />
          <BiasVsDepthChart rows={salinityRows} unit="PSU" />

          <div className="bg-[#05070a] border border-white/10 rounded-lg p-2 font-mono text-[8.5px] space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">T OVERALL BIAS</span>
              <span className="text-slate-200 font-bold">
                {metric(summary.overall.temperature.bias)} °C
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">T OVERALL RMSE</span>
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
              <span className="text-slate-500">S OVERALL RMSE</span>
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
    </div>
  );
};

export default RegionalSummary;