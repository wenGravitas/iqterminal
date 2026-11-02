import { drawingToolIconIds } from 'openalgo-charts/draw';

export const FOLDER_DRAWING_ICONS = drawingToolIconIds().map(id => `drawing:${id}`);
export const FOLDER_LETTER_ICONS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
export const FOLDER_NUMBER_ICONS = [...'0123456789'];
const icons = new Set([...FOLDER_DRAWING_ICONS, ...FOLDER_LETTER_ICONS, ...FOLDER_NUMBER_ICONS]);
export function isFolderSidebarIcon(value: unknown): value is string {
  return typeof value === 'string' && icons.has(value);
}
