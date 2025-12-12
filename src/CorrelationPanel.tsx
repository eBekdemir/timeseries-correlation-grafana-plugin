import React, { useLayoutEffect, useRef, useState } from 'react';
import { PanelProps } from '@grafana/data';
import { slidingCorrelation, smoothSeries } from './utils/correlation';


const AXIS_PADDING = 24;
const SERIES_COLORS = ['#00eaff', '#ff8c00', '#9b59b6', '#2ecc71'];

const getSeriesColor = (index: number) => SERIES_COLORS[index] ?? '#b3b3b3';

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

const getTimeValue = (value: any) => {
  if (value instanceof Date) {
    return value.getTime();
  }

  const d = new Date(value);
  const time = d.getTime();
  if (!Number.isNaN(time)) {
    return time;
  }

  if (value && typeof value.valueOf === 'function') {
    const val = value.valueOf();
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val;
    }
  }

  const numeric = Number(value);
  return Number.isNaN(numeric) ? 0 : numeric;
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

const getSeriesRange = (values: Array<number | null | undefined>) => {
  const numericValues = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );

  if (!numericValues.length) {
    return null;
  }

  return {
    min: Math.min(...numericValues),
    max: Math.max(...numericValues)
  };
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
  const [hoverInfo, setHoverInfo] = useState<{
    timeLabel: string;
    seriesValues: { name: string; value: number | null }[];
    correlation: number | null;
    pointer: { x: number; y: number };
  } | null>(null);
  const [tooltipSize, setTooltipSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef<HTMLDivElement | null>(null);

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

  let timestamps = timeField.values.toArray();
  const firstTime = timestamps.length ? getTimeValue(timestamps[0]) : 0;
  const lastTime = timestamps.length ? getTimeValue(timestamps[timestamps.length - 1]) : 0;
  const isTimeDescending = timestamps.length > 1 && firstTime > lastTime;
  if (isTimeDescending) {
    timestamps = [...timestamps].reverse();
  }

  type NumericSeries = { name: string; values: number[] };
  const series: NumericSeries[] = numericFields.map(f => {
    const values = f.values.toArray();
    return {
      name: f.name,
      values: isTimeDescending ? values.slice().reverse() : values
    };
  });

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

  const minViewSpan = timestamps.length ? 1 / Math.max(timestamps.length, 1) : 0.001;

  useLayoutEffect(() => {
    if (hoverInfo && hoverRef.current) {
      const rect = hoverRef.current.getBoundingClientRect();
      setTooltipSize(prev => {
        if (prev.width === rect.width && prev.height === rect.height) {
          return prev;
        }
        return { width: rect.width, height: rect.height };
      });
    } else if (!hoverInfo && (tooltipSize.width !== 0 || tooltipSize.height !== 0)) {
      setTooltipSize({ width: 0, height: 0 });
    }
  }, [hoverInfo, tooltipSize.width, tooltipSize.height]);

  const updateHoverState = (localX: number, localWidth: number, pointer: { x: number; y: number } | null) => {
    if (!timestamps.length || !pointer) {
      return;
    }
    const ratioWithinView = localWidth <= 0 ? 0 : localX / localWidth;
    const spanIndices = Math.max(endIndex - startIndex, 0);
    const dataIndex = clamp(startIndex + Math.round(ratioWithinView * spanIndices), 0, timestamps.length - 1);
    const timeValue = timestamps[dataIndex];
    const seriesValuesAtPointer = series.map(s => ({
      name: s.name,
      value: typeof s.values[dataIndex] === 'number' ? s.values[dataIndex] : null
    }));
    const correlationValue =
      dataIndex < correlation.length && typeof correlation[dataIndex] === 'number'
        ? correlation[dataIndex]
        : null;
    setHoverInfo({
      timeLabel: formatTimestamp(timeValue),
      seriesValues: seriesValuesAtPointer,
      correlation: correlationValue,
      pointer
    });
  };

  const extractPointerData = (event: React.MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const localWidth = Math.max(bounds.width, 1);
    const x = clamp(event.clientX - bounds.left, 0, localWidth);
    const containerBounds = containerRef.current?.getBoundingClientRect();
    const referenceBounds = containerBounds ?? bounds;
    const refWidth = Math.max(referenceBounds.width, 1);
    const refHeight = Math.max(referenceBounds.height, 1);
    const pointer = {
      x: clamp(event.clientX - referenceBounds.left, 0, refWidth),
      y: clamp(event.clientY - referenceBounds.top, 0, refHeight)
    };
    updateHoverState(x, localWidth, pointer);
    return { x, localWidth };
  };

  const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    const { x, localWidth } = extractPointerData(event);
    setSelection({ start: x, end: x, width: localWidth });
    setIsSelecting(true);
  };

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const { x, localWidth } = extractPointerData(event);
    if (isSelecting) {
      setSelection(sel => ({ ...sel, end: x, width: localWidth }));
    }
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
    setHoverInfo(null);
  };

  const applyZoom = (zoomFactor: number) => {
    const currentSpan = Math.max(viewRange[1] - viewRange[0], minViewSpan);
    const newSpan = clamp(currentSpan * zoomFactor, minViewSpan, 1);
    const center = (viewRange[0] + viewRange[1]) / 2;
    let newStart = center - newSpan / 2;
    let newEnd = center + newSpan / 2;
    if (newStart < 0) {
      newEnd = Math.min(1, newEnd - newStart);
      newStart = 0;
    }
    if (newEnd > 1) {
      newStart = Math.max(0, newStart - (newEnd - 1));
      newEnd = 1;
    }
    setViewRange([newStart, newEnd]);
  };

  const handleZoomIn = () => {
    applyZoom(0.6);
  };

  const handleZoomOut = () => {
    applyZoom(1.5);
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

  const firstSeriesRange = getSeriesRange(visibleSeries[0]?.visibleValues ?? []);
  const secondSeriesRange = getSeriesRange(visibleSeries[1]?.visibleValues ?? []);
  const firstSeriesTicks = firstSeriesRange
    ? buildValueTicks(firstSeriesRange.min, firstSeriesRange.max, seriesPlotHeight)
    : [];
  const secondSeriesTicks = secondSeriesRange
    ? buildValueTicks(secondSeriesRange.min, secondSeriesRange.max, seriesPlotHeight)
    : [];
  const firstSeriesColor = getSeriesColor(0);
  const secondSeriesColor = getSeriesColor(1);

  const correlationAxisTicks = buildValueTicks(-1, 1, corrPlotHeight);

  const selectionX = selectionActive ? Math.min(selection.start!, selection.end!) : 0;
  const selectionWidth = selectionActive ? Math.abs((selection.end ?? 0) - (selection.start ?? 0)) : 0;
  const leftAxisX = 0;
  const rightAxisX = Math.max(width - 1, 0);

  const canZoomOut = !(viewRange[0] === 0 && viewRange[1] === 1);
  const canZoomIn = viewRange[1] - viewRange[0] > minViewSpan * 1.2;
  const zoomButtonStyle = {
    padding: '4px 8px',
    background: '#333',
    color: '#fff',
    border: '1px solid #555',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32
  };

  const tooltipPosition = (() => {
    if (!hoverInfo || !containerRef.current) {
      return null;
    }
    const bounds = containerRef.current.getBoundingClientRect();
    const offset = 12;
    const availableWidth = Math.max(bounds.width - 4, 0);
    const availableHeight = Math.max(bounds.height - 4, 0);
    const tooltipWidth = tooltipSize.width || 0;
    const tooltipHeight = tooltipSize.height || 0;
    let left = hoverInfo.pointer.x + offset;
    let top = hoverInfo.pointer.y + offset;

    if (left + tooltipWidth > availableWidth) {
      left = hoverInfo.pointer.x - offset - tooltipWidth;
    }
    if (left < 0) {
      left = 0;
    }

    if (top + tooltipHeight > availableHeight) {
      top = hoverInfo.pointer.y - offset - tooltipHeight;
    }
    if (top < 0) {
      top = 0;
    }

    return { left, top };
  })();

  return (
    <div ref={containerRef} style={{ width, height, padding: 10, position: 'relative' }}>
      {hoverInfo && tooltipPosition && (
        <div
          ref={hoverRef}
          style={{
            position: 'absolute',
            left: tooltipPosition.left,
            top: tooltipPosition.top,
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 12,
            pointerEvents: 'none'
          }}
        >
          <div>Time: {hoverInfo.timeLabel}</div>
          {hoverInfo.seriesValues.map(({ name, value }) => (
            <div key={name}>
              {name}: {value === null || value === undefined ? 'N/A' : value.toLocaleString()}
            </div>
          ))}
          <div>
            Correlation: {hoverInfo.correlation === null ? 'N/A' : hoverInfo.correlation.toFixed(3)}
          </div>
        </div>
      )}
      <h3 style={{ color: '#ddd' }}>
        Enes Bekdemir - 2025502000
      </h3>
      <h3 style={{ color: '#ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Rolling Pearson Correlation: {series[0].name} vs {series[1].name}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleZoomOut}
            disabled={!canZoomOut}
            style={{
              ...zoomButtonStyle,
              cursor: canZoomOut ? 'pointer' : 'not-allowed',
              opacity: canZoomOut ? 1 : 0.4
            }}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" fill="none" strokeWidth="1.5" />
              <line x1="4" y1="6.5" x2="9" y2="6.5" stroke="currentColor" strokeWidth="1.5" />
              <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={handleZoomIn}
            disabled={!canZoomIn}
            style={{
              ...zoomButtonStyle,
              cursor: canZoomIn ? 'pointer' : 'not-allowed',
              opacity: canZoomIn ? 1 : 0.4
            }}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" fill="none" strokeWidth="1.5" />
              <line x1="4" y1="6.5" x2="9" y2="6.5" stroke="currentColor" strokeWidth="1.5" />
              <line x1="6.5" y1="4" x2="6.5" y2="9" stroke="currentColor" strokeWidth="1.5" />
              <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={resetZoom}
            disabled={!canZoomOut}
            style={{
              padding: '4px 8px',
              background: '#333',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: 4,
              cursor: canZoomOut ? 'pointer' : 'not-allowed'
            }}
          >
            Reset zoom
          </button>
        </div>
      </h3>

      <div style={{ display: 'flex', gap: 16, marginBottom: 8, color: '#ddd', flexWrap: 'wrap' }}>
        {series.slice(0, 2).map((s, idx) => (
          <div key={`${s.name}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: getSeriesColor(idx),
                display: 'inline-block'
              }}
            />
            <span>{s.name}</span>
          </div>
        ))}
      </div>

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
              stroke={getSeriesColor(idx)}
              fill="none"
              strokeWidth={idx <= 1 ? 2 : 1}
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
        {firstSeriesTicks.length > 0 && (
          <g>
            <line x1={leftAxisX} y1={0} x2={leftAxisX} y2={seriesPlotHeight} stroke="#333" strokeWidth={1} />
            {firstSeriesTicks.map((tick, idx) => (
              <g key={`left-value-axis-${idx}`}>
                <line
                  x1={leftAxisX}
                  y1={tick.y}
                  x2={leftAxisX + 6}
                  y2={tick.y}
                  stroke={firstSeriesColor}
                  strokeWidth={1}
                />
                <text
                  x={leftAxisX + 8}
                  y={tick.y}
                  fill={firstSeriesColor}
                  fontSize={10}
                  textAnchor="start"
                  dominantBaseline="middle"
                >
                  {tick.label}
                </text>
              </g>
            ))}
          </g>
        )}
        {secondSeriesTicks.length > 0 && (
          <g>
            <line x1={rightAxisX} y1={0} x2={rightAxisX} y2={seriesPlotHeight} stroke="#333" strokeWidth={1} />
            {secondSeriesTicks.map((tick, idx) => (
              <g key={`right-value-axis-${idx}`}>
                <line
                  x1={rightAxisX - 6}
                  y1={tick.y}
                  x2={rightAxisX}
                  y2={tick.y}
                  stroke={secondSeriesColor}
                  strokeWidth={1}
                />
                <text
                  x={rightAxisX - 8}
                  y={tick.y}
                  fill={secondSeriesColor}
                  fontSize={10}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {tick.label}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>

      {/* --- Bottom chart: correlation --- */}
      <svg
        width={width}
        height={bottomHeight}
        style={{ background: '#222', cursor: 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {correlationPath && (
          <path
            d={correlationPath}
            stroke="#60cfff"
            strokeWidth={2}
            fill="none"
          />
        )}
        {selectionActive && (
          <rect
            x={selectionX}
            y={0}
            width={selectionWidth}
            height={corrPlotHeight}
            fill="rgba(255, 255, 255, 0.08)"
            stroke="#fff"
            strokeDasharray="4"
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
