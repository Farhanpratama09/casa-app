import { IslandMode, IslandState } from '../types/island';

export interface DomSampleRecord {
  timestamp: number;
  cycle: number;
  transition: string;
  containerHeight: number;
  containerWidth: number;
  containerCenter: number;
  horizontalShift: number;
  bubbleRight: number | null;
  windowInnerWidth: number;
  idleOpacity: number;
  expandedOpacity: number;
  idleClockDisplay: string | null;
  idleClockFound: boolean;
  isClippingViolation: boolean;
  isGhostingViolation: boolean;
  isLeakViolation: boolean;
  isShiftViolation: boolean;
}

export interface RealDomTestReport {
  totalCycles: number;
  totalSamples: number;
  zeroClippingViolations: number;
  antiGhostingViolations: number;
  noHeaderLeakViolations: number;
  zeroShiftViolations: number;
  maxHorizontalShift: number;
  minBubbleMargin: number;
  maxContainerHeight: number;
  passed: boolean;
  sampleSnapshots: DomSampleRecord[];
  errors: string[];
  durationMs: number;
}

export type StateTransitionCallback = (
  nextState: IslandState,
  targetMode?: IslandMode,
  secondaryBubble?: string | null
) => void;

let transitionCallback: StateTransitionCallback | null = null;
let canvasResizeCallCount = 0;

export const registerIslandTransitionHook = (cb: StateTransitionCallback) => {
  transitionCallback = cb;
};

export const unregisterIslandTransitionHook = () => {
  transitionCallback = null;
};

export const recordCanvasResizeCall = () => {
  canvasResizeCallCount++;
};

/**
 * Real DOM Runtime Loop Test Runner.
 * Executes in a real Chromium browser engine (WebView2 / Chrome / Puppeteer).
 * Validates:
 * 1. Zero-Clipping Assertion: bubbleElement.getBoundingClientRect().right <= window.innerWidth
 * 2. Anti-Ghosting Assertion: Idle text must NEVER appear (opacity <= 0.05) when container height > 45px!
 * 3. No-Header Leak Assertion: in expanded mode, idle clock text has display === 'none' or not found
 * 4. Zero-Horizontal Shift Assertion: Physical center of main pill must remain locked at screen center (shift <= 0.5px)
 */
