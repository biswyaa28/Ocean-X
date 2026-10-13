'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import {
  ArgoMatchupResponse,
  Cyclone,
  GISLayer,
  ArgoProfile,
  AstronomicalData,
} from '../types/oceanlens';
import { DepthSlicePayload } from '../services/ApiProvider';
import { CurrentFieldDataStatus, EnvironmentalFlowField } from '../types/flow';
import { DepthSliceRenderConfig } from '../utils/depthSliceViz';
import { Loader2 } from 'lucide-react';
import { perfMonitor } from '../utils/perfMonitor';
import type { ArgoRibbonSceneData, RibbonVariable } from '../utils/argoProfileRibbon';

const CesiumViewerInner = dynamic(
  () => import('./CesiumViewerInner'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full absolute inset-0 bg-slate-950 flex flex-col items-center justify-center text-cyan-400 gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-cyan-400" />
        <div className="text-sm font-mono tracking-widest uppercase">
          Initializing 3D Bay of Bengal Cesium Globe...
        </div>
      </div>
    ),
  }
);

interface CesiumGlobeProps {
  cyclone: Cyclone | null;
  currentTrackIndex: number;
  layers: GISLayer[];
  argoProfiles?: ArgoProfile[];
  selectedArgoProfile?: ArgoProfile | null;
  onSelectArgoProfile?: (profile: ArgoProfile) => void;
  onInspectPoint?: (lat: number, lon: number) => void;
  onAstronomicalUpdate?: (data: AstronomicalData) => void;
  targetLocation?: { lat: number; lon: number; height?: number } | null;
  timestamp?: string;
  depthSliceVisible?: boolean;
  depthSlicePayload?: DepthSlicePayload | null;
  /** Resolved scientific render configuration (Phase 1C) — display only. */
  depthSliceRender?: DepthSliceRenderConfig | null;
  /** Depth-slice layer opacity (0..1) — this layer only. */
  depthSliceOpacity?: number;
  /** Real HYCOM UVEL/VVEL current field (Phase 1E), normalized. */
  currentField?: EnvironmentalFlowField | null;
  /** Data status of the current field (REAL / SIMULATED / UNAVAILABLE). */
  currentFieldStatus?: CurrentFieldDataStatus;
  /** Human-readable reason for the current field status. */
  currentFieldStatusReason?: string | null;
  /** Backend metadata for the current field (provenance chip). */
  currentFieldMetadata?: DepthSlicePayload | null;
  /** Matchup of the selected float, used only for model marker placement/labels. */
  argoRibbonMatchup?: ArgoMatchupResponse | null;
  /** Precomputed ribbon for the selected float. */
  argoRibbon?: ArgoRibbonSceneData | null;
  ribbonVariable?: RibbonVariable;
  ribbonPalette?: string;
  ribbonExaggeration?: number;
  ribbonResetToken?: number;
}

/**
 * Shallow-identity memo comparator: the Cesium subtree re-renders only when a
 * prop reference actually changes. Layers is treated per-item so toggling an
 * unrelated layer's metadata (e.g. status refresh creating new objects) does
 * not force reconciliation if layer active-states are identical.
 */
function cesiumGlobePropsAreEqual(
  prev: Readonly<CesiumGlobeProps>,
  next: Readonly<CesiumGlobeProps>
): boolean {
  if (prev.cyclone !== next.cyclone) return false;
  if (prev.currentTrackIndex !== next.currentTrackIndex) return false;
  if (prev.argoProfiles !== next.argoProfiles) return false;
  if (prev.selectedArgoProfile !== next.selectedArgoProfile) return false;
  if (prev.onSelectArgoProfile !== next.onSelectArgoProfile) return false;
  if (prev.onInspectPoint !== next.onInspectPoint) return false;
  if (prev.onAstronomicalUpdate !== next.onAstronomicalUpdate) return false;
  if (prev.targetLocation !== next.targetLocation) return false;
  if (prev.timestamp !== next.timestamp) return false;
  if (prev.depthSliceVisible !== next.depthSliceVisible) return false;
  if (prev.depthSlicePayload !== next.depthSlicePayload) return false;
  if (prev.depthSliceRender !== next.depthSliceRender) return false;
  if (prev.depthSliceOpacity !== next.depthSliceOpacity) return false;
  if (prev.currentField !== next.currentField) return false;
  if (prev.currentFieldStatus !== next.currentFieldStatus) return false;
  if (prev.currentFieldStatusReason !== next.currentFieldStatusReason) return false;
  if (prev.currentFieldMetadata !== next.currentFieldMetadata) return false;
  if (prev.argoRibbon !== next.argoRibbon) return false;
  if (prev.argoRibbonMatchup !== next.argoRibbonMatchup) return false;
  if (prev.ribbonVariable !== next.ribbonVariable) return false;
  if (prev.ribbonPalette !== next.ribbonPalette) return false;
  if (prev.ribbonExaggeration !== next.ribbonExaggeration) return false;
  if (prev.ribbonResetToken !== next.ribbonResetToken) return false;

  if (prev.layers === next.layers) return true;
  if (prev.layers.length !== next.layers.length) return false;

  for (let i = 0; i < prev.layers.length; i++) {
    const a = prev.layers[i];
    const b = next.layers[i];
    if (
      a.id !== b.id ||
      a.active !== b.active ||
      a.name !== b.name ||
      a.status !== b.status ||
      a.unit !== b.unit
    ) {
      return false;
    }
  }
  return true;
}

export const CesiumGlobe: React.FC<CesiumGlobeProps> = React.memo(
  (props) => {
    if (process.env.NODE_ENV !== 'production') {
      perfMonitor.recordCesiumGlobeRender();
    }
    return <CesiumViewerInner {...props} />;
  },
  cesiumGlobePropsAreEqual
);

CesiumGlobe.displayName = 'CesiumGlobe';
