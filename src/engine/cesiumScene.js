/* ================================================================
   OCEAN-X — CesiumJS ocean scene engine.
   Ported from the frozen prototype's `Scene` + `Particles` modules,
   adapted to a factory that React's GlobeView component owns:
     - created once on mount, destroyed on unmount (no duplicate
       viewers)
     - reads live application state through a stateRef (never caches
       stale values)
     - communicates upward only through the `handlers` callbacks
   Layered stack + boundary cross-sections + observation markers.
   Selected depth plane stays dominant; other layers recede.
   ================================================================ */
import * as Cesium from 'cesium';
import { clamp, interpZ, VARS, FieldEngine } from './fieldEngine.js';
import { api } from '../data/mockModel.js';

const { bathy: FieldEngineBathy, noiseC: FieldEngineNoiseC } = FieldEngine;

export function createOceanScene({ container, creditContainer, stateRef, handlers }) {
  /* live view of application state — always current */
  const S = () => stateRef.current;

  let viewer = null;
  const DOM_W = 40, DOM_S = -30, DOM_E = 100, DOM_N = 30;
  const DOM_RECT = Cesium.Rectangle.fromDegrees(DOM_W, DOM_S, DOM_E, DOM_N);
  const layerEnt = []; let layerCanvases = [], slices = [], sliceKey = '', fieldRange = [0, 1];
  let boxEnts = [], cursorEnt = null, cursorLabel = null, bathyEnt = null;
  const argoEnt = {}; let hoverId = null, selected = null;
  let reticleEnt = null, selLabelEnt = null, profilePrim = null, profilePrimKey = '', matchEnts = [];
  let basemapWarned = false;
  const layerFades = [];
  let pickHandler = null;

  const depthH = z => -z * S().exaggeration;

  /* ---- camera ---- */
  const HOME = { lon: 54.3, lat: -11.5, alt: 2.95e6, heading: 58, pitch: -61 };
  function setHome(fly, duration) {
    const dest = Cesium.Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.alt);
    const ori = {
      heading: Cesium.Math.toRadians(HOME.heading),
      pitch: Cesium.Math.toRadians(HOME.pitch), roll: 0
    };
    if (fly) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(72, -16, 1.5e7),
        orientation: { heading: Cesium.Math.toRadians(14), pitch: Cesium.Math.toRadians(-88), roll: 0 }
      });
      viewer.camera.flyTo({
        destination: dest, orientation: ori, duration: duration || 3.4,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT
      });
    } else {
      viewer.camera.setView({ destination: dest, orientation: ori });
    }
  }
  function flyHome() { setHome(true, 1.8); }

  /* ---- contouring ---- */
  function drawContours(ctx, V, W, H, levels, style, stride, ox, oy) {
    ox = ox || 0; oy = oy || 0;
    if (!levels.length) return;
    ctx.strokeStyle = style; ctx.lineWidth = 1; ctx.beginPath();
    for (const lv of levels) {
      for (let y = 0; y < H - stride; y += stride) for (let x = 0; x < W - stride; x += stride) {
        const a = V[y * W + x], b = V[y * W + x + stride], c = V[(y + stride) * W + x + stride], d = V[(y + stride) * W + x];
        const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const t = (p, q) => clamp((lv - p) / ((q - p) || 1e-9), 0, 1);
        const T = [ox + x + t(a, b) * stride, oy + y],
          R = [ox + x + stride, oy + y + t(b, c) * stride],
          B = [ox + x + t(d, c) * stride, oy + y + stride],
          L = [ox + x, oy + y + t(a, d) * stride];
        const seg = (p, q) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
        switch (idx) {
          case 1: case 14: seg(L, B); break;
          case 2: case 13: seg(B, R); break;
          case 3: case 12: seg(L, R); break;
          case 4: case 11: seg(T, R); break;
          case 6: case 9: seg(T, B); break;
          case 7: case 8: seg(T, L); break;
          case 5: seg(L, B); seg(T, R); break;
          case 10: seg(T, B); seg(L, R); break;
        }
      }
    }
    ctx.stroke();
  }
  function sampleGrid(s, lon, lat) {
    const fx = (lon - s.lon0) / s.d, fy = (lat - s.lat0) / s.d;
    const x0 = clamp(Math.floor(fx), 0, s.nl - 2), y0 = clamp(Math.floor(fy), 0, s.nl - 2);
    const dx = clamp(fx - x0, 0, 1), dy = clamp(fy - y0, 0, 1);
    const v = s.values, N = s.nl;
    const a = v[y0 * N + x0], b = v[y0 * N + x0 + 1], c = v[(y0 + 1) * N + x0], d = v[(y0 + 1) * N + x0 + 1];
    return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
  }


  /* ---- horizontal depth slice (depth-darkened for falloff) ---- */
  function renderSliceCanvas(slice, z) {
    const W = 192, H = 192;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    const V = new Float32Array(W * H);
    const [mn, mx] = fieldRange, span = (mx - mn) || 1;
    const ramp = VARS[S().variable].ramp;
    const dark = 1 - 0.24 * clamp(z / 1000, 0, 1);
    for (let y = 0; y < H; y++) {
      const lat = DOM_N - (y + 0.5) * 60 / H;
      for (let x = 0; x < W; x++) {
        const lon = DOM_W + (x + 0.5) * 60 / W;
        const v = sampleGrid(slice, lon, lat);
        V[y * W + x] = v;
        const [r, g, b] = ramp(clamp((v - mn) / span, 0, 1));
        const i = (y * W + x) * 4;
        img.data[i] = r * dark; img.data[i + 1] = g * dark; img.data[i + 2] = b * dark; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    /* sparse graticule, quiet isopleths */
    ctx.strokeStyle = 'rgba(200,225,255,0.06)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let lon = 55; lon < 100; lon += 15) { const x = (lon - DOM_W) / 60 * W; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let lat = -15; lat <= 15; lat += 15) { const y = (DOM_N - lat) / 60 * H; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    const step = VARS[S().variable].contour;
    const levels = [];
    for (let v = Math.ceil(mn / step) * step; v <= mx; v += step) levels.push(+v.toFixed(4));
    drawContours(ctx, V, W, H, levels, 'rgba(235,245,255,0.12)', 2);
    ctx.strokeStyle = 'rgba(150,200,255,0.36)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    return c;
  }


  /* ---- boundary cross-section walls ---- */
  const AW = 1024, AH = 512, CW = 512, CH = 256;
  let wallsPrim = null, wallsKey = '', wallsTimer = null, wallsLastRun = 0;
  let atlasCanvas = null, atlasKey = '';
  function getWallAtlas() {
    const k = sliceKey + '|' + Math.round(S().opacity * 100);
    if (k !== atlasKey) { atlasCanvas = buildWallAtlas(); atlasKey = k; }
    return atlasCanvas;
  }
  function buildWallAtlas() {
    const c = document.createElement('canvas'); c.width = AW; c.height = AH;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(AW, AH);
    const depths = api.getModelDepths();
    const [mn, mx] = fieldRange, span = (mx - mn) || 1;
    const ramp = VARS[S().variable].ramp;
    const op = S().opacity;
    const setPx = (x, y, r, g, b, a) => {
      const i = (y * AW + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
    };
    const cells = [
      { cx: 0, cy: 0, mode: 'lon', fixed: -30 }, { cx: 1, cy: 0, mode: 'lon', fixed: 30 },
      { cx: 0, cy: 1, mode: 'lat', fixed: 40 }, { cx: 1, cy: 1, mode: 'lat', fixed: 100 }
    ];
    const VAll = {};
    const col = new Float64Array(depths.length);
    for (const cell of cells) {
      const x0 = cell.cx * CW + 3, x1 = (cell.cx + 1) * CW - 3;
      const y0 = cell.cy * CH + 2, y1 = (cell.cy + 1) * CH - 2;
      const nw = x1 - x0, nh = y1 - y0;
      const V = new Float32Array(nw * nh);
      for (let ix = 0; ix < nw; ix++) {
        const f = (ix + 0.5) / nw;
        const lon = cell.mode === 'lon' ? 40 + f * 60 : cell.fixed;
        const lat = cell.mode === 'lat' ? -30 + f * 60 : cell.fixed;
        for (let i = 0; i < depths.length; i++) col[i] = sampleGrid(slices[i], lon, lat);
        for (let iy = 0; iy < nh; iy++) {
          const z = (iy + 0.5) / nh * 1000;
          const v = interpZ(depths, col, z);
          V[iy * nw + ix] = v;
          const [r, g, b] = ramp(clamp((v - mn) / span, 0, 1));
          setPx(x0 + ix, y0 + iy, r, g, b, (0.8 - 0.45 * clamp(z / 1000, 0, 1)) * op * 255);
        }
      }
      VAll[cell.cx + '_' + cell.cy] = V;
    }
    ctx.putImageData(img, 0, 0);
    const step = VARS[S().variable].contour;
    const levels = [];
    for (let v = Math.ceil(mn / step) * step; v <= mx; v += step) levels.push(+v.toFixed(4));
    for (const cell of cells) {
      const x0 = cell.cx * CW + 3, x1 = (cell.cx + 1) * CW - 3;
      const y0 = cell.cy * CH + 2, y1 = (cell.cy + 1) * CH - 2;
      drawContours(ctx, VAll[cell.cx + '_' + cell.cy], x1 - x0, y1 - y0,
        levels, 'rgba(230,240,255,0.22)', 2, x0, y0);
    }
    return c;

  function buildWallPrimitive() {
    const depths = api.getModelDepths();
    const Dsel = depths[S().depthIdx];
    const hBot = -Dsel * S().exaggeration;
    if (hBot >= -1) return null;
    const edges = [
      { cell: 0, mode: 'lon', fixed: -30, rev: false },
      { cell: 1, mode: 'lon', fixed: 30, rev: true },
      { cell: 2, mode: 'lat', fixed: 40, rev: true },
      { cell: 3, mode: 'lat', fixed: 100, rev: false }
    ];
    const N = 21;
    const positions = [], sts = [], indices = [];
    const useFlat = !!Cesium.VertexFormat.POSITION_AND_ST;
    const vf = useFlat ? Cesium.VertexFormat.POSITION_AND_ST : Cesium.VertexFormat.DEFAULT;
    const normals = useFlat ? null : [];
    for (const e of edges) {
      const start = positions.length / 3;
      const cx = e.cell % 2, cy = (e.cell / 2) | 0;
      const x0 = cx * CW + 3, x1 = (cx + 1) * CW - 3, y0 = cy * CH + 2;
      const nw = x1 - x0, nh = CH - 4;
      const u0 = x0 / AW, u1 = x1 / AW;
      const vTop = 1 - y0 / AH;
      const vBot = 1 - (y0 + nh * (Dsel / 1000)) / AH;
      let nrm = null;
      if (normals) {
        const midLon = e.mode === 'lon' ? (DOM_W + DOM_E) / 2 : e.fixed;
        const midLat = e.mode === 'lat' ? (DOM_S + DOM_N) / 2 : e.fixed;
        const m = Cesium.Transforms.eastNorthUpToFixedFrame(
          Cesium.Cartesian3.fromDegrees(midLon, midLat, 0));
        const east = Cesium.Matrix4.getColumn(m, 0, new Cesium.Cartesian3());
        const north = Cesium.Matrix4.getColumn(m, 1, new Cesium.Cartesian3());
        nrm = (e.mode === 'lon')
          ? (e.fixed < 0 ? Cesium.Cartesian3.negate(north, new Cesium.Cartesian3()) : north)
          : (e.fixed < 70 ? Cesium.Cartesian3.negate(east, new Cesium.Cartesian3()) : east);
      }
      for (let i = 0; i <= N; i++) {
        const f = i / N;
        const lon = e.mode === 'lon' ? DOM_W + f * (DOM_E - DOM_W) : e.fixed;
        const lat = e.mode === 'lat' ? DOM_S + f * (DOM_N - DOM_S) : e.fixed;
        const pT = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        const pB = Cesium.Cartesian3.fromDegrees(lon, lat, hBot);
        positions.push(pT.x, pT.y, pT.z, pB.x, pB.y, pB.z);
        const u = u0 + (u1 - u0) * f;
        sts.push(u, vTop, u, vBot);
        if (normals) normals.push(nrm.x, nrm.y, nrm.z, nrm.x, nrm.y, nrm.z);
      }
      for (let i = 0; i < N; i++) {
        const a = start + i * 2, b = a + 1, c2 = a + 2, d = a + 3;
        if (e.rev) indices.push(a, c2, b, c2, d, b);
        else indices.push(a, b, c2, a, c2, d);
      }
    }
    const attributes = {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3, values: new Float64Array(positions)
      }),
      st: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 2, values: new Float32Array(sts)
      })
    };
    if (normals) {
      attributes.normal = new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3, values: new Float32Array(normals)
      });
    }
    const geometry = new Cesium.Geometry({
      attributes, indices: new Uint16Array(indices),
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
    });
    const material = Cesium.Material.fromType('Image', { image: getWallAtlas() });
    return new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: new Cesium.MaterialAppearance({
        flat: useFlat, translucent: true, closed: false, material, vertexFormat: vf
      }),
      asynchronous: false, allowPicking: false
    });
  }
  function rebuildWalls() {
    if (!slices.length) return; /* no slices yet (early geometry update) */
    const want = S().showField;
    const key = want
      ? sliceKey + '|' + S().depthIdx + '|' + S().exaggeration + '|' + Math.round(S().opacity * 100)
      : 'off';
    if (key === wallsKey) return;
    wallsKey = key;
    if (wallsPrim) { viewer.scene.primitives.remove(wallsPrim); wallsPrim = null; }
    if (!want) return;
    const p = buildWallPrimitive();
    if (p) wallsPrim = viewer.scene.primitives.add(p);
  }
  function scheduleWalls() {
    const now = performance.now();
    if (now - wallsLastRun > 70) { wallsLastRun = now; rebuildWalls(); return; }
    if (wallsTimer) return;
    wallsTimer = setTimeout(() => { wallsTimer = null; wallsLastRun = performance.now(); rebuildWalls(); }, 70);
  }


  /* ---- bathymetry (subtle, supportive) ---- */
  function buildBathyCanvas() {
    const W = 384, H = 384;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    const V = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const lat = DOM_N - (y + 0.5) * 60 / H;
      for (let x = 0; x < W; x++) {
        const lon = DOM_W + (x + 0.5) * 60 / W;
        const d = FieldEngineBathy(lon, lat);
        V[y * W + x] = d;
        const t = clamp((d - 1500) / 4500, 0, 1);
        const i = (y * W + x) * 4;
        img.data[i] = 20 + (5 - 20) * t; img.data[i + 1] = 60 + (10 - 60) * t; img.data[i + 2] = 84 + (18 - 84) * t; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    drawContours(ctx, V, W, H, [3000, 5000], 'rgba(110,160,185,0.20)', 4);
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(150,195,215,0.42)';
    const put = (txt, lon, lat) => ctx.fillText(txt, (lon - DOM_W) / 60 * W, (DOM_N - lat) / 60 * H);
    put('CARLSBERG RIDGE', 60.5, -5);
    put('CENTRAL INDIAN RIDGE', 69, -21.5);
    put('JAVA TRENCH', 92.5, -10.5);
    put('SOMALI BASIN', 47, 3.5);
    put('CENTRAL INDIAN BASIN', 74, -6);
    ctx.strokeStyle = 'rgba(150,200,255,0.2)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    return c;
  }

  /* ---- observation markers (calm, scientific) ---- */
  const _sprites = {};
  function argoSprite(mode) {
    if (_sprites[mode]) return _sprites[mode];
    const c = document.createElement('canvas'); c.width = c.height = 40;
    const ctx = c.getContext('2d');
    const col = mode === 'D' ? '127,212,193' : '217,164,91';
    const g = ctx.createRadialGradient(20, 20, 2, 20, 20, 14);
    g.addColorStop(0, 'rgba(' + col + ',0.28)');
    g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(20, 20, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(' + col + ',0.95)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(20, 20, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(' + col + ',1)';
    ctx.beginPath(); ctx.arc(20, 20, 2.1, 0, Math.PI * 2); ctx.fill();
    _sprites[mode] = c; return c;
  }

  /* ---- entity builders ---- */
  function ensureLayer(i) {
    if (layerEnt[i]) return layerEnt[i];
    layerEnt[i] = viewer.entities.add({
      id: 'field-layer-' + i, show: false,
      rectangle: {
        coordinates: DOM_RECT, height: -5,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT)
      }
    });
    layerEnt[i]._alpha = 0; layerEnt[i]._wasShown = false;
    return layerEnt[i];
  }
  function buildBathy() {
    bathyEnt = viewer.entities.add({
      id: 'bathy-plate', show: false,
      rectangle: {
        coordinates: DOM_RECT, height: depthH(4200),
        material: new Cesium.ImageMaterialProperty({
          image: buildBathyCanvas(), transparent: true,
          color: Cesium.Color.WHITE.withAlpha(0.82)
        })
      }
    });
  }
  function buildArgo() {
    api.getArgoProfiles().forEach(m => {
      const modeCol = m.mode === 'D'
        ? Cesium.Color.fromCssColorString('#7fd4c1')
        : Cesium.Color.fromCssColorString('#d9a45b');
      argoEnt[m.id] = viewer.entities.add({
        id: 'argo-' + m.id,
        position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 0),
        billboard: {
          image: argoSprite(m.mode), scale: 1,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 1e7
        },
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 0),
            Cesium.Cartesian3.fromDegrees(m.lon, m.lat, depthH(1000))],
          material: modeCol.withAlpha(0.16), width: 1
        }
      });
      const ent = argoEnt[m.id];
      ent._s = 1; ent._sTarget = 1;
    });
  }
  function buildBox() {
    const c = [[DOM_W, DOM_S], [DOM_E, DOM_S], [DOM_E, DOM_N], [DOM_W, DOM_N]];
    boxEnts = [];
    for (let k = 0; k < 4; k++) {
      const [lon, lat] = c[k];
      boxEnts.push(viewer.entities.add({
        show: false,
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(lon, lat, 0),
            Cesium.Cartesian3.fromDegrees(lon, lat, 0)],
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#4da3d8').withAlpha(0.38), dashLength: 14
          }),
          width: 1
        }
      }));
    }
    cursorEnt = viewer.entities.add({
      show: false,
      polyline: {
        positions: [],
        material: Cesium.Color.fromCssColorString('#7fc4e8').withAlpha(0.9), width: 2
      }
    });
    cursorLabel = viewer.entities.add({
      show: false,
      position: Cesium.Cartesian3.fromDegrees(DOM_W, 0, 0),
      label: {
        text: '', font: '12px "IBM Plex Mono"',
        fillColor: Cesium.Color.fromCssColorString('#9fcfe8'),
        showBackground: true,
        backgroundColor: new Cesium.Color(0.02, 0.05, 0.1, 0.75),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        pixelOffset: new Cesium.Cartesian2(-10, 0),
        horizontalOrigin: Cesium.HorizontalOrigin.RIGHT,
        disableDepthTestDistance: 1e7
      }
    });
  }

  let _reticle = null;
  function reticleSprite() {
    if (_reticle) return _reticle;
    const c = document.createElement('canvas'); c.width = c.height = 84;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(127,212,193,0.9)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(42, 42, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(127,212,193,0.28)';
    ctx.beginPath(); ctx.arc(42, 42, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(127,212,193,0.9)';
    [[42, 8, 42, 18], [42, 66, 42, 76], [8, 42, 18, 42], [66, 42, 76, 42]]
      .forEach(([a, b, x, y]) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(x, y); ctx.stroke(); });
    _reticle = c; return c;
  }


  /* ---- geometry updates ---- */
  function updateFieldGeometry() {
    const depths = api.getModelDepths();
    const z = depths[S().depthIdx], h1 = depthH(z);
    const c = [[DOM_W, DOM_S], [DOM_E, DOM_S], [DOM_E, DOM_N], [DOM_W, DOM_N]];
    const showB = S().showBounds;
    for (let i = 0; i < 4; i++) {
      const [lon, lat] = c[i];
      boxEnts[i].show = showB;
      boxEnts[i].polyline.positions = [
        Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        Cesium.Cartesian3.fromDegrees(lon, lat, h1)];
    }
    const ring = c.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, h1));
    ring.push(ring[0]);
    cursorEnt.show = showB;
    cursorEnt.polyline.positions = ring;
    cursorLabel.show = showB;
    cursorLabel.position = Cesium.Cartesian3.fromDegrees(DOM_W, 0, h1);
    cursorLabel.label.text = '−' + z + ' m';
    for (let i = 0; i < 13; i++) ensureLayer(i).rectangle.height = i === 0 ? -3 : depthH(depths[i]);
    bathyEnt.rectangle.height = depthH(4200);
    api.getArgoProfiles().forEach(m => {
      if (argoEnt[m.id]) argoEnt[m.id].polyline.positions = [
        Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 0),
        Cesium.Cartesian3.fromDegrees(m.lon, m.lat, depthH(1000))];
    });
    rebuildProfileLine();
    scheduleWalls();
  }

  /* ---- layer materials: dominant active plane, receding others ---- */
  function dropFade(ent) {
    for (let j = layerFades.length - 1; j >= 0; j--) if (layerFades[j].ent === ent) layerFades.splice(j, 1);
  }
  function setAlpha(ent, a) {
    ent._alpha = a;
    if (ent._mat) ent._mat.color = Cesium.Color.WHITE.withAlpha(a);
  }
  function layerAlpha(i, k) {
    if (i === k) return 0.95;
    if (i === 0) return 0.30;
    return Math.max(0.14, 0.34 - 0.17 * ((k - i) / Math.max(1, k)));
  }
  function refreshField() {
    const depths = api.getModelDepths();
    const key = S().variable + ':' + S().timeIdx;
    if (sliceKey !== key) {
      slices = depths.map((z, i) => api.getModelSlice(i, S().timeIdx, S().variable));
      let mn = Infinity, mx = -Infinity;
      slices.forEach(s => { mn = Math.min(mn, s.min); mx = Math.max(mx, s.max); });
      const cfg = VARS[S().variable];
      fieldRange = [Math.floor(mn / cfg.gridStep) * cfg.gridStep, Math.ceil(mx / cfg.gridStep) * cfg.gridStep];
      layerCanvases = slices.map((s, i) => renderSliceCanvas(s, depths[i]));
      sliceKey = key;
    }
    const k = S().depthIdx, now = performance.now();
    for (let i = 0; i < 13; i++) {
      const ent = ensureLayer(i);
      const on = S().showField && i <= k;
      const was = ent._wasShown;
      ent.show = on; ent._wasShown = on;
      if (!on) { dropFade(ent); continue; }
      const alpha = layerAlpha(i, k) * S().opacity;
      const newCanvas = ent._matImage !== layerCanvases[i];
      if (newCanvas) {
        dropFade(ent);
        ent._mat = new Cesium.ImageMaterialProperty({
          image: layerCanvases[i], transparent: true,
          color: Cesium.Color.WHITE.withAlpha(alpha)
        });
        ent.rectangle.material = ent._mat; ent._matImage = layerCanvases[i];
        ent._alpha = alpha;
      } else if (on && !was) {
        dropFade(ent);
        setAlpha(ent, 0.02);
        layerFades.push({ ent, from: 0.02, to: alpha, t0: now });
      } else if (Math.abs((ent._alpha == null ? alpha : ent._alpha) - alpha) > 0.003) {
        dropFade(ent);
        setAlpha(ent, alpha);
      }
      ent.rectangle.height = i === 0 ? -3 : depthH(depths[i]);
    }
    bathyEnt.show = S().showBathy;
    updateFieldGeometry();
    handlers.onLegendUpdate(fieldRange);
    scheduleWalls();
  }


  /* ---- selection visuals ---- */
  function removeProfile() {
    if (profilePrim) { viewer.scene.primitives.remove(profilePrim); profilePrim = null; }
    profilePrimKey = '';
  }
  function rebuildProfileLine() {
    if (!S().selectedId) { removeProfile(); return; }
    const key = S().selectedId + '|' + S().exaggeration + '|' + sliceKey;
    if (key === profilePrimKey) return;
    profilePrimKey = key;
    removeProfile();
    const prof = api.getArgoProfile(S().selectedId);
    const lv = prof.levels.filter(l => l.depth <= 1000);
    const m = prof.meta;
    const positions = lv.map(l => Cesium.Cartesian3.fromDegrees(m.lon, m.lat, depthH(l.depth)));
    const [mn, mx] = fieldRange, span = (mx - mn) || 1;
    const ramp = VARS[S().variable].ramp;
    const colors = lv.map(l => {
      const [r, g, b] = ramp(clamp((l[S().variable] - mn) / span, 0, 1));
      return new Cesium.Color(r / 255, g / 255, b / 255, 1);
    });
    profilePrim = viewer.scene.primitives.add(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
          positions, width: 5,
          vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT, colors
        })
      }),
      appearance: new Cesium.PolylineColorAppearance(),
      asynchronous: false
    }));
  }
  function clearMatchOverlay() {
    matchEnts.forEach(e => viewer.entities.remove(e));
    matchEnts = [];
  }
  function buildMatchOverlay() {
    clearMatchOverlay();
    const comp = handlers.getComp(); if (!comp) return;
    const { lon: glon, lat: glat } = comp.match;
    const m = comp.profile.meta;
    const half = 0.25, hAnn = 6000;
    const corners = [[glon - half, glat - half], [glon + half, glat - half],
    [glon + half, glat + half], [glon - half, glat + half]];
    const pos = corners.map(([lo, la]) => Cesium.Cartesian3.fromDegrees(lo, la, hAnn));
    pos.push(pos[0]);
    matchEnts.push(viewer.entities.add({
      polyline: {
        positions: pos,
        material: Cesium.Color.fromCssColorString('#d9a45b').withAlpha(0.85), width: 1.6
      }
    }));
    matchEnts.push(viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(m.lon, m.lat, hAnn),
          Cesium.Cartesian3.fromDegrees(glon, glat, hAnn)],
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#d9a45b').withAlpha(0.5), dashLength: 10
        }),
        width: 1.2
      }
    }));
    matchEnts.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(glon, glat, hAnn),
      label: {
        text: 'GLORYS12 cell ' + comp.match.i + ',' + comp.match.j,
        font: '10px "IBM Plex Mono"',
        fillColor: Cesium.Color.fromCssColorString('#e8c98f'),
        showBackground: true,
        backgroundColor: new Cesium.Color(0.05, 0.04, 0.01, 0.75),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        pixelOffset: new Cesium.Cartesian2(0, 16),
        disableDepthTestDistance: 1e7
      }
    }));
  }
  function deselectVisuals() {
    if (selected) {
      const ent = argoEnt[selected];
      if (ent) { ent._sTarget = 1; }
    }
    if (reticleEnt) { viewer.entities.remove(reticleEnt); reticleEnt = null; }
    if (selLabelEnt) { viewer.entities.remove(selLabelEnt); selLabelEnt = null; }
    clearMatchOverlay();
    removeProfile();
    selected = null;
  }
  /* deliberate camera move — enough zoom to focus, context preserved */
  function focusOn(lon, lat) {
    const cam = viewer.camera;
    const carto = cam.positionCartographic;
    const alt = clamp(carto.height * 0.6, 9e5, 3.2e6);
    cam.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat - 3, alt),
      orientation: {
        heading: cam.heading,
        pitch: Math.min(cam.pitch, Cesium.Math.toRadians(-40)), roll: 0
      },
      duration: 1.4,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT
    });
  }
  function select(id) {
    deselectVisuals();
    const m = api.getArgoProfiles().find(p => p.id === id);
    if (!m || !argoEnt[id]) return;
    selected = id;
    const ent = argoEnt[id];
    ent._sTarget = 1.4;
    reticleEnt = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 0),
      billboard: {
        image: reticleSprite(), scale: 1, verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: 1e7
      }
    });
    selLabelEnt = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 0),
      label: {
        text: m.id + ' · cycle ' + m.cycle,
        font: '12px "IBM Plex Mono"',
        fillColor: Cesium.Color.fromCssColorString('#eaf6f2'),
        showBackground: true,
        backgroundColor: new Cesium.Color(0.03, 0.06, 0.11, 0.85),
        backgroundPadding: new Cesium.Cartesian2(7, 5),
        pixelOffset: new Cesium.Cartesian2(0, -32),
        disableDepthTestDistance: 1e7
      }
    });
    rebuildProfileLine();
    buildMatchOverlay();
    focusOn(m.lon, m.lat);
  }
  function setHover(id) {
    hoverId = id;
    for (const k in argoEnt) {
      const ent = argoEnt[k];
      ent._sTarget = (k === id) ? 1.3 : (k === selected) ? 1.4 : 1;
    }
  }


  /* ================================================================
     Particles — mock surface currents (off by default, subordinate)
     ================================================================ */
  const Particles = (() => {
    let refs = [], list = [], last = performance.now(), on = false;
    const NP = 220, SPEED = 0.14;
    const psi = (lon, lat) => {
      let p = -2.4 * Math.atan(lat / 2.2);
      p += 2.5 * Math.atan((lat + 10) / 3.6);
      p += -1.7 * Math.atan((lat - 13) / 3.2);
      p += 0.8 * Math.sin((lon - 40) / 60 * 2 * Math.PI) * Math.sin((lat + 30) / 60 * Math.PI);
      p += 1.5 * (FieldEngineNoiseC(lon / 5, lat / 5) - 0.5);
      return p;
    };
    const vel = (lon, lat) => {
      const d = 0.3;
      return [-(psi(lon, lat + d) - psi(lon, lat - d)) / (2 * d),
      (psi(lon + d, lat) - psi(lon - d, lat)) / (2 * d)];
    };
    const spawn = () => ({ lon: 40 + Math.random() * 60, lat: -30 + Math.random() * 60, life: 12 + Math.random() * 60 });
    function init(v) {
      const pts = v.scene.primitives.add(new Cesium.PointPrimitiveCollection());
      for (let i = 0; i < NP; i++) {
        list.push(spawn());
        refs.push(pts.add({
          position: Cesium.Cartesian3.fromDegrees(list[i].lon, list[i].lat, 250),
          pixelSize: 2,
          color: Cesium.Color.fromCssColorString('rgba(150,205,230,0.5)'),
          scaleByDistance: new Cesium.NearFarScalar(4e5, 1.6, 1.5e7, 0.4),
          show: on
        }));
      }
    }
    function tick(now) {
      const dt = Math.min(0.12, (now - last) / 1000); last = now;
      for (let i = 0; i < NP; i++) {
        let p = list[i];
        const [u, v] = vel(p.lon, p.lat);
        p.lon += u * SPEED * dt; p.lat += v * SPEED * dt; p.life -= dt;
        if (p.life <= 0 || p.lon < 40.5 || p.lon > 99.5 || p.lat < -29.5 || p.lat > 29.5) { p = spawn(); list[i] = p; }
        refs[i].position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 250);
      }
    }
    function setShow(v) { on = v; last = performance.now(); refs.forEach(r => r.show = v); }
    return { init, tick, setShow };
  })();

  /* ---- picking, hover, probe ---- */
  function setupPicking() {
    pickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    pickHandler.setInputAction(evt => {
      const picked = viewer.scene.pick(evt.position);
      const ent = picked && picked.id;
      if (ent && typeof ent.id === 'string' && ent.id.indexOf('argo-') === 0) {
        handlers.onSelectArgo(ent.id.slice(5));
        return;
      }
      const carto = viewer.camera.pickEllipsoid(evt.position, viewer.scene.globe.ellipsoid);
      if (carto) {
        const cc = Cesium.Cartographic.fromCartesian(carto);
        const lon = Cesium.Math.toDegrees(cc.longitude), lat = Cesium.Math.toDegrees(cc.latitude);
        if (lon >= DOM_W && lon <= DOM_E && lat >= DOM_S && lat <= DOM_N && slices.length) {
          handlers.onProbe(lon, lat, sampleGrid(slices[S().depthIdx], lon, lat));
        }
      }
      if (S().selectedId) handlers.onBackgroundClick();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    pickHandler.setInputAction(evt => {
      const picked = viewer.scene.pick(evt.endPosition);
      const ent = picked && picked.id;
      const isArgo = ent && typeof ent.id === 'string' && ent.id.indexOf('argo-') === 0;
      const id = isArgo ? ent.id.slice(5) : null;
      viewer.canvas.style.cursor = isArgo ? 'pointer' : 'default';
      if (id !== hoverId) { setHover(id); handlers.onHoverArgo(id, evt.endPosition); }
      else if (id) { handlers.onMoveArgoTip(evt.endPosition); }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    /* hover + tooltip clear when the pointer moves onto UI panels */
    const onDocMouseMove = e => {
      if (e.target !== viewer.canvas && hoverId !== null) {
        setHover(null);
        handlers.onHoverArgo(null);
      }
    };
    document.addEventListener('mousemove', onDocMouseMove);
    pickHandler._docMouseMove = onDocMouseMove;
  }


  /* ---- per-frame: hover tween, layer fades, particles ---- */
  function processLayerFades(now) {
    for (let i = layerFades.length - 1; i >= 0; i--) {
      const f = layerFades[i];
      const k = Math.min(1, (now - f.t0) / 320);
      const e = 1 - Math.pow(1 - k, 3);
      setAlpha(f.ent, f.from + (f.to - f.from) * e);
      if (k >= 1) layerFades.splice(i, 1);
    }
  }
  function onFrame() {
    const now = performance.now();
    for (const id in argoEnt) {
      const ent = argoEnt[id];
      if (Math.abs(ent._s - ent._sTarget) > 0.004) {
        ent._s += (ent._sTarget - ent._s) * 0.2;
        ent.billboard.scale = ent._s;
      }
    }
    processLayerFades(now);
    if (S().showCurrents) Particles.tick(now);
  }

  /* ---- init ---- */
  function init() {
    const imagery = new Cesium.UrlTemplateImageryProvider({
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      subdomains: ['a', 'b', 'c', 'd'],
      credit: new Cesium.Credit('© OpenStreetMap contributors · © CARTO', true),
      maximumLevel: 18
    });
    viewer = new Cesium.Viewer(container, {
      baseLayer: new Cesium.ImageryLayer(imagery),
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      fullscreenButton: false, selectionIndicator: false, infoBox: false,
      creditContainer
    });
    const scene = viewer.scene, globe = scene.globe;
    globe.baseColor = Cesium.Color.fromCssColorString('#071018');
    globe.enableLighting = false;
    globe.showGroundAtmosphere = false;
    globe.depthTestAgainstTerrain = false;
    const tr = globe.translucency;
    tr.enabled = true; tr.frontFaceAlpha = 0.48;
    try { tr.backFaceAlpha = 0.05; } catch (e) { }
    scene.skyAtmosphere.show = true;
    try {
      scene.skyAtmosphere.hueShift = 0.03;
      scene.skyAtmosphere.brightnessShift = -0.12;
      scene.skyAtmosphere.saturationShift = 0.12;
    } catch (e) { }
    scene.fog.enabled = true;
    try { scene.fog.density = 2.2e-4; } catch (e) { }
    try { scene.sun.show = false; } catch (e) { }
    try { scene.moon.show = false; } catch (e) { }
    try { scene.msaaSamples = 4; } catch (e) { }
    try { scene.postProcessStages.fxaa.enabled = true; } catch (e) { }
    try {
      const base = viewer.imageryLayers.get(0);
      base.brightness = 0.92; base.saturation = 0.72; base.gamma = 1.05;
    } catch (e) { }
    scene.screenSpaceCameraController.minimumZoomDistance = 8e4;
    scene.screenSpaceCameraController.maximumZoomDistance = 4.2e7;
    setHome(true, 3.4);
    buildBathy(); buildArgo(); buildBox();
    Particles.init(viewer);
    scene.preRender.addEventListener(onFrame);
    setupPicking();
    imagery.errorEvent.addEventListener(() => {
      if (!basemapWarned) {
        basemapWarned = true;
        handlers.onToast('Basemap tiles unavailable — continuing with a solid globe.');
      }
    });
    /* first interaction fades the camera hint and enters the instrument */
    const interact = () => handlers.onCamInteract();
    viewer.canvas.addEventListener('pointerdown', interact);
    viewer.canvas.addEventListener('wheel', interact, { passive: true });
  }

  function setArgoVisible(on) {
    Object.values(argoEnt).forEach(e => e.show = on);
    if (reticleEnt) reticleEnt.show = on;
    if (selLabelEnt) selLabelEnt.show = on;
    if (profilePrim) profilePrim.show = on;
    matchEnts.forEach(e => e.show = on);
  }

  /* ---- teardown (React unmount) ---- */
  function destroy() {
    if (pickHandler) {
      if (pickHandler._docMouseMove) document.removeEventListener('mousemove', pickHandler._docMouseMove);
      pickHandler.destroy();
      pickHandler = null;
    }
    if (wallsTimer) { clearTimeout(wallsTimer); wallsTimer = null; }
    if (viewer) {
      viewer.destroy();
      viewer = null;
    }
  }

  return {
    init, refreshField, flyHome,
    select, deselect: deselectVisuals,
    setArgoVisible, setParticles: on => Particles.setShow(on),
    updateGeometry: updateFieldGeometry,
    destroy
  };
}

  }
