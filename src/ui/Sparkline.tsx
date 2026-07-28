import { getScoreHistory } from "../lib/run-history";

export function Sparkline({
  modelKey,
  width = 24,
  height = 8,
  className,
}: {
  modelKey: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const points = getScoreHistory(modelKey);
  if (points.length < 2) return null;

  const max = 5;
  const stepX = width / Math.max(1, points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * stepX} ${height - (p / max) * height}`)
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`shrink-0 ${className ?? ""}`} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function exportText(filename: string, content: string, mimeType = "text/markdown") {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportJson(filename: string, data: unknown) {
  exportText(filename, JSON.stringify(data, null, 2), "application/json");
}
