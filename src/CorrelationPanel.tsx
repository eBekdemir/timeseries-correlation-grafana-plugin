import React, { useState } from 'react';
import { PanelProps } from '@grafana/data';
import { slidingCorrelation, smoothSeries } from './utils/correlation';

const AXIS_PADDING = 24;

const formatTimestamp = (value: any) => {
  if (value === null || value === undefined) {
    return '';
  }

  let date: Date | null = null;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number' || typeof value === 'string') {
    date = new Date(value);
  } else if (value && typeof value.valueOf === 'function') {
    date = new Date(value.valueOf());
  }

  if (!date || Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
};

const buildAxisTicks = (values: any[], totalWidth: number) => {
  if (!values.length) {
    return [];
  }

  const safeWidth = Math.max(totalWidth, 1);
  const count = Math.min(5, values.length);

  if (count <= 1) {
    return [{ x: 0, label: formatTimestamp(values[0]) }];
  }

  const lastIndex = values.length - 1;
  return Array.from({ length: count }, (_, idx) => {
    const ratio = idx / (count - 1);
    const targetIndex = Math.min(lastIndex, Math.round(ratio * lastIndex));
    return {
      x: ratio * safeWidth,
      label: formatTimestamp(values[targetIndex])
    };
  });
};

const buildValueTicks = (min: number, max: number, height: number, count = 5) => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || height <= 0) {
    return [];
  }

  if (min === max) {
    return [
      {
        y: height / 2,
        label: min.toLocaleString()
      }
    ];
  }

  const steps = Math.max(count, 2);
  const range = max - min;

  return Array.from({ length: steps }, (_, idx) => {
    const ratio = idx / (steps - 1);
    const value = max - ratio * range;
    return {
      y: ratio * height,
      label: value.toLocaleString()
    };
  });
};

const buildCorrelationPath = (values: Array<number | null>, chartWidth: number, plotHeight: number) => {
  if (!values.length) {
    return '';
  }

  const denom = Math.max(values.length - 1, 1);
  let path = '';
  let hasOpenSegment = false;

  values.forEach((value, idx) => {
    if (value === null || !Number.isFinite(value)) {
      hasOpenSegment = false;
      return;
    }

    const x = (idx / denom) * chartWidth;
    const y = (1 - (value + 1) / 2) * plotHeight;
    path += `${hasOpenSegment ? ' L ' : 'M '}${x} ${y}`;
    hasOpenSegment = true;
  });

  return path;
};

type PanelOptions = {
  windowSize?: number;
};

