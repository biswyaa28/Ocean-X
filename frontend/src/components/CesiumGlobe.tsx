'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { Cyclone, Station, GISLayer, ArgoProfile, AstronomicalData } from '../types/oceanlens';
import { Loader2 } from 'lucide-react';

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
  stations: Station[];
  layers: GISLayer[];
  argoProfiles?: ArgoProfile[];
  onSelectStation: (station: Station) => void;
  onSelectArgoProfile?: (profile: ArgoProfile) => void;
  onInspectPoint?: (lat: number, lon: number) => void;
  onAstronomicalUpdate?: (data: AstronomicalData) => void;
  targetLocation?: { lat: number; lon: number; height?: number } | null;
  timestamp?: string;
}

export const CesiumGlobe: React.FC<CesiumGlobeProps> = (props) => {
  return <CesiumViewerInner {...props} />;
};


