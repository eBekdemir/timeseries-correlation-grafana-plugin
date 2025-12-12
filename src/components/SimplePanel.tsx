import React from 'react';
import { PanelProps } from '@grafana/data';

interface Props extends PanelProps {}

export const SimplePanel: React.FC<Props> = ({ data, width, height }) => {
  // Extract time-series values
  const series = data.series[0];

  if (!series || series.fields.length < 2) {
    return <div style={{ padding: 20 }}>No numeric data found.</div>;
  }

  const values = series.fields[1].values.toArray();

  if (!values.length) {
    return <div style={{ padding: 20 }}>No data values available.</div>;
  }

  // === STATISTICS ===
  const mean =
    values.reduce((a: number, b: number) => a + b, 0) / values.length;

  const sorted = [...values].sort((a: number, b: number) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const variance =
    values.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) /
    values.length;
  const std = Math.sqrt(variance);

  const min = Math.min(...values);
  const max = Math.max(...values);

  const current = values.at(-1);

  const trend =
    current > values[0]
      ? "Rising ↑"
      : current < values[0]
      ? "Falling ↓"
      : "Stable →";

  // === STYLE ===
  const container: React.CSSProperties = {
    padding: "20px",
    width,
    height,
    overflow: "auto",
    fontFamily: "monospace",
    background: "#111",
    color: "#eee",
    borderRadius: "8px",
    border: "1px solid #333",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: "20px",
    fontWeight: "bold",
    marginBottom: "15px",
    color: "#7dd3fc",
  };

  const statRow: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
    borderBottom: "1px solid #222",
    fontSize: "15px",
  };

  const footerStyle: React.CSSProperties = {
    marginTop: "20px",
    fontSize: "12px",
    opacity: 0.6,
    textAlign: "center",
  };

  return (
    <div style={container}>
      <div style={titleStyle}>Statistical Summary Panel</div>

      <div style={statRow}>
        <span>Mean</span>
        <span>{mean.toFixed(3)}</span>
      </div>

      <div style={statRow}>
        <span>Median</span>
        <span>{median.toFixed(3)}</span>
      </div>

      <div style={statRow}>
        <span>Std Deviation</span>
        <span>{std.toFixed(3)}</span>
      </div>

      <div style={statRow}>
        <span>Min</span>
        <span>{min}</span>
      </div>

      <div style={statRow}>
        <span>Max</span>
        <span>{max}</span>
      </div>

      <div style={statRow}>
        <span>Current</span>
        <span>{current}</span>
      </div>

      <div style={statRow}>
        <span>Trend</span>
        <span>{trend}</span>
      </div>

      <div style={footerStyle}>
        Developed by Enes Bekdemir - 2025502000
      </div>
    </div>
  );
};
