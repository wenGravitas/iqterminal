export interface PanelStorage { getItem(key:string):string|null; setItem(key:string,value:string):void; removeItem(key:string):void }
let current:PanelStorage|undefined;
/** Only drawing documents/tree/sidebar records use this port; templates and account state stay global. */
export const workspacePanelStorage:PanelStorage={getItem:key=>current?current.getItem(key):localStorage.getItem(key),setItem:(key,value)=>current?current.setItem(key,value):localStorage.setItem(key,value),removeItem:key=>current?current.removeItem(key):localStorage.removeItem(key)};
export function bindWorkspacePanelStorage(storage:PanelStorage){current=storage;return()=>{if(current===storage)current=undefined;};}
