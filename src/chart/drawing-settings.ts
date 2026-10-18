import {
  INTERVAL_FIELDS, applyDrawingSettings, composeSettings, drawingSettingsSchema,
  readDrawingSettings, type Drawing, type DrawingPatch, type SettingsSchema,
} from 'openalgo-charts/draw';

export const IQ_DRAWING_META_VERSION = 1;

const iqMetadataFields = [
  { path: 'props.iqterminalLabelState', label: 'Label mode', kind: 'select' as const, options: [
    { value: 'unset', label: 'Use tool name' }, { value: 'custom', label: 'Custom label' },
  ], defaultValue: 'unset' },
  { path: 'props.iqterminalLabel', label: 'Drawing label', kind: 'text' as const, defaultValue: '' },
  { path: 'props.iqterminalAnalysisInterval', label: 'Analysis interval', kind: 'interval' as const, defaultValue: '' },
];

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

export function captureDrawingSettings(drawing: Drawing, schema = iqDrawingSettingsSchema(drawing.tool)) {
  const values = readDrawingSettings(drawing, schema);
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<string, string | number | boolean | { ratio: number; color?: string; enabled?: boolean; label?: string }[]>;
}

export function drawingDisplayName(drawing: Drawing, fallback: string) {
  if (drawing.props?.iqterminalLabelState !== 'custom') return fallback;
  const label = typeof drawing.props.iqterminalLabel === 'string' ? drawing.props.iqterminalLabel : '';
  return label.length ? label : '(blank label)';
}
