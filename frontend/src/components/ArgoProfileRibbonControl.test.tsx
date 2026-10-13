import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ArgoProfileRibbonControl, ribbonRejectionMessage } from './ArgoProfileRibbonControl';
import { buildArgoRibbonSceneData, type ArgoRibbonSceneData } from '../utils/argoProfileRibbon';

/**
 * The panel's job is to prevent the scene from being misread: a stretched column
 * must say it is stretched, the ribbon and the spheres must be named, and an
 * absent model level must be stated rather than left to look like an omission.
 */

const OBSERVATIONS = Array.from({ length: 80 }, (_, index) => {
  const depth = index * 25;
  return {
    depth_m: depth,
    temperature_c: depth < 100 ? 29 - depth / 100 : 26 - (depth - 100) / 40,
    salinity_psu: 33 + depth / 1000,
    temp_qc: 1,
    psal_qc: 1,
  };
});

const COMPARISONS = [0, 10, 50, 100, 250, 500].map((depthM) => ({
  depthM,
  modelTemperatureC: 28 - depthM / 40,
  method: 'native',
}));

const AXIS = {
  modelDepths: [0, 10, 50, 100, 250, 500],
  storedFileDepths: [0, 17.5, 52.5, 125, 275, 500],
};

function sceneData(overrides: Partial<ArgoRibbonSceneData> = {}): ArgoRibbonSceneData {
  return {
    ...buildArgoRibbonSceneData(OBSERVATIONS, 'temperature_c', COMPARISONS, AXIS, (depthM) =>
      depthM === 100 ? 125 : depthM === 250 ? 275 : null
    ),
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof ArgoProfileRibbonControl>> = {}) {
  const onVariableChange = vi.fn();
  const onExaggerationChange = vi.fn();
  const onResetView = vi.fn();
  render(
    <ArgoProfileRibbonControl
      visible
      floatId="5907346"
      data={sceneData()}
      variable="temperature_c"
      paletteId="classic"
      exaggeration={40}
      onVariableChange={onVariableChange}
      onExaggerationChange={onExaggerationChange}
      onResetView={onResetView}
      {...props}
    />
  );
  return { onVariableChange, onExaggerationChange, onResetView };
}

afterEach(cleanup);

describe('ArgoProfileRibbonControl', () => {
  it('renders nothing when no float is selected', () => {
    renderPanel({ visible: false });
    expect(screen.queryByTestId('argo-ribbon-control')).toBeNull();
  });

  it('names the float and the variable being coloured', () => {
    renderPanel();
    expect(screen.getByTestId('argo-ribbon-control')).toBeTruthy();
    expect(screen.getByText('FLOAT 5907346')).toBeTruthy();
    expect(screen.getByText('Temperature')).toBeTruthy();
    expect(screen.getByText('Salinity')).toBeTruthy();
  });

  it('always states the vertical exaggeration in words', () => {
    renderPanel({ exaggeration: 10 });
    expect(screen.getByText('vertical exaggeration 10x')).toBeTruthy();
  });

  it('switches the exaggerated scale and reports the chosen factor', () => {
    const { onExaggerationChange } = renderPanel();
    expect(screen.getByText('vertical exaggeration 40x')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '100x' }));
    expect(onExaggerationChange).toHaveBeenCalledWith(100);
  });

  it('offers exactly the three permitted factors', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: '10x' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '40x' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '100x' })).toBeTruthy();
  });

  it('says the exaggeration changes drawn depth only, not the labels', () => {
    renderPanel();
    expect(screen.getByText(/drawn depth only/i)).toBeTruthy();
    expect(screen.getByText(/labels always carry the real depth/i)).toBeTruthy();
  });

  it('toggles the coloured variable', () => {
    const { onVariableChange } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Salinity' }));
    expect(onVariableChange).toHaveBeenCalledWith('salinity_psu');
  });

  it('shows the colour scale of the values actually drawn', () => {
    renderPanel();
    const scale = screen.getByTestId('ribbon-colour-scale');
    expect(scale.textContent).toContain('Temperature');
    expect(scale.textContent).toContain('°C');
    // 80 measured levels is well under the segment budget, so all are drawn.
    expect(scale.textContent).toContain('80 of 80 measured levels drawn');
    expect(scale.textContent).toContain('depth 0–1975 m');
  });

  it('names what the ribbon and the spheres each are', () => {
    renderPanel();
    expect(screen.getByText('ribbon = Argo observation')).toBeTruthy();
    expect(screen.getByText('spheres = HYCOM model level')).toBeTruthy();
  });

  it('says both share one colour scale, so colour is comparable', () => {
    renderPanel();
    expect(screen.getByText(/same colour scale/i)).toBeTruthy();
  });

  it('states plainly when no model level matched', () => {
    renderPanel({
      data: buildArgoRibbonSceneData(OBSERVATIONS, 'temperature_c', [], AXIS, () => null),
    });
    expect(screen.getByTestId('ribbon-no-model-note')).toBeTruthy();
    expect(screen.getByText(/no HYCOM level matched/i)).toBeTruthy();
    expect(screen.queryByText(/same colour scale/i)).toBeNull();
  });

  it('explains a missing ribbon instead of showing an empty frame', () => {
    renderPanel({
      data: buildArgoRibbonSceneData(
        [{ depth_m: 0, temperature_c: 29, temp_qc: 4 }],
        'temperature_c',
        COMPARISONS,
        AXIS,
        () => null
      ),
    });
    expect(screen.getByTestId('ribbon-rejection-note')).toBeTruthy();
    expect(screen.getByText(/no QC-passed levels/i)).toBeTruthy();
    expect(screen.queryByTestId('ribbon-colour-scale')).toBeNull();
  });

  it('offers a reset view action', () => {
    const { onResetView } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /reset view/i }));
    expect(onResetView).toHaveBeenCalled();
  });
});

describe('ribbonRejectionMessage', () => {
  it('has a message for every rejection and none when there is no rejection', () => {
    expect(ribbonRejectionMessage('NO_PROFILE')).toBeTruthy();
    expect(ribbonRejectionMessage('NO_QC_ACCEPTED_LEVELS')).toBeTruthy();
    expect(ribbonRejectionMessage('NO_FINITE_VALUE_FOR_VARIABLE')).toBeTruthy();
    expect(ribbonRejectionMessage(null)).toBeNull();
  });

  it('never claims model error in a rejection message', () => {
    const messages = [
      ribbonRejectionMessage('NO_PROFILE'),
      ribbonRejectionMessage('NO_QC_ACCEPTED_LEVELS'),
      ribbonRejectionMessage('NO_FINITE_VALUE_FOR_VARIABLE'),
    ];
    messages.forEach((message) => {
      expect(message?.toLowerCase()).not.toContain('bias');
      expect(message?.toLowerCase()).not.toContain('error');
    });
  });
});