export const CorrelationPanel: React.FC<PanelProps<PanelOptions>> = ({
  data,
  width,
  height,
  options
}) => {
  const [viewRange, setViewRange] = useState<[number, number]>([0, 1]);
  const [selection, setSelection] = useState<{ start: number | null; end: number | null; width: number }>({
    start: null,
    end: null,
    width: Math.max(width, 1)
  });
  const [isSelecting, setIsSelecting] = useState(false);

  /** -------------------------
   * Extract ALL time and numeric fields
   --------------------------*/
  let timeField: any = null;
  const numericFields: any[] = [];

  for (const frame of data.series) {
    const t = frame.fields.find(f => f.type === 'time');
    if (t && !timeField) {
      timeField = t; // take the first timestamp field
    }

    const nums = frame.fields.filter(f => f.type === 'number');
    numericFields.push(...nums);
  }

  if (!timeField) {
    return <div>No time field found.</div>;
  }

  if (numericFields.length < 2) {
    return <div>At least 2 numeric series are required.</div>;
  }

  const timestamps = timeField.values.toArray();

  type NumericSeries = { name: string; values: number[] };
  const series: NumericSeries[] = numericFields.map(f => ({
    name: f.name,
    values: f.values.toArray()
  }));

  /** -------------------------
   * Compute correlation only for the
   * first two numeric fields
   --------------------------*/
  const window = options.windowSize || 30;
  const rawCorrelation = slidingCorrelation(series[0].values, series[1].values, window);
  const smoothingRadius = Math.max(1, Math.floor(window / 8));
  const correlation = smoothSeries(rawCorrelation, smoothingRadius);

  /** -------------------------
   * Zoom helpers
   --------------------------*/
  const totalPoints = Math.max(timestamps.length - 1, 1);
  const startIndex = Math.max(0, Math.floor(viewRange[0] * totalPoints));
  const endIndex = Math.min(timestamps.length - 1, Math.ceil(viewRange[1] * totalPoints));

  const selectionActive = selection.start !== null && selection.end !== null;

  const normalize = (v: number, min: number, max: number, h: number) => {
    if (max === min) {
      return h / 2;
    }
    return (1 - (v - min) / (max - min)) * h;
  };

  const chartWidth = Math.max(width, 1);
  const topHeight = height * 0.6;
  const bottomHeight = height * 0.3;
  const seriesPlotHeight = Math.max(topHeight, 10);
  const corrPlotHeight = Math.max(bottomHeight - AXIS_PADDING, 10);

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const localWidth = Math.max(bounds.width, 1);
    const x = clamp(event.clientX - bounds.left, 0, localWidth);
    setSelection({ start: x, end: x, width: localWidth });
    setIsSelecting(true);
  };

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!isSelecting) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const localWidth = Math.max(bounds.width, 1);
    const x = clamp(event.clientX - bounds.left, 0, localWidth);
    setSelection(sel => ({ ...sel, end: x, width: localWidth }));
  };

  const finishSelection = () => {
    if (!selectionActive) {
      setSelection({ start: null, end: null, width: chartWidth });
      setIsSelecting(false);
      return;
    }

    const span = Math.abs((selection.end ?? 0) - (selection.start ?? 0));
    if (span < 4) {
      // consider too small to zoom
      setSelection({ start: null, end: null, width: chartWidth });
      setIsSelecting(false);
      return;
    }

    const baseWidth = Math.max(selection.width, 1);
    const startRatio = Math.min(selection.start!, selection.end!) / baseWidth;
    const endRatio = Math.max(selection.start!, selection.end!) / baseWidth;
    const currentSpan = Math.max(viewRange[1] - viewRange[0], Number.EPSILON);
    const newStart = clamp(viewRange[0] + startRatio * currentSpan, 0, 1);
    const newEnd = clamp(viewRange[0] + endRatio * currentSpan, 0, 1);
    setViewRange([newStart, newEnd]);
    setSelection({ start: null, end: null, width: baseWidth });
    setIsSelecting(false);
  };

  const handleMouseUp = () => {
    finishSelection();
  };

  const handleMouseLeave = () => {
    if (isSelecting) {
      finishSelection();
    }
  };

  const resetZoom = () => {
    setViewRange([0, 1]);
    setSelection({ start: null, end: null, width: chartWidth });
  };

  const visibleSeries = series.map(s => {
    const maxIndex = Math.max(s.values.length - 1, 0);
    const start = Math.min(startIndex, maxIndex);
    const end = Math.min(endIndex, maxIndex);
    return {
      ...s,
      visibleValues: s.values.slice(start, end + 1)
    };
  });

  const visibleCorrelation = (() => {
    if (!correlation.length) {
      return [];
    }
    const start = Math.min(startIndex, correlation.length - 1);
    const end = Math.min(endIndex, correlation.length - 1);
    return correlation.slice(start, end + 1);
  })();
  const correlationPath = buildCorrelationPath(visibleCorrelation, chartWidth, corrPlotHeight);

  const visibleTimestamps = (() => {
    if (!timestamps.length) {
      return [];
    }
    const maxIndex = Math.max(timestamps.length - 1, 0);
    const start = Math.min(startIndex, maxIndex);
    const end = Math.min(endIndex, maxIndex);
    return timestamps.slice(start, end + 1);
  })();

  const timeAxisTicks = buildAxisTicks(visibleTimestamps, chartWidth);

  const valueAxisTicks = (() => {
    const allValues = visibleSeries
      .flatMap(s => s.visibleValues)
      .filter(v => typeof v === 'number' && Number.isFinite(v));

    if (!allValues.length) {
      return [];
    }

    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    return buildValueTicks(minValue, maxValue, seriesPlotHeight);
  })();

  const correlationAxisTicks = buildValueTicks(-1, 1, corrPlotHeight);

  const selectionX = selectionActive ? Math.min(selection.start!, selection.end!) : 0;
  const selectionWidth = selectionActive ? Math.abs((selection.end ?? 0) - (selection.start ?? 0)) : 0;
  const rightAxisX = Math.max(width - 1, 0);

  return (
    <div style={{ width, height, padding: 10 }}>
      <h3 style={{ color: '#ddd' }}>
        Enes Bekdemir - 2025502000
      </h3>
      <h3 style={{ color: '#ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Rolling Pearson Correlation: {series[0].name} vs {series[1].name}
        <button
          onClick={resetZoom}
          disabled={viewRange[0] === 0 && viewRange[1] === 1}
          style={{
            padding: '4px 8px',
            background: '#333',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: 4,
            cursor: viewRange[0] === 0 && viewRange[1] === 1 ? 'not-allowed' : 'pointer'
          }}
        >
          Reset zoom
        </button>
      </h3>

      {/* --- Top chart: the actual random walk series --- */}
      <svg
        width={width}
        height={topHeight}
        style={{ background: '#111', cursor: 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {visibleSeries.map((s, idx) => {
          const visibleValues = s.visibleValues.length ? s.visibleValues : [];
          if (!visibleValues.length) {
            return null;
          }
          const min = Math.min(...visibleValues);
          const max = Math.max(...visibleValues);

          const path = visibleValues
            .map((v, i) => {
              const denom = Math.max(visibleValues.length - 1, 1);
              const x = (i / denom) * width;
              const y = normalize(v, min, max, seriesPlotHeight);
              return `${x},${y}`;
            })
            .join(' L ');

          return (
            <path
              key={idx}
              d={`M ${path}`}
              stroke={idx === 0 ? '#00eaff' : '#ff8c00'}
              fill="none"
              strokeWidth={idx === 0 ? 2 : 1}
            />
          );
        })}
        {selectionActive && (
          <rect
            x={selectionX}
            y={0}
            width={selectionWidth}
            height={seriesPlotHeight}
            fill="rgba(255, 255, 255, 0.1)"
            stroke="#fff"
            strokeDasharray="4"
          />
        )}
        <line x1={rightAxisX} y1={0} x2={rightAxisX} y2={seriesPlotHeight} stroke="#333" strokeWidth={1} />
        {valueAxisTicks.map((tick, idx) => (
          <g key={`value-axis-${idx}`}>
            <line
              x1={rightAxisX - 6}
              y1={tick.y}
              x2={rightAxisX}
              y2={tick.y}
              stroke="#555"
              strokeWidth={1}
            />
            <text
              x={rightAxisX - 8}
              y={tick.y}
              fill="#bbb"
              fontSize={10}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {tick.label}
            </text>
          </g>
        ))}
      </svg>

      {/* --- Bottom chart: correlation --- */}
      <svg width={width} height={bottomHeight} style={{ background: '#222' }}>
        {correlationPath && (
          <path
            d={correlationPath}
            stroke="#60cfff"
            strokeWidth={2}
            fill="none"
          />
        )}
        <line x1={rightAxisX} y1={0} x2={rightAxisX} y2={corrPlotHeight} stroke="#333" strokeWidth={1} />
        {correlationAxisTicks.map((tick, idx) => (
          <g key={`corr-value-axis-${idx}`}>
            <line
              x1={rightAxisX - 6}
              y1={tick.y}
              x2={rightAxisX}
              y2={tick.y}
              stroke="#555"
              strokeWidth={1}
            />
            <text
              x={rightAxisX - 8}
              y={tick.y}
              fill="#bbb"
              fontSize={10}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {tick.label}
            </text>
          </g>
        ))}
        <line x1={0} y1={corrPlotHeight} x2={width} y2={corrPlotHeight} stroke="#333" strokeWidth={1} />
        {timeAxisTicks.map((tick, idx) => (
          <g key={`corr-axis-${idx}`}>
            <line
              x1={tick.x}
              y1={corrPlotHeight}
              x2={tick.x}
              y2={corrPlotHeight + 6}
              stroke="#555"
              strokeWidth={1}
            />
            <text
              x={tick.x}
              y={corrPlotHeight + 8}
              fill="#bbb"
              fontSize={10}
              textAnchor="middle"
              dominantBaseline="hanging"
            >
              {tick.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};
