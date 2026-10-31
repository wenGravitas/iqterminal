export type MonitoredFeedKind = 'candles' | 'cvd' | 'ticker' | 'comparison';
export type MonitoredFeedMode = 'direct' | 'recorded' | 'fixture';

/** A worker-reported status tied to an active client subscription. */
export interface MonitoredFeedStatus {
  key: string;
  kind: MonitoredFeedKind;
  source: string;
  label: string;
  mode: MonitoredFeedMode;
  state: string;
  message: string;
  lastUpdate: number;
  observed: boolean;
}
