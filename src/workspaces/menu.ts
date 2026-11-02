/** Native non-modal footer popup: one owned listener set, keyboard navigation and focus return. */
export class FooterMenu {
 readonly element=document.createElement('section');private abort=new AbortController();private anchor?:HTMLElement;
 constructor(label:string){this.element.className='terminal-menu';this.element.setAttribute('role','dialog');this.element.setAttribute('aria-label',label);this.element.hidden=true;document.body.append(this.element);
 const options={signal:this.abort.signal};document.addEventListener('pointerdown',event=>{if(!this.element.hidden&&!this.element.contains(event.target as Node)&&!this.anchor?.contains(event.target as Node))this.close();},{...options,capture:true});
 this.element.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close(true);return;}const items=[...this.element.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,a[href]')].filter(e=>!e.closest('[hidden]'));let index=items.indexOf(document.activeElement as HTMLElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&!(event.target instanceof HTMLInputElement&&event.key==='Home')){event.preventDefault();index=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length;items[index]?.focus();}},options);
 window.addEventListener('resize',()=>this.close(),options);}
 open(anchor:HTMLElement){this.anchor=anchor;this.element.hidden=false;anchor.setAttribute('aria-expanded','true');this.position();(this.element.querySelector('input,button,a') as HTMLElement|null)?.focus();}
 toggle(anchor:HTMLElement){if(this.element.hidden)this.open(anchor);else this.close(true);}
 position(){const rect=this.anchor?.getBoundingClientRect();if(!rect)return;this.element.style.left=`${Math.max(4,Math.min(innerWidth-this.element.offsetWidth-4,rect.left))}px`;this.element.style.bottom=`${Math.max(4,innerHeight-rect.top+4)}px`;}
 close(focus=false){this.element.hidden=true;this.anchor?.setAttribute('aria-expanded','false');if(focus&&this.anchor?.isConnected)this.anchor.focus();}
 dispose(){this.abort.abort();this.element.remove();}
}
export function action(label:string,run:()=>void){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=run;return button;}
