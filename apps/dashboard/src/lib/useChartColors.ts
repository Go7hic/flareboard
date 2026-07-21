import { useEffect, useState } from 'react';
import {
  getChartSeriesPrimary,
  getMetricSeriesColors,
  type MetricSeriesColors,
} from './chart-colors';
import { themeChangeEventName } from './theme';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export type ChartColors = {
  border: string;
  muted: string;
  /** Primary data series (blue). Never --accent / gray-1000. */
  accent: string;
  panel: string;
  text: string;
  series: MetricSeriesColors;
};

export function getChartColors(): ChartColors {
  return {
    border: cssVar('--chart-grid') || cssVar('--border'),
    muted: cssVar('--chart-axis') || cssVar('--text-muted'),
    accent: getChartSeriesPrimary(),
    panel: cssVar('--chart-tooltip-bg') || cssVar('--bg-elevated'),
    text: cssVar('--text'),
    series: getMetricSeriesColors(),
  };
}

export function useChartColors(): ChartColors {
  const [chartColors, setChartColors] = useState(getChartColors);

  useEffect(() => {
    const update = () => setChartColors(getChartColors());
    window.addEventListener(themeChangeEventName, update);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    return () => {
      window.removeEventListener(themeChangeEventName, update);
      mq.removeEventListener('change', update);
    };
  }, []);

  return chartColors;
}
