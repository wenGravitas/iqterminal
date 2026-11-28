export type MonitoredFeedKind = 'chart' | 'candles' | 'cvd' | 'ticker' | 'comparison';
export type MonitoredFeedMode = 'direct' | 'recorded' | 'fixture';

/** A feed or chart status tied to an active client owner. */
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
  actions?: {id:string;label:string}[];
}
