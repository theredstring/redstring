import { useSyncExternalStore } from 'react';
import { getTextMetricsVersion, subscribeTextMetrics } from '../services/textMeasurement.js';

/**
 * Re-renders when cached text measurements are thrown away (the label font
 * arrived). Put it in the deps of anything memoised on a measurement, or that
 * memo keeps the fallback font's widths. See textMeasurement.js.
 */
export default function useTextMetricsVersion() {
  return useSyncExternalStore(subscribeTextMetrics, getTextMetricsVersion, getTextMetricsVersion);
}
