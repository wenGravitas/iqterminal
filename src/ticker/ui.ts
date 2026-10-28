/** Small native controls shared by the two tape widgets and their settings. */
export function button(text:string,click:()=>void){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=click;return b;}
export function field(parent:HTMLElement,text:string,input:HTMLElement){const l=document.createElement('label');l.className='indicator-setting-field';const span=document.createElement('span');span.textContent=text;input.setAttribute('aria-label',text);l.append(span,input);parent.append(l);return input;}
