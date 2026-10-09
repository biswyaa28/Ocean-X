'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArgoProfile,
  ArgoMatchupResponse,
  ArgoObservationPoint,
  MatchupStatistics,
  MatchupDiagnostics,
  MatchupMode,
} from '../types/oceanlens';
import { apiProvider } from '../services/ApiProvider';
import {
  normalizeArgoMatchupComparisons,
  normalizeArgoObservations,
  ARGO_DUPLICATE_DEPTH_STRATEGY,
} from '../utils/argoProfileViz';
import { ArgoProfileChart } from './ArgoProfileChart';
import { RegionalSummary } from './RegionalSummary';
import { X, Activity, ShieldCheck, AlertCircle, RefreshCw, Loader2, Table2, Waves } from 'lucide-react';

interface ArgoMatchupDrawerProps {
  profile: ArgoProfile | null;
  onClose: () => void;
}

type DrawerTab = 'profile' | 'matchup' | 'region' | 'data';

const TAB_LABELS: Record<DrawerTab, string> = {
  profile: 'PROFILE',
  matchup: 'MODEL COMPARISON',
  region: 'REGION',
  data: 'DATA',
};

const OBSERVATIONS_UNAVAILABLE = 'ARGO OBSERVATIONS UNAVAILABLE';

const MATCH_MODES: MatchupMode[] = ['model_levels', 'float_levels', 'native'];

const MATCH_MODE_LABELS: Record<MatchupMode, string> = {
  model_levels: 'MODEL LEVELS',
  float_levels: 'FLOAT LEVELS',
  native: 'NATIVE ONLY',
};

const MATCH_MODE_TITLES: Record<MatchupMode, string> = {
  model_levels:
    'Compare at the model\u2019s own 6 depth levels; the float is interpolated onto each. '
    + 'Pairs are independent and the residual excludes model interpolation error.',
  float_levels:
    'Interpolate the model onto every float depth. Includes model interpolation '
    + 'error across the model\u2019s sparse depth levels.',
  native: 'Use only native model levels within the depth tolerance.',
};

const TIME_GAP_LABELS: Record<string, string> = {
  good: 'TIME GAP · GOOD',
  marginal: 'TIME GAP · MARGINAL',
  too_large: 'TIME GAP · TOO LARGE',
};

const TIME_GAP_TONES: Record<string, string> = {
  good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  marginal: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  too_large: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
};

const TIME_GAP_MESSAGES: Record<string, string> = {
  good: 'Observation and model are close enough in time for a valid comparison.',
  marginal:
    'Observation and model are separated by more than the routine window. Residuals are shown but should be read with the time gap in mind.',
  too_large: 'Time gap too large for a valid comparison',
};

const DEPTH_SOURCE_LABELS: Record<string, string> = {
  pressure_gsw: 'PRESSURE→DEPTH · GSW (TEOS-10)',
  provided: 'SOURCE-PROVIDED DEPTH',
  mixed: 'MIXED DEPTH BASIS',
  unavailable: 'DEPTH BASIS UNAVAILABLE',
};

function formatStatistic(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : '—';
}

/**
 * Backend-reported matching method badges (depth basis, vertical and
 * horizontal sub-sampling). Every value is echoed from the response — the
 * frontend never infers or recomputes a matching method.
 */
function MatchupMethodBadges({ matchup }: { matchup: ArgoMatchupResponse }) {
  const depthSource = matchup.depthSource ?? 'unavailable';
  const matchMode = matchup.matchMode ?? 'model_levels';
  const spatialMode = matchup.spatialMode ?? 'bilinear';
  const missingQc =
    matchup.diagnostics?.missingQcLevelCount ?? matchup.missingQcLevelCount ?? 0;
  const timeGapStatus = matchup.diagnostics?.timeGapStatus ?? matchup.timeGapStatus ?? 'good';
  const badges: { key: string; label: string; title: string; tone: string }[] = [
    {
      key: 'depth',
      label: DEPTH_SOURCE_LABELS[depthSource] ?? depthSource.toUpperCase(),
      title:
        'Float depth basis: derived from Argo pressure with gsw.z_from_p at the float '
        + 'latitude, or taken unchanged from the source depth_m field.',
      tone: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    },
    {
      key: 'vertical',
      label: `COMPARISON · ${MATCH_MODE_LABELS[matchMode]}`,
      title: MATCH_MODE_TITLES[matchMode],
      tone:
        matchMode === 'model_levels'
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
          : 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    },
    {
      key: 'horizontal',
      label: spatialMode === 'bilinear' ? 'HORIZONTAL · BILINEAR' : 'HORIZONTAL · NEAREST CELL',
      title:
        spatialMode === 'bilinear'
          ? 'The four surrounding model cells are blended by bilinear weight, renormalized '
            + 'over valid cells so land/masked cells drop out.'
          : 'Only the single closest model grid cell is used.',
      tone:
        spatialMode === 'bilinear'
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
          : 'bg-white/10 text-slate-300 border-white/20',
    },
  {
      key: 'qc',
      label: missingQc > 0 ? `QC ABSENT · ${missingQc} LEVELS` : 'QC FLAGS PRESENT',
      title:
        'Accepted Argo QC flags. Raw values accept 1/2; adjusted values accept 1/2/5. '
        + 'Flag 8 (value interpolated between measurements) is rejected on both. '
        + 'Levels with no QC flag in the source are accepted leniently and counted here.',
      tone:
        missingQc > 0
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          : 'bg-white/10 text-slate-300 border-white/20',
    },
    {
      key: 'timegap',
      label: TIME_GAP_LABELS[timeGapStatus] ?? timeGapStatus.toUpperCase(),
      title:
        `Observation-model time separation: ${matchup.timeDifferenceHours ?? 'unknown'} h `
        + '(good <= 24 h, marginal <= 72 h). Beyond that the samples describe '
        + 'different ocean states, so residual statistics are withheld.',
      tone: TIME_GAP_TONES[timeGapStatus] ?? 'bg-white/10 text-slate-300 border-white/20',
    },
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge.key}
          title={badge.title}
          data-testid={`matchup-badge-${badge.key}`}
          className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border ${badge.tone}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function MatchupStatisticsCard({
  label,
  statistics,
  unit,
}: {
  label: string;
  statistics: MatchupStatistics | null | undefined;
  unit: string;
}) {
  if (!statistics || statistics.n === 0) {
    return (
      <div className="bg-[#05070a] border border-white/10 rounded-lg p-2 font-mono text-[9px]">
        <div className="text-slate-300 font-bold">{label}</div>
        <div className="text-slate-500 mt-1">No valid matched pairs available for statistics.</div>
      </div>
    );
  }

  return (
    <div className="bg-[#05070a] border border-white/10 rounded-lg p-2 font-mono text-[9px]">
      <div className="text-slate-300 font-bold mb-1">{label}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <span className="text-slate-500">N (VALID PAIRS)</span>
        <span className="text-right text-slate-200 font-bold">N = {statistics.n}</span>
        <span className="text-slate-500">MEAN RESIDUAL ({unit})</span>
        <span className="text-right text-slate-200">{formatStatistic(statistics.meanResidual)}</span>
        <span className="text-slate-500">MAE ({unit})</span>
        <span className="text-right text-slate-200">{formatStatistic(statistics.mae)}</span>
        <span className="text-slate-500">RMSE ({unit})</span>
        <span className="text-right text-slate-200">{formatStatistic(statistics.rmse)}</span>
      </div>
    </div>
  );
}

function formatDiagnosticMetric(value: number | null | undefined, digits: number, unit: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : 'Unavailable';
}

function formatDiagnosticCount(value: number | null | undefined, noun: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value} ${noun}` : 'Unavailable';
}

function formatMatchedPercentage(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}% matched` : 'Unavailable';
}