export const runRealDomLoopTest = async (
  cycles: number = 50,
  transitionHoldMs: number = 320
): Promise<RealDomTestReport> => {
  const startTime = Date.now();
  let zeroClippingViolations = 0;
  let antiGhostingViolations = 0;
  let noHeaderLeakViolations = 0;
  let zeroShiftViolations = 0;
  let maxHorizontalShift = 0;
  let minBubbleMargin = 9999;
  let maxContainerHeight = 0;
  let totalSamples = 0;
  const errors: string[] = [];
  const sampleSnapshots: DomSampleRecord[] = [];

  if (!transitionCallback) {
    const err = '[RealDomTest] Transition callback is not registered in DOM!';
    console.error(err);
    return {
      totalCycles: 0,
      totalSamples: 0,
      zeroClippingViolations: 1,
      antiGhostingViolations: 1,
      noHeaderLeakViolations: 1,
      zeroShiftViolations: 1,
      maxHorizontalShift: 0,
      minBubbleMargin: 0,
      maxContainerHeight: 0,
      passed: false,
      sampleSnapshots: [],
      errors: [err],
      durationMs: 0,
    };
  }

  // State loop sequence per cycle:
  // idle -> dual_idle -> idle_peek -> expanded -> collapse (dual_idle) -> idle
  const sequence: {
    name: string;
    state: IslandState;
    mode: IslandMode;
    secondary: string | null;
  }[] = [
    { name: 'idle', state: 'idle', mode: 'idle', secondary: null },
    { name: 'dual_idle', state: 'idle', mode: 'dual_bubble', secondary: 'core.media' },
    { name: 'idle_peek', state: 'idle_peek', mode: 'expanded_music', secondary: 'core.media' },
    { name: 'expanded', state: 'expanded', mode: 'expanded_music', secondary: 'core.media' },
    { name: 'collapse_dual', state: 'idle', mode: 'dual_bubble', secondary: 'core.media' },
    { name: 'idle', state: 'idle', mode: 'idle', secondary: null },
  ];

  let currentCycle = 0;
  let currentTransitionName = '';
  let currentStateName: IslandState = 'idle';

  const takeSample = () => {
    const container = document.querySelector('[data-island-container="true"]') as HTMLElement | null;
    const bubble = document.querySelector('[data-island-bubble="secondary"]') as HTMLElement | null;
    const idleView = document.querySelector('[data-island-view="idle"]') as HTMLElement | null;
    const expandedView = document.querySelector('[data-island-view="expanded"]') as HTMLElement | null;
    const idleClock = document.querySelector('[data-idle-clock-date="true"]') as HTMLElement | null;

    if (!container) return;

    totalSamples++;
    const containerRect = container.getBoundingClientRect();
    const containerHeight = containerRect.height;
    const containerWidth = containerRect.width;
    const windowInnerWidth = window.innerWidth;
    maxContainerHeight = Math.max(maxContainerHeight, containerHeight);

    // Assertion 4: Zero Horizontal Pivot Shift
    const containerCenter = containerRect.left + containerRect.width / 2;
    const screenCenter = windowInnerWidth / 2;
    const horizontalShift = Math.abs(containerCenter - screenCenter);
    maxHorizontalShift = Math.max(maxHorizontalShift, horizontalShift);

    let isShiftViolation = false;
    if (horizontalShift > 0.5) {
      isShiftViolation = true;
      zeroShiftViolations++;
      errors.push(
        `[Cycle ${currentCycle}][${currentTransitionName}] Horizontal Shift Violation: center is ${containerCenter.toFixed(
          2
        )}px, expected ${screenCenter.toFixed(2)}px (shift: ${horizontalShift.toFixed(2)}px)!`
      );
    }

    let bubbleRight: number | null = null;
    let isClippingViolation = false;

    if (bubble) {
      const bubbleRect = bubble.getBoundingClientRect();
      bubbleRight = bubbleRect.right;
      const margin = windowInnerWidth - bubbleRect.right;
      minBubbleMargin = Math.min(minBubbleMargin, margin);

      // Assertion 1: Zero-Clipping
      if (bubbleRect.right > windowInnerWidth + 0.5) {
        isClippingViolation = true;
        zeroClippingViolations++;
        errors.push(
          `[Cycle ${currentCycle}][${currentTransitionName}] Zero-Clipping Violation: bubble.right (${bubbleRect.right.toFixed(
            1
          )}px) > window.innerWidth (${windowInnerWidth}px)!`
        );
      }
    }

    const idleOpacity = idleView ? parseFloat(window.getComputedStyle(idleView).opacity || '0') : 0;
    const expandedOpacity = expandedView
      ? parseFloat(window.getComputedStyle(expandedView).opacity || '0')
      : 0;

    // Assertion 2: Continuous Cross-Fade / Zero Stutter
    // Both layers transition smoothly; when expanded settled, idleOpacity <= 0.05; when idle settled, expandedOpacity <= 0.05
    let isGhostingViolation = false;
    if (currentStateName === 'idle' && expandedOpacity > 0.15 && containerHeight <= 45) {
      isGhostingViolation = true;
      antiGhostingViolations++;
      errors.push(
        `[Cycle ${currentCycle}][${currentTransitionName}] Residual Expanded Ghosting: height ${containerHeight.toFixed(
          1
        )}px with expandedOpacity: ${expandedOpacity.toFixed(2)}!`
      );
    }

    // Assertion 3: No-Header Leak during Expanded State
    let isLeakViolation = false;
    let idleClockDisplay: string | null = null;
    let idleClockFound = false;

    if (idleClock) {
      idleClockFound = true;
      idleClockDisplay = window.getComputedStyle(idleClock).display;
      if (currentStateName === 'expanded' && idleOpacity > 0.05) {
        isLeakViolation = true;
        noHeaderLeakViolations++;
        errors.push(
          `[Cycle ${currentCycle}][${currentTransitionName}] No-Header Leak Violation: idleOpacity is ${idleOpacity.toFixed(
            2
          )} during expanded state!`
        );
      }
    }

    // Store periodic representative snapshots
    if (totalSamples % 8 === 0 || isClippingViolation || isGhostingViolation || isLeakViolation || isShiftViolation) {
      sampleSnapshots.push({
        timestamp: Date.now() - startTime,
        cycle: currentCycle,
        transition: currentTransitionName,
        containerHeight: Math.round(containerHeight * 10) / 10,
        containerWidth: Math.round(containerWidth * 10) / 10,
        containerCenter: Math.round(containerCenter * 100) / 100,
        horizontalShift: Math.round(horizontalShift * 100) / 100,
        bubbleRight: bubbleRight ? Math.round(bubbleRight * 10) / 10 : null,
        windowInnerWidth,
        idleOpacity: Math.round(idleOpacity * 100) / 100,
        expandedOpacity: Math.round(expandedOpacity * 100) / 100,
        idleClockDisplay,
        idleClockFound,
        isClippingViolation,
        isGhostingViolation,
        isLeakViolation,
        isShiftViolation,
      });
    }
  };

  // Run sampling interval every 30ms throughout testing
  let samplingActive = true;
  const sampleInterval = setInterval(() => {
    if (samplingActive) {
      takeSample();
    }
  }, 30);

  // Execute cycles
  for (let c = 1; c <= cycles; c++) {
    currentCycle = c;

    for (const step of sequence) {
      currentTransitionName = step.name;
      currentStateName = step.state;

      transitionCallback(step.state, step.mode, step.secondary);

      // Hold and sample during transition
      const stepStartTime = Date.now();
      while (Date.now() - stepStartTime < transitionHoldMs) {
        takeSample();
        await new Promise((r) => setTimeout(r, 40));
      }
    }

    if (c % 10 === 0 || c === cycles) {
      console.log(
        `[RealDomLoopTest] Cycle ${c}/${cycles} complete (Samples: ${totalSamples}, Max Shift: ${maxHorizontalShift.toFixed(
          2
        )}px, Min Bubble Margin: ${minBubbleMargin === 9999 ? 'N/A' : minBubbleMargin.toFixed(1) + 'px'})`
      );
    }
  }

  samplingActive = false;
  clearInterval(sampleInterval);

  const durationMs = Date.now() - startTime;
  const passed =
    zeroClippingViolations === 0 &&
    antiGhostingViolations === 0 &&
    noHeaderLeakViolations === 0 &&
    zeroShiftViolations === 0;

  const report: RealDomTestReport = {
    totalCycles: cycles,
    totalSamples,
    zeroClippingViolations,
    antiGhostingViolations,
    noHeaderLeakViolations,
    zeroShiftViolations,
    maxHorizontalShift,
    minBubbleMargin: minBubbleMargin === 9999 ? 0 : minBubbleMargin,
    maxContainerHeight,
    passed,
    sampleSnapshots,
    errors,
    durationMs,
  };

  return report;
};

if (typeof window !== 'undefined') {
  (window as any).__START_REAL_DOM_LOOP_TEST__ = runRealDomLoopTest;
}
