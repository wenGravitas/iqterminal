import type {LiquidationEvent,LiquidationCoverage} from './model';
import type {LiquidationSettings} from './settings';
import type {LiquidationBar,LiquidationBurst,liquidationSummary} from './engine';
export interface LiquidationRequest { settings:LiquidationSettings; from:number; to:number; intervalMs:number; kind:'ticker'|'chart'; replay?:boolean; asOf?:number }
export type LiquidationCommand = {type:'liquidation-subscribe';id:string;request:LiquidationRequest}|{type:'liquidation-update';id:string;request:LiquidationRequest}|{type:'liquidation-unsubscribe';id:string}|{type:'liquidation-ack';id:string;generation:number;batchId:number}|{type:'liquidation-fixture';events:LiquidationEvent[];live?:boolean};
export interface LiquidationBatch {type:'liquidation-batch';ids:string[];generation:number;batchId:number;events:LiquidationEvent[];bars:LiquidationBar[];summary:ReturnType<typeof liquidationSummary>;bursts:LiquidationBurst[];
 alerts:{event:LiquidationEvent;tierId:string}[];burstAlerts:LiquidationBurst[];coverage:LiquidationCoverage;state:'loading'|'live'|'stale'|'disconnected'|'unsupported';message:string;truncated:boolean;dropped:number;revision:number}
