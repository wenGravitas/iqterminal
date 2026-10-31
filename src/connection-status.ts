import { ConnectionActivityLog, summarizeMonitoredFeeds, type ConnectionActivity } from './connection-status-model';
import type { MonitoredFeedStatus } from './feed/observed-status';
import type { FeedClient } from './feed/client';
import { getDisplayTimezone, TIMEZONE_EVENT } from './timezone';

const el = <T extends HTMLElement>(tag: string, className?: string) => {
  const node = document.createElement(tag) as T;
  if (className) node.className = className;
  return node;
};

const stateText = (state: string) => state === 'ready' ? 'Live' : state.slice(0, 1).toUpperCase() + state.slice(1);

function ageText(lastUpdate: number, now: number) {
  if (!lastUpdate) return 'No data update yet';
  const seconds = Math.max(0, Math.floor((now - lastUpdate) / 1000));
  if (seconds < 2) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ${seconds % 60}s ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ${minutes % 60}m ago`;
}

function timeText(at: number, zone: string) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: zone }).format(at);
}

interface FeedRowView {
  row: HTMLElement; label: HTMLElement; source: HTMLElement; mode: HTMLElement;
  state: HTMLElement; age: HTMLTimeElement; message: HTMLElement;
}
interface ActivityRowView { row: HTMLElement; time: HTMLTimeElement; heading: HTMLElement; detail: HTMLElement }

/** A native-DOM summary for the subscribed feed types that publish production status events. */
export class ConnectionStatusController {
  private trigger: HTMLButtonElement;
  private popover: HTMLElement;
  private summaryNode: HTMLElement;
  private feedList: HTMLElement;
  private activityList: HTMLElement;
  private activityCount: HTMLElement;
  private closeButton: HTMLButtonElement;
  private statuses: readonly MonitoredFeedStatus[] = [];
  private online = navigator.onLine;
  private timeZone = getDisplayTimezone();
  private readonly activity = new ConnectionActivityLog();
  private readonly abort = new AbortController();
  private releaseStatuses: (() => void) | undefined;
  private readonly feedRows = new Map<string, FeedRowView>();
  private feedEmpty?: HTMLElement;
  private readonly activityRows = new Map<string, ActivityRowView>();
  private activityEmpty?: HTMLElement;

  constructor(private readonly feed: FeedClient, private readonly fixtureMode: boolean, private readonly dismissOtherPopup: () => void) {
    this.trigger = document.querySelector<HTMLButtonElement>('#connection-status-trigger')!;
    this.popover = document.querySelector<HTMLElement>('#connection-status-popover')!;
    this.summaryNode = this.popover.querySelector<HTMLElement>('[data-connection-summary]')!;
    this.feedList = this.popover.querySelector<HTMLElement>('[data-connection-feeds]')!;
    this.activityList = this.popover.querySelector<HTMLElement>('[data-connection-activity]')!;
    this.activityCount = this.popover.querySelector<HTMLElement>('[data-connection-activity-count]')!;
    this.closeButton = this.popover.querySelector<HTMLButtonElement>('[data-connection-close]')!;

    const options = { signal: this.abort.signal };
    this.trigger.addEventListener('click', () => this.isOpen() ? this.close(true) : this.open(), options);
    this.closeButton.addEventListener('click', () => this.close(true), options);
    this.popover.querySelector<HTMLButtonElement>('[data-connection-clear]')!.addEventListener('click', () => {
      this.activity.clear();
      this.renderActivity();
    }, options);
    for (const eventName of ['pointerdown', 'click'] as const) {
      document.addEventListener(eventName, event => {
        if (this.isOpen() && event.target instanceof Node && !this.popover.contains(event.target) && !this.trigger.contains(event.target)) this.close(false);
      }, options);
    }
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.isOpen()) { event.preventDefault(); event.stopPropagation(); this.close(true); }
    }, { ...options, capture: true });
    window.addEventListener('online', () => { this.online = true; this.statusChanged(); }, options);
    window.addEventListener('offline', () => { this.online = false; this.statusChanged(); }, options);
    window.addEventListener(TIMEZONE_EVENT, event => {
      this.timeZone = (event as CustomEvent<{ zone?: string }>).detail?.zone ?? getDisplayTimezone();
      const zone=this.popover.querySelector<HTMLElement>('[data-connection-timezone]')!;
      if(zone.textContent!==this.timeZone)zone.textContent = this.timeZone;
      if (this.isOpen() && !document.hidden) this.renderActivity();
    }, options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      this.renderTrigger();
      if (this.isOpen()) this.render();
    }, options);
    this.releaseStatuses = this.feed.subscribeFeedStatuses(statuses => {
      this.statuses = statuses;
      this.activity.update(statuses, this.online);
      if (!document.hidden) {
        this.renderTrigger();
        if (this.isOpen()) this.render();
      }
    });
    this.renderTrigger();
  }

  isOpen() { return !this.popover.hidden; }

  /** Called when Market Pulse opens, so the two footer popovers cannot overlap. */
  dismissForOtherPopup() { this.close(false); }

  /** Refreshes the visible relative ages without polling or copying feed status arrays. */
  refreshAges(now = Date.now()) {
    if (!this.isOpen() || document.hidden) return;
    for (const view of this.feedRows.values()) {
      const text=ageText(Number(view.age.dataset.lastUpdate),now);
      if(view.age.textContent!==text)view.age.textContent=text;
    }
  }

  dispose() {
    this.abort.abort();
    this.releaseStatuses?.();
    this.releaseStatuses = undefined;
    this.popover.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
  }

  private statusChanged() {
    this.activity.update(this.statuses, this.online);
    if (document.hidden) return;
    this.renderTrigger();
    if (this.isOpen()) this.render();
  }

  private open() {
    this.statuses = this.feed.feedStatusSnapshot();
    this.activity.update(this.statuses, this.online);
    this.dismissOtherPopup();
    this.popover.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.render();
    this.refreshAges();
    this.closeButton.focus();
  }

  private close(restoreFocus: boolean) {
    if (!this.isOpen()) return;
    this.popover.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.trigger.focus();
  }

  private renderTrigger() {
    const summary = summarizeMonitoredFeeds(this.statuses, this.online, this.fixtureMode);
    const accessible = `Connection status: ${summary.label}`;
    if(this.trigger.dataset.state!==summary.state)this.trigger.dataset.state = summary.state;
    if(this.trigger.getAttribute('aria-label')!==accessible)this.trigger.setAttribute('aria-label', accessible);
    const title=`${accessible} · Open monitored feed details`;
    if(this.trigger.title!==title)this.trigger.title=title;
    const label=this.trigger.querySelector<HTMLElement>('[data-connection-state]')!;
    if(label.textContent!==summary.label)label.textContent = summary.label;
    const expanded=String(this.isOpen());if(this.trigger.getAttribute('aria-expanded')!==expanded)this.trigger.setAttribute('aria-expanded',expanded);
  }

  private render() {
    const summary = summarizeMonitoredFeeds(this.statuses, this.online, this.fixtureMode);
    if(this.popover.dataset.state!==summary.state)this.popover.dataset.state = summary.state;
    if(this.summaryNode.dataset.state!==summary.state)this.summaryNode.dataset.state = summary.state;
    if(this.summaryNode.textContent!==summary.label)this.summaryNode.textContent = summary.label;
    const zone=this.popover.querySelector<HTMLElement>('[data-connection-timezone]')!;
    if(zone.textContent!==this.timeZone)zone.textContent = this.timeZone;
    this.renderFeeds();
    this.renderActivity();
  }

  private renderFeeds(){
    const rows=[...this.statuses].sort((a,b)=>a.source.localeCompare(b.source)||a.label.localeCompare(b.label));
    const active=new Set(rows.map(status=>status.key));
    for(const [key,view]of this.feedRows)if(!active.has(key)){view.row.remove();this.feedRows.delete(key);}
    if(!rows.length){
      for(const view of this.feedRows.values())view.row.remove();
      this.feedRows.clear();
      this.feedEmpty??=el<HTMLParagraphElement>('p','connection-status-empty');
      if(this.feedEmpty.textContent!=='No candle, CVD, ticker or comparison feed is currently subscribed.')this.feedEmpty.textContent='No candle, CVD, ticker or comparison feed is currently subscribed.';
      if(this.feedList.firstElementChild!==this.feedEmpty)this.feedList.insertBefore(this.feedEmpty,this.feedList.firstChild);
      return;
    }
    this.feedEmpty?.remove();
    const ordered:HTMLElement[]=[];
    for(const status of rows){
      let view=this.feedRows.get(status.key);
      if(!view){view=this.createFeedRow();this.feedRows.set(status.key,view);}
      this.updateFeedRow(view,status);
      ordered.push(view.row);
    }
    this.orderChildren(this.feedList,ordered);
  }

  private createFeedRow():FeedRowView {
    const row = el<HTMLDivElement>('div', 'connection-feed-row');
    row.setAttribute('role', 'listitem');
    const identity = el<HTMLDivElement>('div', 'connection-feed-identity');
    const label = el<HTMLElement>('strong', 'connection-feed-label');
    const source = el<HTMLElement>('span', 'connection-feed-source');
    const mode = el<HTMLElement>('span', 'connection-feed-mode');
    identity.append(label, source, mode);
    const detail = el<HTMLDivElement>('div', 'connection-feed-detail');
    const state = el<HTMLElement>('span', 'connection-feed-state');
    const age = el<HTMLTimeElement>('time', 'connection-feed-age');
    const message = el<HTMLElement>('span', 'connection-feed-message');
    detail.append(state, age, message);
    row.append(identity, detail);
    return {row,label,source,mode,state,age,message};
  }

  private updateFeedRow(view:FeedRowView,status:MonitoredFeedStatus,now=Date.now()){
    if(view.row.dataset.state!==status.state)view.row.dataset.state=status.state;
    if(view.label.textContent!==status.label)view.label.textContent=status.label;
    if(view.source.textContent!==status.source)view.source.textContent=status.source;
    if(view.mode.textContent!==status.mode)view.mode.textContent=status.mode;
    view.mode.hidden=!status.mode;
    if(view.state.textContent!==stateText(status.state))view.state.textContent=stateText(status.state);
    if(view.state.dataset.state!==status.state)view.state.dataset.state=status.state;
    const lastUpdate=String(status.lastUpdate);
    if(view.age.dataset.lastUpdate!==lastUpdate)view.age.dataset.lastUpdate=lastUpdate;
    const iso=status.lastUpdate>0?new Date(status.lastUpdate).toISOString():'';
    if(iso){if(view.age.dateTime!==iso)view.age.dateTime=iso;}else view.age.removeAttribute('datetime');
    const age=ageText(status.lastUpdate,now);if(view.age.textContent!==age)view.age.textContent=age;
    const message=status.message||'The source has not supplied a status message.';
    if(view.message.textContent!==message)view.message.textContent=message;
  }

  private renderActivity() {
    const rows = this.activity.snapshot();
    const count=`${rows.length} / 100`;if(this.activityCount.textContent!==count)this.activityCount.textContent=count;
    const occurrences=new Map<string,number>(),keyed=rows.map(activity=>{
      const base=JSON.stringify([activity.at,activity.source,activity.label,activity.from,activity.to,activity.detail]);
      const occurrence=occurrences.get(base)??0;occurrences.set(base,occurrence+1);return {activity,key:`${base}:${occurrence}`};
    });
    const active=new Set(keyed.map(item=>item.key));
    for(const [key,view]of this.activityRows)if(!active.has(key)){view.row.remove();this.activityRows.delete(key);}
    if(!keyed.length){
      for(const view of this.activityRows.values())view.row.remove();
      this.activityRows.clear();
      this.activityEmpty??=el<HTMLParagraphElement>('p','connection-activity-empty');
      if(this.activityEmpty.textContent!=='No observed state changes in this run.')this.activityEmpty.textContent='No observed state changes in this run.';
      if(this.activityList.firstElementChild!==this.activityEmpty)this.activityList.insertBefore(this.activityEmpty,this.activityList.firstChild);
      return;
    }
    this.activityEmpty?.remove();
    const ordered:HTMLElement[]=[];
    for(const {activity,key}of keyed){
      let view=this.activityRows.get(key);
      if(!view){view=this.createActivityRow();this.activityRows.set(key,view);}
      this.updateActivityRow(view,activity);
      ordered.push(view.row);
    }
    this.orderChildren(this.activityList,ordered);
  }

  private createActivityRow():ActivityRowView {
    const row = el<HTMLDivElement>('div', 'connection-activity-row');
    row.setAttribute('role', 'listitem');
    const time = el<HTMLTimeElement>('time');
    const heading = el<HTMLElement>('strong');
    const detail = el<HTMLElement>('span');
    row.append(time, heading, detail);
    return {row,time,heading,detail};
  }

  private updateActivityRow(view:ActivityRowView,activity:ConnectionActivity){
    const iso=new Date(activity.at).toISOString();if(view.time.dateTime!==iso)view.time.dateTime=iso;
    const time=timeText(activity.at,this.timeZone);if(view.time.textContent!==time)view.time.textContent=time;
    const heading=`${activity.label} · ${activity.from} → ${activity.to}`;
    if(view.heading.textContent!==heading)view.heading.textContent=heading;
    if(view.detail.textContent!==activity.detail)view.detail.textContent=activity.detail;
  }

  private orderChildren(container:HTMLElement,ordered:HTMLElement[]){
    ordered.forEach((node,index)=>{const current=container.children[index];if(current!==node)container.insertBefore(node,current??null);});
  }
}
