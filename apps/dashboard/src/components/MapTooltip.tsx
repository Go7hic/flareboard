import { formatMapMetricValue } from '../lib/map-format';

type MapTooltipProps = {
  label: string;
  value: number;
  x: number;
  y: number;
};

export function MapTooltip({ label, value, x, y }: MapTooltipProps) {
  return (
    <div
      className="map-tooltip"
      style={{ left: x, top: y }}
      role="tooltip"
    >
      {label}: {formatMapMetricValue(value)}
    </div>
  );
}
