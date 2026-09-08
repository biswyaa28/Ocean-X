import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import { VARS, clamp, RAMP_DIV, css } from '../engine/fieldEngine.js';

/* OCEAN-X Analysis–Observation Residual chart.
   Terminology preserved: this is the residual between the
   assimilative analysis and the observation — never "model error".
   Figure config ported verbatim from the prototype's Charts module. */
export default function ResidualChart({ comp, variable, depth, rmax, active }) {
  const elRef = useRef(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !comp || !active || rmax == null) return;
    const cfg = VARS[variable], unit = cfg.unit;
    const yd = comp.obsDepths;
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

    const rcolors = comp.residuals.map(v => {
      const [r, g, b] = RAMP_DIV(clamp((v + rmax) / (2 * rmax), 0, 1));
      return css([r, g, b]);
    });

    Plotly.react(el, [{
      x: comp.residuals, y: yd, mode: 'lines+markers', name: 'Residual',
      line: { color: 'rgba(150,172,202,.45)', width: 1.1 },
      marker: { size: 4, color: rcolors },
      fill: 'tozerox', fillcolor: 'rgba(150,172,202,.07)',
      hovertemplate: '%{x:+.2f} ' + unit + ' · %{y} m<extra>Analysis − Obs</extra>'
    }], Object.assign({}, {
      margin: { l: 52, r: 18, t: 10, b: 36 },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: '"IBM Plex Mono", monospace', size: 9.5, color: '#7a879c' },
      hovermode: 'closest', dragmode: false,
      yaxis: Object.assign({
        title: { text: 'Depth (m)', font: titleFont },
        range: [1030, 0], dtick: 250, gridcolor: grid, zeroline: false, tickfont: tickFont
      }, spikes),
      hoverlabel
    }, {
      xaxis: Object.assign({
        title: { text: 'Residual (' + unit + ')', font: titleFont },
        range: [-rmax, rmax], gridcolor: grid,
        zeroline: true, zerolinecolor: 'rgba(200,212,228,.4)', zerolinewidth: 1.4,
        tickfont: tickFont
      }, spikes),
      showlegend: false,
      shapes: [{
        type: 'line', x0: -rmax, x1: rmax, y0: depth, y1: depth,
        line: { color: 'rgba(77,163,216,.45)', width: 1, dash: 'dot' }
      }]
    }), { displayModeBar: false, responsive: true });
  }, [comp, variable, rmax, active]);

  /* depth-line update without a full re-plot (as in the prototype) */
  useEffect(() => {
    if (!comp || !active || rmax == null) return;
    Plotly.relayout(elRef.current, {
      shapes: [{
        type: 'line', x0: -rmax, x1: rmax, y0: depth, y1: depth,
        line: { color: 'rgba(77,163,216,.45)', width: 1, dash: 'dot' }
      }]
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth]);

  return <div className="chart-plot" id="chart-residual" ref={elRef} hidden={!active || !comp} />;
}
