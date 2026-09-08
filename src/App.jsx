import { useCallback, useEffect, useRef, useState } from 'react';
import { FieldEngine, clamp } from './engine/fieldEngine.js';
import { api } from './data/mockModel.js';
import { fmtUTC } from './engine/format.js';
import { INITIAL_STATE, exagFromSlider, DEFAULT_VSCALE } from './state/appState.js';
import Header from './components/Header.jsx';
import ExplorerControls from './components/ExplorerControls.jsx';
import GlobeView from './components/GlobeView.jsx';
import SceneOverlays from './components/SceneOverlays.jsx';
import ObservationInspector from './components/ObservationInspector.jsx';
import ComparisonTray from './components/ComparisonTray.jsx';
import OnboardingOverlay from './components/OnboardingOverlay.jsx';

/* ================================================================
   OCEAN-X — App orchestration.
   The React state below is the single source of truth (mirroring
   the prototype's `state` + App setters). The Cesium scene reads
   live state through stateRef and writes back through the same
   setters, so state and visuals can never disagree.
   ================================================================ */

let toastSeq = 0;

export default function App() {
  const [state, setState] = useState(INITIAL_STATE);
  const [comp, setComp] = useState(null);

  /* sequenced selection workflow gates (as in the prototype):
     inspector (~150ms), tray + charts (~430ms), metrics (~580ms) */
  const [inspectorOn, setInspectorOn] = useState(true);
  const [chartsOn, setChartsOn] = useState(false);
  const [metricsOn, setMetricsOn] = useState(false);

  const [introOn, setIntroOn] = useState(true);
  const [depthAttract, setDepthAttract] = useState(false);
  const [railClosed, setRailClosed] = useState(() => window.innerWidth < 1240);
  const [infoOpen, setInfoOpen] = useState(false);
  const [probe, setProbe] = useState(null);
  const [legendRange, setLegendRange] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [hoverTip, setHoverTip] = useState(null);
  const [camHintFaded, setCamHintFaded] = useState(false);

  /* live refs for the imperative scene engine */
  const stateRef = useRef(state);
  stateRef.current = state;
  const compRef = useRef(comp);
  compRef.current = comp;
  const sceneRef = useRef(null);
  const depthTouchedRef = useRef(false);
  const introDoneRef = useRef(false);

  /* ---------------- toasts ---------------- */
  const pushToast = useCallback(msg => {
    const id = ++toastSeq;
    setToasts(t => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3750);
  }, []);

  /* ---------------- onboarding ---------------- */
  const dismissIntro = useCallback(() => {
    if (introDoneRef.current) return;
    introDoneRef.current = true;
    setIntroOn(false);
    /* one quiet first-time cue on the signature control */
    setTimeout(() => {
      if (!depthTouchedRef.current) {
        setDepthAttract(true);
        setTimeout(() => setDepthAttract(false), 2000);
      }
    }, 900);
  }, []);

  /* ---------------- body state classes (CSS contract) ---------------- */
  useEffect(() => {
    const b = document.body;
    b.classList.toggle('intro-on', introOn);
    b.classList.toggle('rail-closed', railClosed);
    b.classList.toggle('tray-open', state.trayOpen);
  }, [introOn, railClosed, state.trayOpen]);

  /* ---------------- scene synchronization ---------------- */
  useEffect(() => { sceneRef.current && sceneRef.current.refreshField(); },
    [state.depthIdx, state.timeIdx, state.variable, state.showField, state.showBathy, state.opacity]);
  useEffect(() => { sceneRef.current && sceneRef.current.updateGeometry(); },
    [state.exaggeration, state.showBounds]);
  useEffect(() => { sceneRef.current && sceneRef.current.setArgoVisible(state.showArgo); },
    [state.showArgo]);
  useEffect(() => { sceneRef.current && sceneRef.current.setParticles(state.showCurrents); },
    [state.showCurrents]);
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    if (state.selectedId) sc.select(state.selectedId);
    else sc.deselect();
  }, [state.selectedId]);

  /* ---------------- application setters ---------------- */
  const setDepth = useCallback((i, src) => {
    setState(s => ({ ...s, depthIdx: i, depth: FieldEngine.DEPTHS[i] }));
    setProbe(null);
    depthTouchedRef.current = true;
    dismissIntro();
  }, [dismissIntro]);

  const setTime = useCallback((i, src) => {
    /* view time only — the matched model time never moves here */
    setState(s => ({ ...s, timeIdx: i, time: FieldEngine.TIMES[i] }));
    setProbe(null);
    dismissIntro();
  }, [dismissIntro]);

  const setVariable = useCallback(v => {
    setState(s => ({ ...s, variable: v }));
    setProbe(null);
    if (v === 'salinity') pushToast('Salinity is a Phase 2 extension — mock field shown.');
    const sid = stateRef.current.selectedId;
    setComp(sid ? api.getComparison(sid, v) : null);
    dismissIntro();
  }, [dismissIntro, pushToast]);

  const setExaggeration = useCallback(v => {
    setState(s => ({
      ...s,
      vscaleSlider: v,
      exaggeration: Math.max(1, Math.round(exagFromSlider(v)))
    }));
  }, []);

  const setOpacity = useCallback(v => {
    setState(s => ({ ...s, opacity: clamp(v, 0, 1) }));
  }, []);

  const setToggle = useCallback((key, on) => {
    setState(s => ({ ...s, [key]: on }));
  }, []);


  /* ---------------- selection: deliberate, sequenced (~900 ms) ---------------- */
  const select = useCallback(id => {
    setState(s => ({ ...s, selectedId: id }));
    setHoverTip(null);
    const c = api.getComparison(id, stateRef.current.variable);
    setComp(c);
    setInspectorOn(false);
    setChartsOn(false);
    setMetricsOn(false);
    /* 2 — inspector state change */
    setTimeout(() => { if (stateRef.current.selectedId === id) setInspectorOn(true); }, 150);
    /* 3 — tray begins opening, figure animates in with it */
    setTimeout(() => {
      if (stateRef.current.selectedId !== id) return;
      setChartsOn(true);
      setState(s => ({ ...s, trayOpen: true }));
    }, 430);
    /* 4 — metrics interpolate into place */
    setTimeout(() => { if (stateRef.current.selectedId === id) setMetricsOn(true); }, 580);
    dismissIntro();
  }, [dismissIntro]);

  const deselect = useCallback(() => {
    if (!stateRef.current.selectedId) return;
    setState(s => ({ ...s, selectedId: null, provenanceOpen: false, trayOpen: false }));
    setComp(null);
    setInspectorOn(true);
    setChartsOn(false);
    setMetricsOn(false);
  }, []);

  const toggleProvenance = useCallback(() => {
    setState(s => ({ ...s, provenanceOpen: !s.provenanceOpen }));
  }, []);

  const setTray = useCallback(open => {
    setState(s => ({ ...s, trayOpen: open }));
  }, []);

  /* ---------------- reset ---------------- */
  const resetView = useCallback(() => {
    setState({ ...INITIAL_STATE, exaggeration: exagFromSlider(DEFAULT_VSCALE) });
    setComp(null);
    setInspectorOn(true);
    setChartsOn(false);
    setMetricsOn(false);
    setProbe(null);
    setInfoOpen(false);
    const sc = sceneRef.current;
    if (sc) {
      sc.deselect();
      sc.setArgoVisible(true);
      sc.setParticles(false);
      sc.refreshField();
      sc.flyHome();
    }
    pushToast('View reset to the default state.');
  }, [pushToast]);

  const resetCamera = useCallback(() => {
    if (sceneRef.current) sceneRef.current.flyHome();
    pushToast('Camera reset to the Indian Ocean overview.');
  }, [pushToast]);


  /* ---------------- stable scene callback surface ---------------- */
  /* The scene factory captures this object once; the callbacks are
     re-assigned every render so they always close over fresh state. */
  const appApi = useRef({}).current;
  appApi.onSelectArgo = id => select(id);
  appApi.onBackgroundClick = () => deselect();
  appApi.onHoverArgo = (id, pos) => setHoverTip(id ? { id, x: pos.x, y: pos.y } : null);
  appApi.onMoveArgoTip = pos => setHoverTip(t => (t ? { ...t, x: pos.x, y: pos.y } : t));
  appApi.onProbe = (lon, lat, v) => setProbe({ lon, lat, v });
  appApi.onLegendUpdate = range => setLegendRange(range);
  appApi.onToast = msg => pushToast(msg);
  appApi.onCamInteract = () => { setCamHintFaded(true); dismissIntro(); };
  appApi.getComp = () => compRef.current;

  /* ---------------- derived readouts (updateReadouts in the prototype) ---------------- */
  const matchedTimeText = comp ? fmtUTC(comp.match.time) : null;
  const matchTimeIdx = comp ? comp.match.timeIdx : null;

  return (
    <>
      <GlobeView sceneRef={sceneRef} stateRef={stateRef} handlers={appApi} />

      <Header variable={state.variable} infoOpen={infoOpen} onInfoToggle={setInfoOpen} />

      <ExplorerControls
        state={state}
        depthAttract={depthAttract}
        matchedTimeText={matchedTimeText}
        matchTimeIdx={matchTimeIdx}
        onRailCollapse={() => setRailClosed(true)}
        onRailOpen={() => setRailClosed(false)}
        onDatasetAttempt={() => pushToast('MULTIOBS_GLO_PHY_MYNRT is not part of the offline demo — GLORYS12 retained.')}
        onVariableChange={setVariable}
        onSetTime={setTime}
        onSetDepth={setDepth}
        onToggle={setToggle}
        onExaggeration={setExaggeration}
        onOpacity={setOpacity}
        onResetCamera={resetCamera}
        onResetView={resetView}
      />

      <ObservationInspector
        selectedId={state.selectedId}
        comp={comp}
        active={inspectorOn}
        variable={state.variable}
        viewTime={state.time}
        provenanceOpen={state.provenanceOpen}
        onToggleProvenance={toggleProvenance}
        onClear={deselect}
        onOpenTray={() => setTray(true)}
      />

      <ComparisonTray
        comp={comp}
        variable={state.variable}
        trayTab={state.trayTab}
        trayOpen={state.trayOpen}
        depth={state.depth}
        timeIdx={state.timeIdx}
        chartsOn={chartsOn}
        metricsActive={metricsOn}
        railClosed={railClosed}
        onSetTray={setTray}
        onSetTab={tab => setState(s => ({ ...s, trayTab: tab }))}
      />

      <SceneOverlays
        exaggeration={state.exaggeration}
        variable={state.variable}
        depth={state.depth}
        time={state.time}
        legendRange={legendRange}
        probe={probe}
        toasts={toasts}
        hoverTip={hoverTip}
        camHintFaded={camHintFaded}
      />

      <OnboardingOverlay gone={!introOn} onStart={dismissIntro} />
    </>
  );
}
