import { DEFAULT_TPO_SETTINGS, TPO_ENGINE_VERSION, type TpoSettings } from './tpo-engine';

export const DEFAULT_TPO_DISPLAY = {
  showProfile: true,
  profileMode: 'adaptive' as const,
  profileWidthPercent: 70,
  profileOpacity: 55,
  shadeValueArea: true,
  highlightPoc: true,
  theme: 'chart' as const,
  profileColor: '#8191a1',
  pocColor: '#e1bb62',
  valueAreaColor: '#86a4c5',
  profileLevelsExtend: true,
  pocLineVisible: true,
  vahLineVisible: true,
  valLineVisible: true,
  pocLineStyle: 'solid' as const,
  vahLineStyle: 'dashed' as const,
  valLineStyle: 'dashed' as const,
  levelLineThickness: 1,
  openingRangeEnabled: true,
  openingRangeShade: true,
  openingRangeExtend: true,
  openingRangeHighVisible: true,
  openingRangeLowVisible: true,
  openingRangeLineStyle: 'solid' as const,
  openingRangeColor: '#57a88b',
  openingRangeThickness: 1,
  openingRangeOpacity: 62,
  initialBalanceEnabled: true,
  initialBalanceExtend: true,
  initialBalanceMidpoint: false,
  initialBalanceShade: false,
  initialBalanceHighVisible: true,
  initialBalanceLowVisible: true,
  initialBalanceLineStyle: 'dashed' as const,
  initialBalanceColor: '#6299c7',
  initialBalanceThickness: 1,
  initialBalanceOpacity: 62,
  projectionHalf: false,
  projectionFull: false,
  nakedEnabled: true,
  nakedDays: 90,
  nakedPoc: true,
  nakedVah: true,
  nakedVal: true,
  nakedActiveOnly: false,
  testedLevels: 'fade' as const,
  nakedLabels: 'age-price' as const,
  nakedPocColor: '#e1bb62',
  nakedVahColor: '#57a88b',
  nakedValColor: '#d56b76',
  nakedPocLineStyle: 'dashed' as const,
  nakedVahLineStyle: 'dotted' as const,
  nakedValLineStyle: 'dotted' as const,
  nakedLineThickness: 1,
} as const;

export interface TpoIndicatorSettings extends TpoSettings {
  showProfile: boolean;
  profileMode: 'adaptive' | 'letters' | 'blocks';
  profileWidthPercent: number;
  profileOpacity: number;
  shadeValueArea: boolean;
  highlightPoc: boolean;
  theme: 'chart' | 'dark' | 'light';
  profileColor: string;
  pocColor: string;
  valueAreaColor: string;
  profileLevelsExtend: boolean;
  pocLineVisible: boolean;
  vahLineVisible: boolean;
  valLineVisible: boolean;
  pocLineStyle: 'solid' | 'dashed' | 'dotted';
  vahLineStyle: 'solid' | 'dashed' | 'dotted';
  valLineStyle: 'solid' | 'dashed' | 'dotted';
  levelLineThickness: number;
  openingRangeEnabled: boolean;
  openingRangeShade: boolean;
  openingRangeExtend: boolean;
  openingRangeHighVisible: boolean;
  openingRangeLowVisible: boolean;
  openingRangeLineStyle: 'solid' | 'dashed' | 'dotted';
  openingRangeColor: string;
  openingRangeThickness: number;
  openingRangeOpacity: number;
  initialBalanceEnabled: boolean;
  initialBalanceExtend: boolean;
  initialBalanceMidpoint: boolean;
  initialBalanceShade: boolean;
  initialBalanceHighVisible: boolean;
  initialBalanceLowVisible: boolean;
  initialBalanceLineStyle: 'solid' | 'dashed' | 'dotted';
  initialBalanceColor: string;
  initialBalanceThickness: number;
  initialBalanceOpacity: number;
  projectionHalf: boolean;
  projectionFull: boolean;
  nakedEnabled: boolean;
  nakedDays: number;
  nakedPoc: boolean;
  nakedVah: boolean;
  nakedVal: boolean;
  nakedActiveOnly: boolean;
  testedLevels: 'show' | 'fade' | 'hide';
  nakedLabels: 'off' | 'age' | 'price' | 'age-price';
  nakedPocColor: string;
  nakedVahColor: string;
  nakedValColor: string;
  nakedPocLineStyle: 'solid' | 'dashed' | 'dotted';
  nakedVahLineStyle: 'solid' | 'dashed' | 'dotted';
  nakedValLineStyle: 'solid' | 'dashed' | 'dotted';
  nakedLineThickness: number;
}

const cssColor = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;
const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
const color = (value: unknown, fallback: string) => typeof value === 'string' && cssColor.test(value) ? value : fallback;
const lineStyle = (value: unknown, fallback: 'solid' | 'dashed' | 'dotted') => value === 'solid' || value === 'dashed' || value === 'dotted' ? value : fallback;

