import type {Page} from '@playwright/test';
export interface WallBenchmarkReference {from:number;to:number;sourceFrom:number;sourceTo:number;sourceToken:string}
export interface WallBenchmarkSourceRequest {market:'spot'|'perpetual';profile:string;from:number;to:number}
export interface WallBenchmarkSourcePreflight {kind:'wall-benchmark-source-preflight-v1';state:'eligible'|'refused';reason?:string;detail?:string;request:WallBenchmarkSourceRequest;expectedToken:string;proof?:Record<string,unknown>;ms:number;jobsRequested:false}
export function wallBenchmarkSourceRequest(market:'spot'|'perpetual',reference:WallBenchmarkReference):WallBenchmarkSourceRequest;
export function wallBenchmarkPreflight(base:string,market:'spot'|'perpetual',reference:WallBenchmarkReference,options?:{fetcher?:typeof fetch;signal?:AbortSignal}):Promise<WallBenchmarkSourcePreflight>;
export function openColdWallBenchmarkPanel(page:Page,id:string,params:Record<string,unknown>):Promise<{start:number;historyViewport:unknown}>;
