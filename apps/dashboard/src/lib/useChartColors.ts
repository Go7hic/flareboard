import { useEffect, useState } from 'react';
import { themeChangeEventName } from './theme';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export type ChartColors = {
  border: string;
  muted: string;
  accent: string;
  panel: string;
  text: string;
};

export function getChartColors(): ChartColors {
  return {
    border: cssVar('--chart-grid') || cssVar('--border'),
    muted: cssVar('--chart-axis') || cssVar('--text-muted'),
    accent: cssVar('--chart-line') || cssVar('--accent'),
    panel: cssVar('--chart-tooltip-bg') || cssVar('--bg-elevated'),
    text: cssVar('--text'),
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