export function tpoIndicatorSettings(value: unknown, tickSize = DEFAULT_TPO_SETTINGS.tickSize): TpoIndicatorSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const bracketMinutes = raw.bracketMinutes === 15 || raw.bracketMinutes === 60 ? raw.bracketMinutes : 30;
  const rowTicks = raw.rowTicks === 'auto' ? 'auto' : Number.isSafeInteger(raw.rowTicks) ? number(raw.rowTicks, 1, 1, 1_000_000) : 'auto';
  return {
    tickSize: number(raw.tickSize, tickSize, Number.MIN_VALUE, 1_000_000),
    bracketMinutes,
    rowTicks,
    valueAreaPercent: number(raw.valueAreaPercent, 70, 1, 100),
    openingRangeMinutes: number(raw.openingRangeMinutes, 30, 1, 1_440),
    openingRangeMidpoint: bool(raw.openingRangeMidpoint, false),
    initialBalanceMinutes: number(raw.initialBalanceMinutes, 60, 1, 1_440),
    initialBalanceCompletedOnly: bool(raw.initialBalanceCompletedOnly, false),
    showProfile: bool(raw.showProfile, true),
    profileMode: raw.profileMode === 'letters' || raw.profileMode === 'blocks' ? raw.profileMode : 'adaptive',
    profileWidthPercent: number(raw.profileWidthPercent, 70, 5, 100),
    profileOpacity: number(raw.profileOpacity, 55, 0, 100),
    shadeValueArea: bool(raw.shadeValueArea, true),
    highlightPoc: bool(raw.highlightPoc, true),
    theme: raw.theme === 'dark' || raw.theme === 'light' ? raw.theme : 'chart',
    profileColor: color(raw.profileColor, DEFAULT_TPO_DISPLAY.profileColor),
    pocColor: color(raw.pocColor, DEFAULT_TPO_DISPLAY.pocColor),
    valueAreaColor: color(raw.valueAreaColor, DEFAULT_TPO_DISPLAY.valueAreaColor),
    profileLevelsExtend: bool(raw.profileLevelsExtend, true),
    pocLineVisible: bool(raw.pocLineVisible, true), vahLineVisible: bool(raw.vahLineVisible, true), valLineVisible: bool(raw.valLineVisible, true),
    pocLineStyle: lineStyle(raw.pocLineStyle, 'solid'), vahLineStyle: lineStyle(raw.vahLineStyle, 'dashed'), valLineStyle: lineStyle(raw.valLineStyle, 'dashed'),
    levelLineThickness: number(raw.levelLineThickness, 1, 1, 4),
    openingRangeEnabled: bool(raw.openingRangeEnabled, true),
    openingRangeShade: bool(raw.openingRangeShade, true),
    openingRangeExtend: bool(raw.openingRangeExtend, true),
    openingRangeHighVisible: bool(raw.openingRangeHighVisible, true), openingRangeLowVisible: bool(raw.openingRangeLowVisible, true),
    openingRangeLineStyle: lineStyle(raw.openingRangeLineStyle, 'solid'),
    openingRangeColor: color(raw.openingRangeColor, DEFAULT_TPO_DISPLAY.openingRangeColor),
    openingRangeThickness: number(raw.openingRangeThickness, 1, 1, 4),
    openingRangeOpacity: number(raw.openingRangeOpacity, 62, 0, 100),
    initialBalanceEnabled: bool(raw.initialBalanceEnabled, true),
    initialBalanceExtend: bool(raw.initialBalanceExtend, true),
    initialBalanceMidpoint: bool(raw.initialBalanceMidpoint, false), initialBalanceShade: bool(raw.initialBalanceShade, false),
    initialBalanceHighVisible: bool(raw.initialBalanceHighVisible, true), initialBalanceLowVisible: bool(raw.initialBalanceLowVisible, true),
    initialBalanceLineStyle: lineStyle(raw.initialBalanceLineStyle, 'dashed'),
    initialBalanceColor: color(raw.initialBalanceColor, DEFAULT_TPO_DISPLAY.initialBalanceColor),
    initialBalanceThickness: number(raw.initialBalanceThickness, 1, 1, 4),
    initialBalanceOpacity: number(raw.initialBalanceOpacity, 62, 0, 100),
    projectionHalf: bool(raw.projectionHalf, false),
    projectionFull: bool(raw.projectionFull, false),
    nakedEnabled: bool(raw.nakedEnabled, true),
    nakedDays: number(raw.nakedDays, 90, 1, 90),
    nakedPoc: bool(raw.nakedPoc, true),
    nakedVah: bool(raw.nakedVah, true),
    nakedVal: bool(raw.nakedVal, true),
    nakedActiveOnly: bool(raw.nakedActiveOnly, false),
    testedLevels: raw.testedLevels === 'show' || raw.testedLevels === 'hide' ? raw.testedLevels : 'fade',
    nakedLabels: raw.nakedLabels === 'off' || raw.nakedLabels === 'age' || raw.nakedLabels === 'price' ? raw.nakedLabels : 'age-price',
    nakedPocColor: color(raw.nakedPocColor, DEFAULT_TPO_DISPLAY.nakedPocColor),
    nakedVahColor: color(raw.nakedVahColor, DEFAULT_TPO_DISPLAY.nakedVahColor),
    nakedValColor: color(raw.nakedValColor, DEFAULT_TPO_DISPLAY.nakedValColor),
    nakedPocLineStyle: lineStyle(raw.nakedPocLineStyle, 'dashed'), nakedVahLineStyle: lineStyle(raw.nakedVahLineStyle, 'dotted'), nakedValLineStyle: lineStyle(raw.nakedValLineStyle, 'dotted'),
    nakedLineThickness: number(raw.nakedLineThickness, 1, 1, 4),
  };
}

export const DEFAULT_TPO_INDICATOR_SETTINGS: TpoIndicatorSettings = tpoIndicatorSettings({ ...DEFAULT_TPO_SETTINGS, ...DEFAULT_TPO_DISPLAY });

/** Fields that alter UTC profile calculations or the retained naked-level model. */
export function tpoCalculationKey(settings: TpoSettings): string {
  return `${TPO_ENGINE_VERSION}:${JSON.stringify({ tickSize: settings.tickSize, bracketMinutes: settings.bracketMinutes, rowTicks: settings.rowTicks, valueAreaPercent: settings.valueAreaPercent, openingRangeMinutes: settings.openingRangeMinutes, initialBalanceMinutes: settings.initialBalanceMinutes, nakedDays: settings.nakedDays ?? 90 })}`;
}
