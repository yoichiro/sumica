// Small visual: an SVG-like <div> shaped to reflect a real width:height ratio,
// used both in the aspect-ratio picker (ControlPanel) and in the ranking rows
// (RankingPanel) so the two surfaces stay visually consistent.
//
// The longest side always fits inside `maxEdge` px, and the other side is
// scaled down to preserve the true aspect ratio. Colors are configurable so
// the same component can sit inside a plain panel (default pop-blue accent)
// or inside a filled/active button (caller passes white lines over the fill).

export interface AspectRatioRectProps {
  width: number;
  height: number;
  maxEdge?: number;
  borderColor?: string;
  background?: string;
  borderWidth?: number;
}

export function AspectRatioRect({
  width,
  height,
  maxEdge = 32,
  borderColor = 'var(--pop-blue)',
  background = 'rgba(51, 154, 240, 0.12)',
  borderWidth = 1.5,
}: AspectRatioRectProps) {
  if (width <= 0 || height <= 0) return null;
  const rectWidth = width >= height ? maxEdge : Math.round(maxEdge * (width / height));
  const rectHeight = height >= width ? maxEdge : Math.round(maxEdge * (height / width));
  return (
    <div
      aria-hidden="true"
      style={{
        width: `${rectWidth}px`,
        height: `${rectHeight}px`,
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: 3,
        background,
        flexShrink: 0,
      }}
    />
  );
}
