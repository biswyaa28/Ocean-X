'use client';

import React, { useState, useEffect } from 'react';
import { ArgoProfile, ArgoMatchupResponse } from '../types/oceanlens';
import { apiProvider } from '../services/ApiProvider';
import { X, Activity, Waves, Compass, ArrowRight, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';

interface ArgoMatchupDrawerProps {
  profile: ArgoProfile | null;
  onClose: () => void;
}

export const ArgoMatchupDrawer: React.FC<ArgoMatchupDrawerProps> = ({ profile, onClose }) => {
  const [matchup, setMatchup] = useState<ArgoMatchupResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      handleFetchMatchup(profile.profile_id);
    } else {
      setMatchup(null);
      setError(null);
    }
  }, [profile]);

  const handleFetchMatchup = async (profileId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiProvider.getArgoMatchup(profileId);
      if (res) {
        setMatchup(res);
      } else {
        setMatchup(null);
        setError("NO REAL OBSERVATION AVAILABLE");
      }
    } catch {
      setMatchup(null);
      setError("NO REAL OBSERVATION AVAILABLE");
    } finally {
      setLoading(false);
    }
  };

  if (!profile) return null;

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
                MODEL ↔ OBSERVATION
                <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">
                  REAL • ARGO
                </span>
              </div>
              <div className="text-[9.5px] font-mono text-slate-400">
                IN-SITU PROFILES vs INCOIS HYCOM MODEL
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

        {/* Scrollable Container */}
        <div className="overflow-y-auto custom-scrollbar space-y-3.5 pt-3 pr-1">
          {/* Argo Profile Metadata Card */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
                  ARGO FLOAT PROFILE
                </div>
                <div className="text-base font-bold font-mono text-cyan-300 mt-0.5">
                  FLOAT: {profile.float_id}
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-[9.5px] text-slate-400">CYCLE #{profile.cycle_number}</div>
                <div className="text-[9px] text-slate-500 mt-0.5">{profile.institution}</div>
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
          </div>

          {/* Match Status & Action Row */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => handleFetchMatchup(profile.profile_id)}
              disabled={loading}
              className="flex-1 py-2 px-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-mono text-[10.5px] font-bold transition-all flex items-center justify-center gap-2 group disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
              <span>{loading ? 'MATCHING WITH HYCOM...' : 'COMPARE WITH HYCOM'}</span>
            </button>
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
                  REAL MODEL
                </span>
              </div>

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
            </div>
          )}

          {/* Profile Comparison Table */}
          {matchup && matchup.comparisons && matchup.comparisons.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[9px] text-slate-400 px-1">
                <span>VERTICAL DEPTH / PARAMETER RESIDUALS</span>
                <span className="text-cyan-400 font-semibold">ΔT = HYCOM − Argo</span>
              </div>

              <div className="border border-white/15 rounded-xl overflow-hidden font-mono text-[10px]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#05070a] text-slate-400 text-[8.5px] uppercase border-b border-white/15">
                      <th className="py-2 px-2 text-center">Depth</th>
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

          {/* Footer Metadata & Provenance */}
          <div className="pt-2 border-t border-white/10 font-mono text-[8.5px] text-slate-400 flex items-center justify-between">
            <span>PROVENANCE: REAL IN-SITU OBSERVATION</span>
            <span className="text-emerald-400 font-bold">STATUS: REAL</span>
          </div>
        </div>
      </div>
    </div>
  );
};