/**
 * Phase 2C: neutral limitation statements built only from facts the existing
 * matchup response actually reports. No subjective grade, no quality score and
 * no threshold verdict is produced.
 */
function buildMatchupLimitations(matchup: ArgoMatchupResponse): string[] {
  const diagnostics: MatchupDiagnostics | null | undefined = matchup.diagnostics;
  const matchMode = matchup.matchMode ?? 'model_levels';
  const spatialMode = matchup.spatialMode ?? 'bilinear';
  const missingQcCount = diagnostics?.missingQcLevelCount ?? matchup.missingQcLevelCount;
  const limitations: string[] = [];

  if (typeof matchup.timeDifferenceHours === 'number' && matchup.timeDifferenceHours > 0) {
    limitations.push(
      matchup.timeInterpolationApplied
        ? `Observation and nearest model timestamps differ by ${matchup.timeDifferenceHours} h; the model field is linearly interpolated between the two bracketing model time slices.`
        : `Observation and model timestamps differ by ${matchup.timeDifferenceHours} h; no temporal interpolation is performed.`
    );
  }
  if (typeof matchup.distanceKm === 'number' && matchup.distanceKm > 0) {
    limitations.push(
      spatialMode === 'bilinear'
        ? `The observation sits ${matchup.distanceKm} km from the nearest model grid centre; the four surrounding cells are blended bilinearly.`
        : 'The Argo observation and the matched model grid point are not co-located; horizontal separation is non-zero.'
    );
  }
  if (matchup.modelDepthSelection) {
    limitations.push(
      matchMode === 'model_levels'
        ? 'Compared at the model’s own depth levels, with the float interpolated onto each; the residual excludes model interpolation error across sparse levels. Float values are never extrapolated and a bracket wider than the sampling-gap limit is rejected.'
        : matchMode === 'float_levels'
          ? 'Model values are linearly interpolated between the native HYCOM levels bracketing each float depth. This includes model interpolation error across the model’s sparse depth levels; values are never extrapolated beyond the model’s valid range or below the seafloor.'
          : 'Observations are matched to the nearest native HYCOM model depth; model values are used at native levels only.'
    );
  }
  if (matchMode === 'native' && typeof matchup.matchingToleranceM === 'number' && Number.isFinite(matchup.matchingToleranceM)) {
    limitations.push(
      `Depth matching tolerance is ≤ ${matchup.matchingToleranceM} m; observations outside it remain unmatched.`
    );
  }
  if (matchup.depthSource && matchup.depthSource !== 'unavailable') {
    limitations.push(
      matchup.depthSource === 'pressure_gsw'
        ? 'Float depths are converted from Argo pressure with gsw.z_from_p (TEOS-10/GSW) at the float latitude; HYCOM depths are geometric metres.'
        : matchup.depthSource === 'mixed'
          ? 'Some float depths were converted from pressure with gsw.z_from_p and others were taken from the source depth_m field.'
          : 'Float depths are the source-provided depth_m values; no pressure conversion was applied.'
    );
  }
  if (diagnostics && diagnostics.interpolationApplied) {
    const interpolated = diagnostics.interpolatedLevelCount ?? 0;
    limitations.push(
      `${interpolated} of ${diagnostics.matchedObservationCount} matched level(s) use an interpolated model value; ${diagnostics.nativeLevelCount ?? 0} use a native level.`
    );
  }
  const repeatedNativeDepths = diagnostics?.repeatedNativeDepthMatchCount ?? 0;
  if (matchMode === 'native' && repeatedNativeDepths > 0) {
    limitations.push(
      `${repeatedNativeDepths} native model depth(s) received more than one observation; each observation remains a separate matched pair.`
    );
  }
  const matchedObservations = diagnostics?.matchedObservationCount;
  const validPairs = [matchup.statistics?.temperature?.n, matchup.statistics?.salinity?.n].filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n)
  );
  if (typeof matchedObservations === 'number' && validPairs.some((n) => n < matchedObservations)) {
    limitations.push(
      'Matched pairs with missing or non-finite temperature/salinity values are excluded from the statistics.'
    );
  }
  const gapStatus = diagnostics?.timeGapStatus ?? matchup.timeGapStatus;
  if (gapStatus === 'too_large') {
    limitations.push(
      matchup.timeGapReason ??
        'Time gap too large for a valid comparison: residual statistics are withheld.'
    );
  } else if (gapStatus === 'marginal') {
    limitations.push(
      `The observation-model time gap exceeds ${24} h; residuals are reported but the sample is not a routine matchup.`
    );
  }
  if (typeof missingQcCount === 'number' && missingQcCount > 0) {
    limitations.push(
      `${missingQcCount} observation level(s) carry no QC flag in the source; their values were accepted on the documented lenient assumption (flag treated as good) rather than discarded.`
    );
  }
  if (matchup.modelDataStatus === 'SIMULATED') {
    limitations.push('HYCOM values are synthetic fixture-backed data, not scientific measurements.');
  }

  return limitations;
}

