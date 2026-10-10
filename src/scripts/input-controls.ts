import type { ScriptInputView } from './host';

export function makeInputControl(view: ScriptInputView, setting: string | number | boolean | undefined) {
  const value = setting ?? view.defaultValue;
  if (view.kind === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
    return input;
  }
  if (view.options.length) {
    const select = document.createElement('select');
    for (const option of view.options) select.add(new Option(String(option), String(option)));
    select.value = String(value ?? '');
    return select;
  }
  if (view.kind === 'source') {
    const select = document.createElement('select');
    for (const source of [
      'open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'volume',
      'iq_depth_bid_base_v1', 'iq_depth_ask_base_v1', 'iq_depth_bid_quote_v1', 'iq_depth_ask_quote_v1',
    ]) select.add(new Option(source, source));
    select.value = String(value ?? 'close');
    return select;
  }
  const input = document.createElement('input');
  if (view.kind === 'color' && typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) input.type = 'color';
  else if (typeof value === 'number') input.type = 'number';
  else input.type = 'text';
  input.value = String(value ?? '');
  if (view.min !== null) input.min = String(view.min);
  if (view.max !== null) input.max = String(view.max);
  if (view.step !== null) input.step = String(view.step);
  return input;
}

export function readInputSettings(container: ParentNode): Record<string, string | number | boolean> {
  const settings: Record<string, string | number | boolean> = {};
  for (const control of container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-input-key]')) {
    const type = (control as HTMLInputElement).type;
    settings[control.dataset.inputKey!] = type === 'checkbox' ? (control as HTMLInputElement).checked
      : type === 'number' || type === 'range' ? Number(control.value) : control.value;
  }
  return settings;
}
