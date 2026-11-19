import { expect, it } from 'vitest';
import { startingLayout, duplicateWorkspace, newWorkspace, validatedLayout } from '../src/workspaces/model';
it('preserves optional borders and remaps their panel IDs when duplicating', () => {
 const layout=startingLayout(), id=Object.keys(layout.panels)[0]!;
 layout.grid.root={type:'branch',data:[],size:700};
 layout.edgeGroups={right:{size:310,visible:true,collapsed:true,group:{id:'workspace-border-right',views:[id],activeView:id}}};
 expect(validatedLayout(layout)).toEqual(layout);
 const copy=duplicateWorkspace(newWorkspace('Source',layout),'Copy');
 const next=Object.keys(copy.layout.panels)[0]!;
 expect(next).not.toBe(id);expect(copy.layout.edgeGroups?.right?.group).toEqual({id:'workspace-border-right',views:[next],activeView:next});
});
it('accepts legacy layouts and rejects invalid border references without mutating input', () => {
 const layout=startingLayout();expect(validatedLayout(layout)).toEqual(layout);
 const before=JSON.stringify(layout);
 for(const edgeGroups of [{moon:{}},{left:{size:-1,visible:true}},{left:{size:200,visible:true,group:{id:'left',views:['missing']}}}]) {
  expect(()=>validatedLayout({...layout,edgeGroups})).toThrow();
 }
 expect(JSON.stringify(layout)).toBe(before);
});