/**
 * Phase 2C diagnostic context. Renders backend-provided counts and matching
 * metadata only — the frontend recomputes no coverage, separation, tolerance
 * or statistic value here.
 */
function MatchupDiagnosticsPanel({ matchup }: { matchup: ArgoMatchupResponse }) {
  const diagnostics: MatchupDiagnostics | null | undefined = matchup.diagnostics;
  const repeatedNativeDepths = diagnostics?.repeatedNativeDepthMatchCount ?? 0;
  const limitations = buildMatchupLimitations(matchup);
  const depthSelectionLabel = matchup.modelDepthSelection ? matchup.modelDepthSelection.toUpperCase() : 'Unavailable';
  const toleranceLabel =
    typeof matchup.matchingToleranceM === 'number' && Number.isFinite(matchup.matchingToleranceM)
      ? `≤ ${matchup.matchingToleranceM} m`
      : 'Unavailable';
  const interpolationLabel = diagnostics ? (diagnostics.interpolationApplied ? 'APPLIED' : 'NONE') : 'Unavailable';
  const matchMode = matchup.matchMode ?? 'model_levels';
  // Missing QC flags stay lenient upstream but must be disclosed next to the
  // other counts rather than hidden.
  const missingQcCount = diagnostics?.missingQcLevelCount ?? matchup.missingQcLevelCount;
  const missingQcLabel =
    typeof missingQcCount === 'number' && Number.isFinite(missingQcCount)
      ? formatDiagnosticCount(missingQcCount, 'levels')
      : 'Unavailable';
  // Matching-method rows fall back to Unavailable, never to an assumed value.
  const depthBasisLabel =
    (matchup.depthSource && DEPTH_SOURCE_LABELS[matchup.depthSource]) || 'Unavailable';
  const variableBasisLabel = matchup.variableBasis ? matchup.variableBasis.toUpperCase() : 'Unavailable';
  const argoDataModeLabel = matchup.argoDataMode ? matchup.argoDataMode.toUpperCase() : 'Unavailable';
  const verticalModeLabel = matchup.matchMode ? matchup.matchMode.toUpperCase() : 'Unavailable';
  const horizontalModeLabel = matchup.spatialMode ? matchup.spatialMode.toUpperCase() : 'Unavailable';

  return (
    <>
      <div className="bg-white/5 border border-cyan-500/20 rounded-xl p-2.5 space-y-2">
        <div className="flex items-center justify-between font-mono">
          <div className="text-[10px] font-bold text-cyan-300 tracking-wider">MATCHUP DIAGNOSTICS</div>
          <span className="text-[8px] text-slate-500">CONTEXT ONLY · NOT A QUALITY SCORE</span>
        </div>

        {!diagnostics && (
          <div className="font-mono text-[8.5px] text-slate-400 leading-relaxed">
            MATCHUP COVERAGE UNAVAILABLE FROM THIS RESPONSE — NO OBSERVATION DENOMINATOR IS ASSUMED.
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[8.5px]">
          <span className="text-slate-500">MATCHED OBSERVATIONS</span>
          <span className="text-right text-slate-200 font-bold">
            {formatDiagnosticCount(diagnostics?.matchedObservationCount, 'matched')}
          </span>
          <span className="text-slate-500">UNMATCHED OBSERVATIONS</span>
          <span className="text-right text-slate-200 font-bold">
            {formatDiagnosticCount(diagnostics?.unmatchedObservationCount, 'unmatched')}
          </span>
          <span className="text-slate-500">MATCHED PERCENTAGE</span>
          <span className="text-right text-slate-200 font-bold">
            {formatMatchedPercentage(diagnostics?.matchedPercentage)}
          </span>
          <span className="text-slate-500">OBSERVATION–MODEL TIME SEPARATION</span>
          <span className="text-right text-slate-200 font-bold">
            {formatDiagnosticMetric(matchup.timeDifferenceHours, 2, 'h')}
          </span>
          <span className="text-slate-500">HORIZONTAL SEPARATION</span>
          <span className="text-right text-slate-200 font-bold">
            {formatDiagnosticMetric(matchup.distanceKm, 2, 'km')}
          </span>
          <span className="text-slate-500">DEPTH TOLERANCE</span>
          <span className="text-right text-slate-200 font-bold">{toleranceLabel}</span>
          <span className="text-slate-500">INTERPOLATION</span>
          <span className="text-right text-slate-200 font-bold">{interpolationLabel}</span>
          <span className="text-slate-500">INTERPOLATED LEVELS</span>
          <span className="text-right text-slate-200 font-bold">
            {formatDiagnosticCount(diagnostics?.interpolatedLevelCount, 'levels')}
          </span>
          <span className="text-slate-500">NATIVE LEVELS</span>
          <span className="text-right text-slate-200 font-bold">
            {formatDiagnosticCount(diagnostics?.nativeLevelCount, 'levels')}
          </span>
          <span className="text-slate-500">LEVELS WITHOUT QC FLAGS</span>
          <span
            className={`text-right font-bold ${
              typeof missingQcCount === 'number' && missingQcCount > 0
                ? 'text-amber-300'
                : 'text-slate-200'
            }`}
          >
            {missingQcLabel}
          </span>
          <span className="text-slate-500">ARGO VARIABLE BASIS</span>
          <span className="text-right text-slate-200 font-bold">{variableBasisLabel}</span>
          <span className="text-slate-500">ARGO DATA MODE</span>
          <span className="text-right text-slate-200 font-bold">{argoDataModeLabel}</span>
          <span className="text-slate-500">DEPTH BASIS (ARGO)</span>
          <span className="text-right text-slate-200 font-bold">{depthBasisLabel}</span>
          <span className="text-slate-500">VERTICAL MATCHING</span>
          <span className="text-right text-slate-200 font-bold">{verticalModeLabel}</span>
          <span className="text-slate-500">HORIZONTAL MATCHING</span>
          <span className="text-right text-slate-200 font-bold">{horizontalModeLabel}</span>
          <span className="text-slate-500">DEEPEST MATCHED ARGO DEPTH</span>
          <span className="text-right text-slate-200 font-bold">
            {formatDiagnosticMetric(diagnostics?.deepestMatchedObservationDepthM, 0, 'm (source)')}
          </span>
          <span className="text-slate-500">DEEPEST MATCHED MODEL DEPTH</span>
          <span className="text-right text-slate-200 font-bold">
            {formatDiagnosticMetric(diagnostics?.deepestMatchedModelDepthM, 0, 'm (native)')}
          </span>
        </div>

        <div className="font-mono text-[8px] text-slate-400 leading-relaxed">
          MODEL DEPTH SELECTION: <span className="text-slate-300">{depthSelectionLabel}</span>
          {(matchup.matchMode ?? 'interpolated') !== 'native' && (
            <>
              {' '}· THE ±{matchup.matchingToleranceM} M TOLERANCE ONLY APPLIES IN NATIVE MODE.
            </>
          )}
        </div>

        {repeatedNativeDepths > 0 && matchMode === 'native' && (
          <div className="font-mono text-[8px] text-amber-300/90 leading-relaxed">
            REPEATED NATIVE-DEPTH MATCHES: {repeatedNativeDepths} — TWO OR MORE OBSERVATIONS SHARE THE SAME NATIVE
            HYCOM LEVEL AND REMAIN SEPARATE MATCHED PAIRS.
          </div>
        )}

        <div className="pt-1.5 border-t border-white/10 space-y-1">
          <div className="font-mono text-[8px] text-slate-400 tracking-wider">
            VALID STATISTICAL PAIRS · PHASE 2B STATISTICS AS RETURNED BY THE BACKEND
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[8.5px]">
            <span className="text-slate-500">TEMPERATURE VALID PAIRS</span>
            <span className="text-right text-slate-200 font-bold">
              {formatDiagnosticCount(matchup.statistics?.temperature?.n, 'valid pairs')}
            </span>
            <span className="text-slate-500">SALINITY VALID PAIRS</span>
            <span className="text-right text-slate-200 font-bold">
              {formatDiagnosticCount(matchup.statistics?.salinity?.n, 'valid pairs')}
            </span>
          </div>
          <div className="font-mono text-[7.5px] text-slate-500 leading-relaxed">
            MATCHED PAIRS AND VALID STATISTICAL PAIRS DIFFER WHEN TEMPERATURE/SALINITY VALUES ARE MISSING OR
            NON-FINITE.
          </div>
        </div>
      </div>

      {limitations.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 space-y-1.5">
          <div className="font-mono text-[10px] font-bold text-slate-300 tracking-wider">LIMITATIONS</div>
          <ul className="space-y-1">
            {limitations.map((limitation) => (
              <li key={limitation} className="font-mono text-[8px] text-slate-400 leading-relaxed">
                · {limitation}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export const ArgoMatchupDrawer: React.FC<ArgoMatchupDrawerProps> = ({ profile, onClose }) => {
  const [matchup, setMatchup] = useState<ArgoMatchupResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Vertical matching mode requested by the user. The backend is the authority
  // on what was actually applied; this only selects the next request.
  const [matchMode, setMatchMode] = useState<MatchupMode>('model_levels');
  const abortControllerRef = useRef<AbortController | null>(null);
  const matchupRequestIdRef = useRef(0);

  // Phase 1D: Argo observation profile state — local to this drawer so the
  // charts never trigger Cesium or global application re-renders.
  const [activeTab, setActiveTab] = useState<DrawerTab>('profile');
  const [observations, setObservations] = useState<ArgoObservationPoint[] | null>(null);
  const [obsLoading, setObsLoading] = useState<boolean>(false);
  const [obsUnavailable, setObsUnavailable] = useState<string | null>(null);
  const obsAbortRef = useRef<AbortController | null>(null);
  /** Drawer-session cache: one observations fetch per profile id. */
  const obsCacheRef = useRef<Map<string, ArgoObservationPoint[]>>(new Map());

  const handleFetchMatchup = useCallback(
    async (profileId: string, mode: MatchupMode) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const requestId = ++matchupRequestIdRef.current;
      const { signal } = controller;
      setMatchup(null);
      setLoading(true);
      setError(null);
      try {
        const res = await apiProvider.getArgoMatchup(profileId, signal, mode);
        if (signal.aborted || requestId !== matchupRequestIdRef.current) return;
        if (res) {
          setMatchup(res);
          setError(res.statusMessage || null);
        } else {
          setMatchup(null);
          setError("NO REAL OBSERVATION AVAILABLE");
        }
      } catch {
        if (signal.aborted || requestId !== matchupRequestIdRef.current) return;
        setMatchup(null);
        setError("NO REAL OBSERVATION AVAILABLE");
      } finally {
        if (!signal.aborted && requestId === matchupRequestIdRef.current) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const effectRequestId = matchupRequestIdRef.current;

    // Kick off async in a microtask so the effect body itself stays
    // side-effect free (no synchronous setState cascade).
    void Promise.resolve().then(() => {
      if (effectRequestId !== matchupRequestIdRef.current) return;
      if (!profile) {
        // Drawer closed: clear visible state so reopening starts clean.
        // Not abort-guarded: clearing while closed is always safe, and an
        // immediate reopen's own microtask (queued after this one) restores
        // the freshly selected profile's state.
        setMatchup(null);
        setError(null);
        setLoading(false);
        abortControllerRef.current?.abort();
        matchupRequestIdRef.current += 1;
        return;
      }
      void handleFetchMatchup(profile.profile_id, matchMode);
    });

    return () => {
      abortControllerRef.current?.abort();
      matchupRequestIdRef.current += 1;
    };
  }, [profile, handleFetchMatchup, matchMode]);

  useEffect(() => {
    // Same lifecycle pattern as the matchup fetch: abort the previous
    // observations request so a stale response can never overwrite the
    // profile that is currently open. Aborts surface no visible error.
    obsAbortRef.current?.abort();
    const controller = new AbortController();
    obsAbortRef.current = controller;
    const { signal } = controller;

    // Kick off async in a microtask so the effect body itself stays
    // side-effect free (no synchronous setState cascade).
    void Promise.resolve().then(() => {
      if (!profile) {
        // Drawer closed: clear visible state so reopening starts clean.
        // Not abort-guarded: clearing while closed is always safe, and an
        // immediate reopen's own microtask (queued after this one) restores
        // the freshly selected profile's state.
        setObservations(null);
        setObsLoading(false);
        setObsUnavailable(null);
        setActiveTab('profile');
        return;
      }
      if (signal.aborted) return;

      // Reuse already-fetched observations for this profile during the drawer
      // session instead of re-requesting the same data.
      const cached = obsCacheRef.current.get(profile.profile_id);
      if (cached) {
        setObservations(cached);
        setObsLoading(false);
        setObsUnavailable(null);
        return;
      }

      setObsLoading(true);
      setObsUnavailable(null);
      apiProvider
        .getArgoObservations(profile.profile_id, signal)
        .then((res) => {
          if (signal.aborted) return;
          let resolved: ArgoObservationPoint[] | null = res;
          if (!resolved && profile.observations && profile.observations.length > 0) {
            // Endpoint unavailable: fall back to the observations embedded in
            // the already-fetched profile payload (same real backend data).
            resolved = profile.observations;
          }
          if (resolved) {
            obsCacheRef.current.set(profile.profile_id, resolved);
            setObservations(resolved);
          } else {
            setObservations(null);
            setObsUnavailable(
              'NO REAL ARGO OBSERVATION DATA AVAILABLE FOR THIS PROFILE — NOTHING IS FABRICATED.'
            );
          }
        })
        .catch(() => {
          if (signal.aborted) return;
          setObservations(null);
          setObsUnavailable(
            'NO REAL ARGO OBSERVATION DATA AVAILABLE FOR THIS PROFILE — NOTHING IS FABRICATED.'
          );
        })
        .finally(() => {
          if (!signal.aborted) setObsLoading(false);
        });
    });

    return () => {
      controller.abort();
    };
  }, [profile]);

  // Chart-only normalized representation; the raw response is never mutated.
  const normalized = useMemo(
    () => normalizeArgoObservations(observations),
    [observations]
  );
  const normalizedMatchup = useMemo(
    () => {
      if (!matchup) return null;
      const normalized = normalizeArgoMatchupComparisons(matchup.comparisons);
      return { ...normalized, stats: { ...normalized.stats, matchMode: matchup.matchMode ?? 'model_levels' } };
    },
    [matchup]
  );
  // Backend-reported observation-model time separation; drives the badge tone
  // and whether residual statistics may be presented at all.
  const timeGapStatus =
    matchup?.diagnostics?.timeGapStatus ?? matchup?.timeGapStatus ?? 'good';

  if (!profile) return null;

  const scientificStatus = profile.provenance?.data_status || 'UNAVAILABLE';
  const scientificStatusLabel =
    scientificStatus === 'DEMO'
      ? 'DEMO PROFILE SNAPSHOT'
      : scientificStatus === 'REAL'
      ? 'REAL IN-SITU OBSERVATION'
      : scientificStatus;

  return (
    <div className="fixed right-20 top-36 z-30 font-mono text-xs select-none transition-all duration-300">
      <div className="bg-[#080c14]/90 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-4.5 shadow-2xl w-[420px] text-slate-100 font-sans max-h-[calc(100vh-180px)] flex flex-col">
        {/* Drawer Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="font-mono font-bold text-[11px] uppercase tracking-widest text-white flex items-center gap-2">
                ARGO PROFILE
                <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">
                  {scientificStatusLabel}
                </span>
              </div>
              <div className="text-[9.5px] font-mono text-slate-400">
                IN-SITU ARGO OBSERVATIONS · SOURCE DEPTH
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Close Drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Argo Profile Metadata Card (all tabs) */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2 mt-3 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
                ARGO FLOAT PROFILE
              </div>
              <div className="text-base font-bold font-mono text-cyan-300 mt-0.5">
                FLOAT: {profile.float_id}
              </div>
              <div className="text-[8.5px] font-mono text-slate-500 mt-0.5 truncate max-w-[190px]" title={profile.profile_id}>
                PROFILE: {profile.profile_id}
              </div>
            </div>
            <div className="text-right font-mono">
              <div className="text-[9.5px] text-slate-400">CYCLE #{profile.cycle_number}</div>
              <div className="text-[9px] text-slate-500 mt-0.5">{profile.platform_type}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 font-mono text-[10px] pt-1 border-t border-white/10">
            <div>
              <span className="text-slate-400">LOCATION: </span>
              <span className="text-slate-200 font-semibold">
                {profile.latitude.toFixed(2)}°N, {profile.longitude.toFixed(2)}°E
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-400">OBS TIME: </span>
              <span className="text-slate-200 font-semibold">
                {profile.observation_time.replace('T', ' ').replace('Z', ' UTC')}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between font-mono text-[9px]">
            <span className="text-slate-500">
              OBS LEVELS: <span className="text-slate-300 font-bold">{profile.observations_count}</span>
            </span>
            <span className="text-slate-500 truncate max-w-[210px]" title={profile.institution}>
              DATA SOURCE: <span className="text-slate-300">{profile.institution}</span>
            </span>
          </div>
          <div className="font-mono text-[9px] truncate" title={profile.provenance?.source || ''}>
            <span className="text-slate-500">SOURCE: </span>
            <span className="text-slate-300">{profile.provenance?.source || profile.institution}</span>
          </div>
          <div className="font-mono text-[9px]">
            <span className="text-slate-500">PROVIDER: </span>
            <span className="text-slate-300">{profile.provenance?.provider || profile.institution}</span>
          </div>

          <div className="font-mono text-[9px]">
            <span className="text-slate-500">STATUS: </span>
            <span className="text-amber-400 font-bold">{profile.provenance?.data_status || 'UNAVAILABLE'}</span>
          </div>
          <div className="font-mono text-[9px]">
            <span className="text-slate-500">SOURCE LABEL: </span>
            <span className="text-slate-400">{profile.data_status}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-[9px] text-slate-500">
            <span>VARIABLE: <b className="text-slate-300">{profile.provenance?.variable || '—'}</b></span>
            <span className="text-right">UNITS: <b className="text-slate-300">{profile.provenance?.units || '—'}</b></span>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="grid grid-cols-4 gap-1.5 pt-3 shrink-0" role="tablist" aria-label="Argo drawer sections">
          {(Object.keys(TAB_LABELS) as DrawerTab[]).map((tab) => (
            <button
              key={tab}
              title={
                tab === 'matchup'
                  ? 'Matchup tab'
                  : tab === 'region'
                    ? 'Regional tab'
                    : `${TAB_LABELS[tab].charAt(0)}${TAB_LABELS[tab].slice(1).toLowerCase()} tab`
              }
              onClick={() => setActiveTab(tab)}
              className={`py-1.5 rounded-lg border font-mono text-[9px] font-bold tracking-wider transition-colors ${
                activeTab === tab
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* Scrollable Tab Content */}
        <div className="overflow-y-auto custom-scrollbar space-y-3.5 pt-3 pr-1 min-h-0">
          {/* ================= PROFILE TAB ================= */}
          {activeTab === 'profile' && (
            <>
              {/* Observation-profile provenance banner */}
              <div className="bg-cyan-500/10 border border-cyan-500/25 rounded-xl p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-cyan-300 tracking-widest">
                    <Waves className="w-3.5 h-3.5" />
                    ARGO OBSERVATION PROFILE
                  </div>
                  <span className="text-[8px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono font-bold">
                    {scientificStatusLabel}
                  </span>
                </div>
                <div className="font-mono text-[7.5px] text-slate-500 leading-relaxed">
                  THIS TAB PLOTS THE RAW ARGO OBSERVATION LIST (SOURCE-PROVIDED depth_m, NO PRESSURE
                  CONVERSION). THE MODEL COMPARISON TAB RE-DERIVES DEPTH FROM PRESSURE WITH
                  gsw.z_from_p (TEOS-10/GSW).
                </div>
              </div>

              {/* Observations lifecycle states */}
              {obsLoading && (
                <div className="flex items-center gap-2 text-[9.5px] text-cyan-300 font-mono px-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>FETCHING ARGO OBSERVATIONS…</span>
                </div>
              )}
              {!obsLoading && obsUnavailable && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2.5 font-mono text-[10px]">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{OBSERVATIONS_UNAVAILABLE}</span>
                </div>
              )}

              {/* Depth-profile charts + normalization disclosure */}
              {!obsLoading && !obsUnavailable && (
                <>
                  <ArgoProfileChart normalized={normalized} />
                  <div className="bg-[#05070a] border border-white/10 rounded-xl p-2 space-y-1 font-mono text-[8.5px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">RAW OBSERVATIONS</span>
                      <span className="text-slate-200 font-bold">{normalized.stats.totalObservations}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">CHART DEPTH LEVELS</span>
                      <span className="text-slate-200 font-bold">
                        {normalized.stats.chartPoints}
                        {normalized.stats.minDepthM !== null && normalized.stats.maxDepthM !== null
                          ? ` (${normalized.stats.minDepthM}–${normalized.stats.maxDepthM} M)`
                          : ''}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">AVAILABLE VARIABLES</span>
                      <span className="text-slate-200 font-bold">
                        {normalized.stats.hasTemperature && normalized.stats.hasSalinity
                          ? 'TEMPERATURE + SALINITY'
                          : normalized.stats.hasTemperature
                          ? 'TEMPERATURE ONLY'
                          : normalized.stats.hasSalinity
                          ? 'SALINITY ONLY'
                          : 'NONE'}
                      </span>
                    </div>
                    {normalized.stats.duplicateDepthObservations > 0 && (
                      <div className="text-amber-300/90 pt-1 border-t border-white/5">
                        DUPLICATE DEPTH LEVELS: {normalized.stats.duplicateDepthObservations} ·{' '}
                        {ARGO_DUPLICATE_DEPTH_STRATEGY.toUpperCase()}
                      </div>
                    )}
                    {normalized.stats.invalidDepthCount > 0 && (
                      <div className="text-amber-300/90">
                        MISSING/INVALID DEPTH: {normalized.stats.invalidDepthCount} OBS EXCLUDED
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ================= MATCHUP TAB (existing interface) ================= */}
          {activeTab === 'matchup' && (
            <>
              {/* Match Status, mode toggle & action row */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleFetchMatchup(profile.profile_id, matchMode)}
                    disabled={loading}
                    className="flex-1 py-2 px-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-mono text-[10.5px] font-bold transition-all flex items-center justify-center gap-2 group disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                    <span>{loading ? 'MATCHING WITH HYCOM...' : 'COMPARE WITH HYCOM'}</span>
                  </button>
                </div>

                {/* Vertical matching mode: interpolated matches many more float
                    levels, native matches only the pre-existing tolerance rule. */}
                <div
                  className="flex items-center gap-2 font-mono"
                  role="group"
                  aria-label="Comparison mode"
                >
                  <span className="text-[8px] text-slate-500 shrink-0">COMPARISON</span>
                  <div className="grid grid-cols-3 gap-1 flex-1">
                    {MATCH_MODES.map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setMatchMode(mode)}
                        aria-pressed={matchMode === mode}
                        title={MATCH_MODE_TITLES[mode]}
                        className={`py-1 rounded-lg border font-mono text-[7.5px] font-bold tracking-wider transition-colors ${
                          matchMode === mode
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : 'bg-white/5 text-slate-500 border-white/10 hover:text-slate-300'
                        }`}
                      >
                        {MATCH_MODE_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* No Real Data Warning Box */}
              {error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2.5 font-mono text-[10px]">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* HYCOM Match Metadata */}
              {matchup && !matchup.statusMessage && (
                <div className="bg-white/5 border border-cyan-500/20 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between font-mono">
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>MATCHED HYCOM MODEL LOCATION</span>
                    </div>
                      <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        {matchup.modelDataStatus === 'SIMULATED'
                          ? 'HYCOM MODEL — SYNTHETIC FIXTURE'
                          : 'HYCOM MODEL'}
                    </span>
                  </div>

                  {/* Backend-reported matching method: depth basis, vertical and
                      horizontal sub-sampling actually applied. */}
                  <MatchupMethodBadges matchup={matchup} />

                  <div className="grid grid-cols-3 gap-2 font-mono text-[10px] pt-1 text-center">
                    <div className="bg-[#05070a] p-2 rounded-lg border border-white/10">
                      <div className="text-[8px] text-slate-400 uppercase">DISTANCE</div>
                      <div className="text-cyan-300 font-bold mt-0.5">{matchup.distanceKm} km</div>
                    </div>

                    <div className="bg-[#05070a] p-2 rounded-lg border border-white/10">
                      <div className="text-[8px] text-slate-400 uppercase">TIME DIFF</div>
                      <div className="text-amber-300 font-bold mt-0.5">{matchup.timeDifferenceHours} hrs</div>
                    </div>

                    <div className="bg-[#05070a] p-2 rounded-lg border border-white/10">
                      <div className="text-[8px] text-slate-400 uppercase">HYCOM DATASET</div>
                      <div className="text-slate-200 font-bold mt-0.5 truncate">{matchup.modelDataset}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono text-[9px] pt-1 border-t border-white/10">
                    <div>
                      <span className="text-slate-500">ARGO TIME: </span>
                      <span className="text-slate-200">{matchup.observationTimestamp}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">HYCOM TIME: </span>
                      <span className="text-slate-200">{matchup.modelTimestamp}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">MATCHED POINTS: </span>
                      <span className="text-slate-200 font-bold">{matchup.matchedPointCount}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">DEPTH TOLERANCE: </span>
                      <span className="text-slate-200">{matchup.matchingToleranceM} m</span>
                    </div>
                  </div>
                  <div className="font-mono text-[8px] text-slate-500">
                    MODEL DEPTHS: {matchup.modelDepthSelection.toUpperCase()} ·{' '}
                    {matchMode === 'model_levels'
                      ? 'COMPARED AT THE MODEL\u2019S OWN DEPTH LEVELS; THE FLOAT IS INTERPOLATED ONTO EACH. SOLID DOTS ARE NATIVE FLOAT LEVELS, HOLLOW DOTS ARE INTERPOLATED.'
                      : matchMode === 'float_levels'
                        ? 'MODEL VALUES ARE INTERPOLATED ONTO EACH FLOAT DEPTH AND INCLUDE MODEL INTERPOLATION ERROR ACROSS SPARSE LEVELS.'
                        : 'MODEL VALUES USE NATIVE HYCOM LEVELS RETURNED BY THE MATCHUP RESPONSE.'}
                  </div>
                </div>
              )}

              {matchup && !matchup.statusMessage && normalizedMatchup && (
                <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[10px] font-bold text-cyan-300 tracking-wider">
                      MODEL VS OBSERVATION
                    </div>
                    <div className="font-mono text-[8px] text-slate-500">
                      ARGO OBSERVATION · HYCOM MODEL
                    </div>
                  </div>
                  <div className="font-mono text-[8px] text-slate-500 leading-relaxed">
                    Visual comparison only. Argo points use the observation depth; HYCOM points use
                    the model depth reported by the backend. No interpolation, depth conversion or
                    statistic is computed in the frontend.
                  </div>
                  {normalizedMatchup.stats.duplicateDepthCount > 0 && (
                    <div className="font-mono text-[8px] text-amber-300/90">
                      REPEATED MATCHED DEPTH VALUES: {normalizedMatchup.stats.duplicateDepthCount} PRESERVED
                      AS SEPARATE MATCHED PAIRS.
                    </div>
                  )}
                  <ArgoProfileChart
                    normalized={normalized}
                    comparison={normalizedMatchup}
                    heightPx={180}
                  />
                </div>
              )}

              {matchup && !matchup.statusMessage && <MatchupDiagnosticsPanel matchup={matchup} />}

              {/* Time-gap guard: beyond the configured limit the two samples
                  describe different ocean states, so the residual-statistics
                  section is replaced by an explanation instead of being shown
                  with empty numbers. Both profiles remain visible. */}
              {matchup && !matchup.statusMessage && timeGapStatus === 'too_large' && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-1.5">
                  <div className="flex items-center gap-2 font-mono">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span className="text-[10px] font-bold text-rose-300">
                      {TIME_GAP_MESSAGES.too_large.toUpperCase()}
                    </span>
                  </div>
                  <div className="font-mono text-[8px] text-slate-400 leading-relaxed">
                    {matchup.timeGapReason ??
                      'Residual statistics are withheld for this observation-model pair.'}
                  </div>
                  <div className="font-mono text-[8px] text-slate-500 leading-relaxed">
                    BOTH PROFILES ARE STILL SHOWN ABOVE.
                  </div>
                </div>
              )}

              {matchup && !matchup.statusMessage && timeGapStatus !== 'too_large' && (
                <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-2.5 space-y-2">
                  <div className="font-mono text-[10px] font-bold text-cyan-300 tracking-wider">
                    MATCHUP STATISTICS
                  </div>
                  {(
                    <>
                      <div className="font-mono text-[8px] text-slate-500 leading-relaxed">
                        Statistics use valid Argo–HYCOM matched pairs selected by the existing matchup method.
                        Residuals are HYCOM − Argo. These descriptive values describe the selected matchup sample
                        and are not a formal model-validation score.
                      </div>
                      {timeGapStatus === 'marginal' && (
                        <div className="font-mono text-[8px] text-amber-300/90 leading-relaxed">
                          {TIME_GAP_MESSAGES.marginal.toUpperCase()}
                        </div>
                      )}
                      {matchup.modelDataStatus === 'SIMULATED' && (
                        <div className="font-mono text-[8px] text-amber-300/90">
                          SYNTHETIC FIXTURE-BACKED STATISTICS — NOT SCIENTIFIC MEASUREMENTS.
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-2">
                        <MatchupStatisticsCard
                          label="TEMPERATURE"
                          statistics={matchup.statistics?.temperature}
                          unit="°C"
                        />
                        <MatchupStatisticsCard
                          label="SALINITY"
                          statistics={matchup.statistics?.salinity}
                          unit="PSU"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Profile Comparison Table */}
              {matchup && matchup.comparisons && matchup.comparisons.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between font-mono text-[9px] text-slate-400 px-1">
                    <span>VERTICAL DEPTH / PARAMETER RESIDUALS</span>
                    <span className="text-cyan-400 font-semibold">RESIDUAL = HYCOM − Argo · ΔT = HYCOM − Argo</span>
                  </div>
                  <div className="font-mono text-[8px] text-slate-500 px-1">
                    Residuals are the reported difference (HYCOM minus Argo) at each matched observation/model
                    pair; they are not model-error or validation statistics.
                  </div>

                  <div className="border border-white/15 rounded-xl overflow-hidden font-mono text-[10px]">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#05070a] text-slate-400 text-[8.5px] uppercase border-b border-white/15">
                          <th className="py-2 px-2 text-center">Depth</th>
                          <th className="py-2 px-1 text-center" title="How the model value was obtained">Method</th>
                          <th className="py-2 px-2 text-center">Argo T</th>
                          <th className="py-2 px-2 text-center">HYCOM T</th>
                          <th className="py-2 px-2 text-center">ΔT (°C)</th>
                          <th className="py-2 px-2 text-center">Argo S</th>
                          <th className="py-2 px-2 text-center">HYCOM S</th>
                          <th className="py-2 px-2 text-center">ΔS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10 bg-[#080c14]/50">
                        {matchup.comparisons.map((c, idx) => {
                          const dt = c.temperatureResidualC;
                          const ds = c.salinityResidualPSU;

                          return (
                            <tr key={idx} className="hover:bg-white/5 transition-colors">
                              <td className="py-2 px-2 text-center font-bold text-cyan-300">
                                {c.depthM} m
                              </td>
                              <td className="py-2 px-1 text-center">
                                {c.method ? (
                                  <span
                                    title={
                                      c.method === 'interpolated'
                                        ? 'Model value linearly interpolated between two native HYCOM levels'
                                        : c.method === 'float_interpolated'
                                          ? 'Float value interpolated between two float levels onto this model level'
                                          : c.method === 'float_native'
                                            ? 'Float value taken from a native float level'
                                            : 'Model value taken from one native HYCOM level'
                                    }
                                    className={`px-1.5 py-0.5 rounded font-mono text-[8px] font-bold ${
                                      c.method === 'interpolated'
                                        ? 'bg-orange-500/15 text-orange-300 border border-orange-500/30'
                                        : 'bg-white/10 text-slate-400 border border-white/20'
                                    }`}
                                  >
                                    {c.method === 'interpolated' ||
                                    c.method === 'float_interpolated'
                                      ? 'INTP'
                                      : 'NAT'}
                                  </span>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-center text-slate-200">
                                {c.argoTemperatureC !== null ? `${c.argoTemperatureC}°` : '—'}
                              </td>
                              <td className="py-2 px-2 text-center text-slate-300">
                                {c.modelTemperatureC !== null ? `${c.modelTemperatureC}°` : '—'}
                              </td>
                              <td className="py-2 px-2 text-center">
                                {dt !== null && dt !== undefined ? (
                                  <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${
                                    Math.abs(dt) <= 0.5
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                      : dt > 0
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                      : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                  }`}>
                                    {dt > 0 ? `+${dt}` : dt}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="py-2 px-2 text-center text-slate-200">
                                {c.argoSalinityPSU !== null && c.argoSalinityPSU !== undefined ? c.argoSalinityPSU : '—'}
                              </td>
                              <td className="py-2 px-2 text-center text-slate-300">
                                {c.modelSalinityPSU !== null && c.modelSalinityPSU !== undefined ? c.modelSalinityPSU : '—'}
                              </td>
                              <td className="py-2 px-2 text-center">
                                {ds !== null && ds !== undefined ? (
                                  <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${
                                    Math.abs(ds) <= 0.2
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  }`}>
                                    {ds > 0 ? `+${ds}` : ds}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>

                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ================= DATA TAB (raw observations) ================= */}
          {/* ================= REGIONAL SUMMARY TAB ================= */}
          {activeTab === 'region' && (
            <RegionalSummary />
          )}

          {/* ================= DATA / PROVENANCE TAB ================= */}
          {activeTab === 'data' && (
            <>
              {obsLoading && (
                <div className="flex items-center gap-2 text-[9.5px] text-cyan-300 font-mono px-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>FETCHING ARGO OBSERVATIONS…</span>
                </div>
              )}
              {!obsLoading && obsUnavailable && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2.5 font-mono text-[10px]">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{OBSERVATIONS_UNAVAILABLE}</span>
                </div>
              )}
              {!obsLoading && !obsUnavailable && observations && observations.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between font-mono text-[9px] text-slate-400 px-1">
                    <span className="flex items-center gap-1.5">
                      <Table2 className="w-3 h-3" />
                      RAW OBSERVATION RESPONSE
                    </span>
                    <span>{observations.length} LEVELS</span>
                  </div>

                  <div className="border border-white/15 rounded-xl overflow-hidden font-mono text-[10px]">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#05070a] text-slate-400 text-[8.5px] uppercase border-b border-white/15">
                          <th className="py-2 px-2 text-center">Depth (m)</th>
                          <th className="py-2 px-2 text-center">Pres (dbar)</th>
                          <th className="py-2 px-2 text-center">Temp (°C)</th>
                          <th className="py-2 px-2 text-center">Sal (PSU)</th>
                          <th className="py-2 px-2 text-center">Temp QC</th>
                          <th className="py-2 px-2 text-center">Psal QC</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10 bg-[#080c14]/50">
                        {observations.map((o, idx) => (
                          <tr key={idx} className="hover:bg-white/5 transition-colors">
                            <td className="py-2 px-2 text-center font-bold text-cyan-300">{o.depth_m}</td>
                            <td className="py-2 px-2 text-center text-slate-300">{o.pressure_dbar}</td>
                            <td className="py-2 px-2 text-center text-slate-200">
                              {o.temperature_c !== null && o.temperature_c !== undefined ? o.temperature_c : '—'}
                            </td>
                            <td className="py-2 px-2 text-center text-slate-200">
                              {o.salinity_psu !== null && o.salinity_psu !== undefined ? o.salinity_psu : '—'}
                            </td>
                            <td className="py-2 px-2 text-center text-slate-400">{o.temp_qc}</td>
                            <td className="py-2 px-2 text-center text-slate-400">{o.psal_qc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-[7.5px] text-slate-600 font-mono px-1 leading-relaxed">
                    AS RETURNED BY THE BACKEND ARGO PROVIDER — UNMODIFIED. MISSING VALUES RENDER AS —.
                  </div>
                </div>
              )}
              {!obsLoading && !obsUnavailable && observations && observations.length === 0 && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 flex items-center gap-2.5 font-mono text-[10px]">
                  <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>EMPTY OBSERVATION RESPONSE — 0 LEVELS</span>
                </div>
              )}
            </>
          )}

          {/* Footer Metadata & Provenance */}
          <div className="pt-2 border-t border-white/10 font-mono text-[8.5px] text-slate-400 flex items-center justify-between">
            <span>PROVENANCE: {scientificStatusLabel}</span>
            <span className={`font-bold ${scientificStatus === 'DEMO' ? 'text-purple-300' : 'text-emerald-400'}`}>
              STATUS: {scientificStatus}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
