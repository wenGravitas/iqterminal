import {
  INTERVAL_FIELDS, applyDrawingSettings, composeSettings, drawingSettingsSchema,
  getDrawingTool, readDrawingSettings, type Drawing, type DrawingPatch, type SettingsSchema,
} from 'openalgo-charts/draw';
import { DEFAULT_THEME, type ChartTheme } from 'openalgo-charts';

export const IQ_DRAWING_META_VERSION = 1;

const iqMetadataFields = [
  { path: 'props.iqterminalLabelState', label: 'Label mode', kind: 'select' as const, options: [
    { value: 'unset', label: 'Use tool name' }, { value: 'custom', label: 'Custom label' },
  ], defaultValue: 'unset' },
  { path: 'props.iqterminalLabel', label: 'Drawing label', kind: 'text' as const, defaultValue: '' },
  { path: 'props.iqterminalAnalysisInterval', label: 'Analysis interval', kind: 'interval' as const, defaultValue: '' },
];

const defaultFontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const defaultLineWidth = 1.5;
const defaultFillOpacity = 0.12;

type SettingsPalette = Pick<ChartTheme, 'lineColor' | 'background' | 'upColor' | 'downColor'>;

/** Native tool fields plus the app's history-aware timeframe and label fields. */
export function iqDrawingSettingsSchema(tool: string): SettingsSchema {
  const native = drawingSettingsSchema(tool);
  return composeSettings([native.fields, INTERVAL_FIELDS, iqMetadataFields], { textIsContent: native.textIsContent });
}

/** Host-authored metadata is kept in props and included in native history snapshots. */
export function initialDrawingMetadata(drawing: Drawing, analysisInterval = ''): DrawingPatch {
  return { props: {
    ...drawing.props,
    iqterminal: { version: IQ_DRAWING_META_VERSION },
    iqterminalLabelState: 'unset',
    iqterminalLabel: '',
    iqterminalAnalysisInterval: analysisInterval,
  } };
}

/** Build one native update patch; geometry, identity and pane remain untouched. */
export function drawingSettingsPatch(
  drawing: Drawing,
  values: Record<string, unknown>,
  schema = iqDrawingSettingsSchema(drawing.tool),
  options: { textColorExplicit?: boolean } = {},
): DrawingPatch {
  const patch = applyDrawingSettings(drawing, values, schema);
  const result: DrawingPatch = {
    ...patch,
    ...(patch.props ? { props: {
      ...drawing.props,
      ...patch.props,
      iqterminal: { version: IQ_DRAWING_META_VERSION },
    } } : {}),
  };
  if (options.textColorExplicit !== undefined) result.props = {
    ...drawing.props,
    ...(patch.props ?? {}),
    iqterminal: { version: IQ_DRAWING_META_VERSION },
    iqterminalLabelTextColorExplicit: options.textColorExplicit,
  };
  return result;
}

export function captureDrawingSettings(
  drawing: Drawing,
  schema = iqDrawingSettingsSchema(drawing.tool),
  palette: Partial<SettingsPalette> = {},
) {
  const values = readDrawingSettings(drawing, schema);
  const theme = { ...DEFAULT_THEME, ...palette };
  const tool = getDrawingTool(drawing.tool);
  for (const field of schema.fields) {
    if (values[field.path] !== undefined) continue;
    const value = effectiveDefault(drawing, field.path, tool?.defaultStyle, tool?.defaultText, theme);
    if (value !== undefined) values[field.path] = cloneSettingValue(value);
  }
  return values;
}

function effectiveDefault(
  drawing: Drawing,
  path: string,
  defaultStyle: NonNullable<ReturnType<typeof getDrawingTool>>['defaultStyle'],
  defaultText: NonNullable<ReturnType<typeof getDrawingTool>>['defaultText'],
  palette: SettingsPalette,
) {
  const [root, key] = path.split('.');
  if (!key) return undefined;
  const styleDefaults = defaultStyle ?? {};
  const textDefaults = defaultText ?? {};
  const hasPerLevelColors = Array.isArray(styleDefaults.levels) && styleDefaults.levels.length > 1;
  const color = drawing.style.color ?? styleDefaults.color ?? palette.lineColor;

  if (root === 'intervals') return '';
  if (root === 'style') {
    const toolDefault = (styleDefaults as Record<string, unknown>)[key];
    if (toolDefault !== undefined) return toolDefault;
    switch (key) {
      case 'color': return palette.lineColor;
      case 'lineWidth': return defaultLineWidth;
      case 'lineStyle': return 'solid';
      case 'fill': return false;
      case 'fillColor': return hasPerLevelColors ? undefined : color;
      case 'fillOpacity': return defaultFillOpacity;
      case 'showLabels': return true;
      case 'extendLeft':
      case 'extendRight':
      case 'showStats':
      case 'pressure': return false;
      default: return undefined;
    }
  }
  if (root === 'text') {
    const toolDefault = (textDefaults as Record<string, unknown>)[key];
    if (toolDefault !== undefined) return toolDefault;
    switch (key) {
      case 'value': return '';
      case 'color':
        if (hasPerLevelColors) return undefined;
        if (drawing.tool === 'long-position' || drawing.tool === 'short-position') return contrastingText(palette.background);
        return color;
      case 'fontSize': return 11;
      case 'fontFamily': return defaultFontFamily;
      case 'bold':
      case 'italic':
      case 'wrap':
      case 'background':
      case 'border': return false;
      case 'align': return 'left';
      case 'valign': return 'top';
      case 'wrapWidth': return 220;
      case 'backgroundColor': return palette.background;
      case 'backgroundOpacity': return 1;
      case 'borderColor': return color;
      case 'position': return 'inside';
      default: return undefined;
    }
  }
  if (root === 'props') {
    switch (key) {
      case 'showHeader':
      case 'showLossSize':
      case 'showTargetLabel':
      case 'showStopLabel': return true;
      case 'showPrices': return false;
      case 'profitColor': return palette.upColor;
      case 'lossColor': return palette.downColor;
      default: return undefined;
    }
  }
  return undefined;
}

function cloneSettingValue(value: unknown): unknown {
  return Array.isArray(value) ? value.map(item => item && typeof item === 'object' ? { ...item } : item) : value;
}

function contrastingText(background: string) {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(background.trim());
  if (!match) return '#ffffff';
  const hex = match[1]!;
  const channels = hex.length === 3
    ? [...hex].map(channel => Number.parseInt(channel + channel, 16))
    : [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(channels[0]!) + 0.7152 * linear(channels[1]!) + 0.0722 * linear(channels[2]!);
  return luminance > 0.45 ? '#10131a' : '#ffffff';
}

export function drawingDisplayName(drawing: Drawing, fallback: string) {
  if (drawing.props?.iqterminalLabelState !== 'custom') return fallback;
  const label = typeof drawing.props.iqterminalLabel === 'string' ? drawing.props.iqterminalLabel : '';
  return label.length ? label : '(blank label)';
}

/** Compare parsed form values while treating the UI's empty representation as unchanged when a path was omitted. */
export function sameDrawingSetting(value: unknown, baseline: unknown) {
  if (baseline === undefined && (value === '' || (Array.isArray(value) && value.length === 0))) return true;
  if (Object.is(value, baseline)) return true;
  if (value === null || baseline === null || typeof value !== 'object' || typeof baseline !== 'object') return false;
  try { return JSON.stringify(value) === JSON.stringify(baseline); } catch { return false; }
}
