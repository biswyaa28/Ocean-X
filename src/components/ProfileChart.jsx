import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import { VARS, clamp } from '../engine/fieldEngine.js';
import { api } from '../data/mockModel.js';

/* OCEAN-X profile comparison chart.
   Observation line is visually dominant (seafoam); model matched
   time in amber; view-time model dashed in blue. Figure config
   ported verbatim from the prototype's Charts module. */
export default function ProfileChart({ comp, variable, timeIdx, depth, active }) {
  const elRef = useRef(null);
  const xrRef = useRef(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !comp || !active) return;
    const cfg = VARS[variable], unit = cfg.unit;
    const yd = comp.obsDepths;
    const viewVals = api.getModelProfileAt({
      lon: comp.profile.meta.lon, lat: comp.profile.meta.lat,
      timeIdx, depths: comp.obsDepths, variable
    });
    const all = comp.obsValues.concat(comp.modelValues, viewVals);
    const pad = variable === 'temperature' ? 1.5 : 0.4;
    const xr = [Math.floor(Math.min(...all) - pad), Math.ceil(Math.max(...all) + pad)];
    xrRef.current = xr;
    const frame = el.closest('.chart-frame');
    frame.classList.remove('swap'); void frame.offsetWidth; frame.classList.add('swap');

    const tickFont = { family: '"IBM Plex Mono", monospace', size: 9.5, color: '#7a879c' };
    const titleFont = { family: '"Inter", sans-serif', size: 11, color: '#7a879c' };
    const grid = 'rgba(150,172,202,.10)';
    const spikes = {
      showspikes: true, spikemode: 'across', spikethickness: 1,
      spikedash: 'dot', spikecolor: 'rgba(150,172,202,.35)'
    };
    const hoverlabel = {
      bgcolor: '#0d1626', bordercolor: '#2c3a50',
      font: { family: '"IBM Plex Mono"', size: 10.5, color: '#dce8f8' }
    };
    const common = {
      margin: { l: 52, r: 18, t: 10, b: 36 },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: '"IBM Plex Mono", monospace', size: 9.5, color: '#7a879c' },
      hovermode: 'closest', dragmode: false,
      yaxis: Object.assign({
        title: { text: 'Depth (m)', font: titleFont },
        range: [1030, 0], dtick: 250, gridcolor: grid, zeroline: false, tickfont: tickFont
      }, spikes),
      hoverlabel
    };

    Plotly.react(el, [
      {
        x: comp.obsValues, y: yd, mode: 'lines+markers', name: 'Argo observation',
        line: { color: '#7fd4c1', width: 2.2 }, marker: { size: 3.5, color: '#7fd4c1' },
        hovertemplate: '%{x:.2f} ' + unit + ' · %{y} m<extra>Observation</extra>'
      },
      {
        x: comp.modelValues, y: yd, mode: 'lines+markers', name: 'GLORYS12 · matched',
        line: { color: '#d9a45b', width: 1.6 }, marker: { size: 3, color: '#d9a45b' },
        hovertemplate: '%{x:.2f} ' + unit + ' · %{y} m<extra>Analysis (matched)</extra>'
      },
      {
        x: viewVals, y: yd, mode: 'lines', name: 'GLORYS12 · view time',
        line: { color: '#4da3d8', width: 1.1, dash: 'dash' },
        hovertemplate: '%{x:.2f} ' + unit + ' · %{y} m<extra>Analysis (view time)</extra>'
      }
    ], Object.assign({}, common, {
      xaxis: Object.assign({
        title: { text: cfg.label + ' (' + unit + ')', font: titleFont },
        range: xr, gridcolor: grid, zeroline: false, tickfont: tickFont
      }, spikes),
      legend: {
        x: 0.02, y: 0.99, yanchor: 'top', bgcolor: 'rgba(8,14,23,.6)',
        bordercolor: 'rgba(150,172,202,.18)', borderwidth: 1,
        font: { family: '"Inter", sans-serif', size: 10, color: '#a9b4c5' }
      },
      shapes: [{
        type: 'line', x0: xr[0], x1: xr[1], y0: depth, y1: depth,
        line: { color: 'rgba(77,163,216,.45)', width: 1, dash: 'dot' }
      }]
    }), { displayModeBar: false, responsive: true });
  }, [comp, variable, timeIdx, active]);

  /* depth-line update without a full re-plot (as in the prototype) */
  useEffect(() => {
    if (!comp || !active || !xrRef.current) return;
    Plotly.relayout(elRef.current, {
      shapes: [{
        type: 'line', x0: xrRef.current[0], x1: xrRef.current[1], y0: depth, y1: depth,
        line: { color: 'rgba(77,163,216,.45)', width: 1, dash: 'dot' }
      }]
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth]);

  return <div className="chart-plot" id="chart-profile" ref={elRef} hidden={!active || !comp} />;
}
