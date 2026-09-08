import { useEffect, useRef } from 'react';
import { createOceanScene } from '../engine/cesiumScene.js';

/* OCEAN-X 3D scene host.
   Creates exactly one Cesium viewer per component lifetime:
   initialized in a mount-only effect, destroyed on unmount. All
   Cesium specifics stay inside engine/cesiumScene.js. */
export default function GlobeView({ sceneRef, stateRef, handlers }) {
  const containerRef = useRef(null);
  const creditRef = useRef(null);

  useEffect(() => {
    const scene = createOceanScene({
      container: containerRef.current,
      creditContainer: creditRef.current,
      stateRef,
      handlers
    });
    scene.init();
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* ============ 3D OCEAN SCENE (hero layer) ============ */}
      <div id="cesium-container" ref={containerRef}></div>
      <div id="shade"></div>
      <div id="credit-container" ref={creditRef}></div>
    </>
  );
}
