import { describe, it, expect } from 'vitest';
import {
  modelDepthAxisDisagreementM,
  modelDepthAxisNote,
  modelFileLabelDepth,
  modelDepthLabel,
  modelDepthLabelCompact,
  type ModelDepthAxis,
} from './modelDepthLabel';

/**
 * The axis the app actually samples, beside the labels the subset file carries.
 * These differ on the thermocline levels because the file's DEPTH coordinate is
 * the midpoint of its own bounds.
 */
const AXIS: ModelDepthAxis = {
  modelDepths: [0, 10, 50, 100, 250, 500],
  storedFileDepths: [0, 17.5, 52.5, 125, 275, 500],
};

const AGREEING_AXIS: ModelDepthAxis = {
  modelDepths: [0, 10, 50, 100, 250, 500],
  storedFileDepths: [0, 10, 50, 100, 250, 500],
};

describe('modelDepthLabel', () => {
  it('leaves a depth alone when the file labels it identically', () => {
    expect(modelDepthLabel(500, AXIS)).toBe('500 m');
    expect(modelDepthLabel(0, AGREEING_AXIS)).toBe('0 m');
  });

  it('adds the file label when the two disagree', () => {
    expect(modelDepthLabel(100, AXIS)).toBe('100 m (file label 125 m)');
  });

  it('keeps the file label exact, including halves', () => {
    // The file's labels include 17.5 and 52.5 m. Written as "18 m" and "53 m"
    // they would name depths the file never carried.
    expect(modelDepthLabel(10, AXIS)).toBe('10 m (file label 17.5 m)');
    expect(modelDepthLabel(50, AXIS)).toBe('50 m (file label 52.5 m)');
  });

  it('falls back to a plain depth when no axis is available', () => {
    expect(modelDepthLabel(100, undefined)).toBe('100 m');
    expect(modelDepthLabel(100, {})).toBe('100 m');
  });

  it('renders a missing depth as a dash rather than zero', () => {
    expect(modelDepthLabel(null, AXIS)).toBe('—');
    expect(modelDepthLabel(Number.NaN, AXIS)).toBe('—');
  });

  it('does not invent a label for a depth that is not on the axis', () => {
    expect(modelDepthLabel(175, AXIS)).toBe('175 m');
  });
});

describe('modelDepthLabelCompact', () => {
  it('shortens the form for axes and ticks', () => {
    expect(modelDepthLabelCompact(100, AXIS)).toBe('100 m · file 125 m');
    expect(modelDepthLabelCompact(500, AXIS)).toBe('500 m');
  });
});

describe('modelFileLabelDepth', () => {
  it('matches by position, not by value', () => {
    expect(modelFileLabelDepth(250, AXIS)).toBe(275);
    expect(modelFileLabelDepth(10, AXIS)).toBe(17.5);
  });

  it('returns null when there is nothing to add', () => {
    expect(modelFileLabelDepth(500, AXIS)).toBeNull();
    expect(modelFileLabelDepth(100, AGREEING_AXIS)).toBeNull();
    expect(modelFileLabelDepth(100, undefined)).toBeNull();
  });
});

describe('modelDepthAxisDisagreementM', () => {
  it('is the largest sampled-to-labelled gap on the axis', () => {
    expect(modelDepthAxisDisagreementM(AXIS)).toBe(25);
  });

  it('is zero when the file agrees with the sampled axis', () => {
    expect(modelDepthAxisDisagreementM(AGREEING_AXIS)).toBe(0);
    expect(modelDepthAxisDisagreementM(undefined)).toBe(0);
  });
});

describe('modelDepthAxisNote', () => {
  it('names both axes and the size of the disagreement', () => {
    const note = modelDepthAxisNote(AXIS);
    expect(note).toContain('0, 10, 50, 100, 250, 500 m');
    expect(note).toContain('0, 17.5, 52.5, 125, 275, 500 m');
    expect(note).toContain('25 m apart');
    expect(note).toContain('midpoint of its own bounds');
  });

  it('says the labels agree when they do, instead of implying doubt', () => {
    const note = modelDepthAxisNote(AGREEING_AXIS);
    expect(note).toContain('the file labels them identically');
    expect(note).not.toContain('apart');
  });

  it('returns null when there is no axis to describe', () => {
    expect(modelDepthAxisNote(undefined)).toBeNull();
    expect(modelDepthAxisNote({})).toBeNull();
  });
});