import type { DrawingPoint, ScreenPoint } from 'openalgo-charts/draw';
import type { IQDrawingTemplateRepository, IQDrawingTemplateSettings } from './drawing-templates';
export const MAX_BRUSH_ANCHORS = 512;
/** Native freehand already uses RDP. Cap its retained time/price samples as a final bound. */
export function boundedBrushPoints(points: readonly DrawingPoint[]): DrawingPoint[] { if (points.length <= MAX_BRUSH_ANCHORS) return points.map(point => ({ ...point })); return Array.from({ length: MAX_BRUSH_ANCHORS }, (_, index) => ({ ...points[Math.round(index * (points.length - 1) / (MAX_BRUSH_ANCHORS - 1))]! })); }
export function extendedRectanglePoints(points: readonly ScreenPoint[], width: number): ScreenPoint[] { const next = points.map(point => ({ ...point })); if (next.length < 2) return next; const right = next[0]!.x > next[1]!.x ? 0 : 1; next[right]!.x = Math.max(next[right]!.x, width); return next; }
const preset = (name: string, tool: string, nativeValues: Record<string, unknown>, label = '') => ({ name, tool, settings: { nativeValues, label: { present: Boolean(label), value: label }, textColorExplicit: false, analysisInterval: null, visibility: { visible: true, intervals: null } } satisfies IQDrawingTemplateSettings });
export const EVERYDAY_DRAWING_PRESETS = [
  preset('Yellow outlined zone', 'rectangle', { 'style.color': '#d4b55e', 'style.lineWidth': 1, 'style.fill': false, 'style.fillOpacity': 0, 'style.extendRight': true }),
  preset('Blue shaded zone', 'rectangle', { 'style.color': '#8da9c1', 'style.lineWidth': 1, 'style.fill': true, 'style.fillColor': '#8da9c1', 'style.fillOpacity': .14, 'style.extendRight': true }),
  preset('Weekly level', 'horizontal-line', { 'style.color': '#858585', 'style.lineWidth': 1, 'style.lineStyle': 'dashed', 'style.showLabels': true }, 'Weekly level'),
  preset('Pulled-wall note', 'callout', { 'style.color': '#858585', 'text.fontSize': 11 }, 'Pulled wall'),
  preset('Red scenario path', 'path', { 'style.color': '#ad5858', 'style.lineWidth': 1.5 }),
] as const;
export function installEverydayPresets(repository: IQDrawingTemplateRepository) { let added = 0; for (const preset of EVERYDAY_DRAWING_PRESETS) { const catalog = repository.load(); if (catalog.templates.some(item => item.tool === preset.tool && item.name.toLocaleLowerCase() === preset.name.toLocaleLowerCase())) continue; repository.saveTemplate(preset.name, preset.tool, preset.settings); added++; } return { added, catalog: repository.load() }; }
