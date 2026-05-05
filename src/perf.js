// Performance optimizations: lazy-loading and profiling utilities

const lazyModules = {
  radar: null,
};

// Lazy-load radar overlay when user first interacts with it
export async function ensureRadarLoaded() {
  if (lazyModules.radar === null) {
    try {
      lazyModules.radar = await import('./radar.js');
    } catch (e) {
      console.error('Failed to load radar module:', e);
      lazyModules.radar = false;
    }
  }
  return lazyModules.radar || null;
}

// Performance monitoring: measure Core Web Vitals (LCP, FID, CLS)
// Called from main.js to track real user metrics
export function initPerformanceMonitoring() {
  let storedDebug = false;
  try {
    storedDebug = localStorage.getItem('hm-debug-perf') === '1';
  } catch {
    storedDebug = false;
  }
  const debugPerf = new URLSearchParams(window.location.search).has('perf') || storedDebug;
  if (!debugPerf) return;

  // Report LCP (Largest Contentful Paint)
  if ('PerformanceObserver' in window) {
    try {
      const lcpObserver = new PerformanceObserver(list => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        console.log('[Perf] LCP:', lastEntry.renderTime || lastEntry.loadTime, 'ms');
      });
      lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
    } catch (e) { /* LCP not available */ }

    // Report CLS (Cumulative Layout Shift)
    try {
      let clsValue = 0;
      const clsObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        }
        console.log('[Perf] CLS:', clsValue.toFixed(3));
      });
      clsObserver.observe({ entryTypes: ['layout-shift'] });
    } catch (e) { /* CLS not available */ }

    // Report FID (First Input Delay) — modern replacement is INP
    try {
      const fidObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          console.log('[Perf] FID:', entry.processingDuration, 'ms');
        }
      });
      fidObserver.observe({ entryTypes: ['first-input'] });
    } catch (e) { /* FID not available */ }
  }

  // Navigation timing
  if ('PerformanceNavigationTiming' in window) {
    window.addEventListener('load', () => {
      const nav = performance.getEntriesByType('navigation')[0];
      console.log('[Perf] DNS:', (nav.domainLookupEnd - nav.domainLookupStart), 'ms');
      console.log('[Perf] TCP:', (nav.connectEnd - nav.connectStart), 'ms');
      console.log('[Perf] TTFB:', (nav.responseStart - nav.requestStart), 'ms');
      console.log('[Perf] DOM interactive:', (nav.domInteractive - nav.fetchStart), 'ms');
      console.log('[Perf] DOM complete:', (nav.domComplete - nav.fetchStart), 'ms');
    });
  }
}

