import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.addInitScript(() => {
    const state = window as any, NativeWorker = window.Worker;
    state.__matrixMessages = []; state.__matrixPaint = [];
    const fillRect = CanvasRenderingContext2D.prototype.fillRect, fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillRect = function(x,y,w,h) {
      if (this.canvas.classList.contains('depth-matrix-book')) state.__matrixPaint.push({kind:'rect',source:this.canvas.dataset.source,x,y,w,h,alpha:this.globalAlpha,color:this.fillStyle});
      return fillRect.call(this,x,y,w,h);
    };
    CanvasRenderingContext2D.prototype.fillText = function(text,x,y,max) {
      if (this.canvas.classList.contains('depth-matrix-book')) state.__matrixPaint.push({kind:'text',source:this.canvas.dataset.source,text,x,y,max,measured:this.measureText(text).width});
      return max === undefined ? fillText.call(this,text,x,y) : fillText.call(this,text,x,y,max);
    };
    class MatrixWorker extends NativeWorker {
      postMessage(message: any, transfer?: any) { if (message.type?.startsWith('depth-matrix')) state.__matrixMessages.push(message); super.postMessage(message,transfer); }
      set onmessage(handler: ((this:Worker,event:MessageEvent)=>unknown)|null) {
        super.onmessage = handler && (event => {
          if (event.data?.type !== 'depth-matrix-batch') { handler.call(this,event); return; }
          state.__matrixRaw = event.data;
          state.__matrixRefresh = () => {
            const data = structuredClone(state.__matrixRaw);
            for (const column of data.columns) {
              const override = state.__matrixOverrides?.[column.source];
              if (!override) continue;
              const rows = column.rows;
              Object.assign(column,override);
              column.rows = rows.map((row:any) => {
                const value = override.cells?.[row.low];
                if (!value) return row;
                return {...row,bidQuantity:value[0],askQuantity:value[1],bidNotional:value[0]*Number(row.low),askNotional:value[1]*Number(row.low)};
              });
            }
            handler.call(this,new MessageEvent('message',{data}));
          };
          state.__matrixRefresh();
        });
      }
      get onmessage() { return super.onmessage; }
    }
    Object.defineProperty(window,'Worker',{value:MatrixWorker,configurable:true,writable:true});
  });
  await page.goto('/?fixture=1');
  await page.getByRole('button',{name:'Depth Matrix',exact:true}).click();
  await expect(page.locator('.depth-matrix-price-row')).toHaveCount(160);
}
const panelState = (page:Page) => page.evaluate(() => {
  const p=(window as any).__terminal.dock.panels.find((p:any)=>p.view.contentComponent==='depth-matrix').view.content;
  return {...p.diagnostics(), anchor:p.rowLayout.anchor(p.scroll.scrollTop)};
});

test('reference source is persisted, stable, explicit when removed and never falls back on degradation', async ({page}) => {
  test.setTimeout(90_000);
  await setup(page);
  const matrix=page.locator('.depth-matrix-panel'), status=matrix.locator('.depth-matrix-status');
  await page.evaluate(() => { const s=window as any; s.__matrixOverrides={'binance-spot':{mid:'81679.125'},'binance-perpetual':{mid:'81750.25'}}; s.__matrixRefresh(); });
  await expect(status).toContainText('SPOT MID 81,679');
  await expect(status).toHaveAttribute('title',/81,679.125.*rounded to.*81,679/);
  const bucket=matrix.locator('.depth-matrix-price-row[data-price-range^="$81600"]');
  await expect(bucket).toHaveText('81,600');
  await expect(bucket).toHaveAttribute('aria-label',/81600.*81700.*81,679.125/);
  await matrix.getByRole('button',{name:'CENTER',exact:true}).click();
  await expect.poll(async ()=>(await panelState(page)).centeringViewport??null).toBeNull();
  const centered=()=>page.evaluate(() => {const p=(window as any).__terminal.dock.panels.find((p:any)=>p.view.contentComponent==='depth-matrix').view.content;return p.rows[p.rowLayout.at(p.scroll.scrollTop+p.scroll.clientHeight/2-24)].low;});
  await expect.poll(centered).toBe('81600');
  await page.evaluate(() => {const s=window as any;s.__matrixPaint=[];window.dispatchEvent(new Event('resize'));});
  await expect.poll(() => page.evaluate(() => (window as any).__matrixPaint.filter((p:any)=>p.kind==='rect'&&p.w===3&&p.h===6).length)).toBeGreaterThanOrEqual(2);
  const ownMarkers=await page.evaluate(() => {
    const p=(window as any).__terminal.dock.panels.find((p:any)=>p.view.contentComponent==='depth-matrix').view.content;
    return ['binance-spot','binance-perpetual'].map((source,index) => {
      const row=p.rowLayout.positions.find((r:any)=>r.index===String(816+index));
      const marker=(window as any).__matrixPaint.find((r:any)=>r.kind==='rect'&&r.source===source&&r.w===3&&r.h===6);
      return {actual:marker.y,expected:row.top+row.height/2-3};
    });
  });
  ownMarkers.forEach(marker=>expect(marker.actual).toBe(marker.expected));
  await matrix.getByRole('button',{name:'Depth Matrix settings'}).click();
  const reference=matrix.getByLabel('Reference midpoint source',{exact:true});
  await matrix.locator('.depth-matrix-source-setting').nth(1).locator('[title="Move column left"]').click();
  await expect(reference).toHaveValue('binance-spot');
  const before=await page.evaluate(() => (window as any).__matrixMessages.length);
  await reference.selectOption('binance-perpetual');
  await expect(status).toContainText('PERP MID 81,750');
  expect(await page.evaluate(() => (window as any).__matrixMessages.length)).toBe(before);
  for (const state of ['stale','syncing','disconnected','unavailable']) {
    await page.evaluate(state => {const s=window as any;s.__matrixOverrides['binance-perpetual']={mid:null,state};s.__matrixPaint=[];s.__matrixRefresh();},state);
    await expect(status).toContainText('PERP MID 81,750');
    await expect(status).toContainText(state.toUpperCase());
    await expect(matrix.getByRole('button',{name:'CENTER',exact:true})).toBeDisabled();
    await expect(matrix.locator('.depth-matrix-price-row[data-current=true]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__matrixPaint.some((p:any)=>p.source==='binance-perpetual'&&p.kind==='rect'&&p.w===3&&p.h===6))).toBe(false);
  }
  // Restore a live reference at an exact upper boundary.
  await page.evaluate(() => {const s=window as any;s.__matrixOverrides['binance-perpetual']={mid:'81700',state:'live'};s.__matrixRefresh();});
  await expect(matrix.locator('.depth-matrix-price-row[data-current=true]')).toHaveText('81,700');
  await expect(matrix.getByRole('button',{name:'CENTER',exact:true})).toBeEnabled();
  await expect.poll(() => page.evaluate(() => {const saved=JSON.parse(localStorage.getItem('basis.layout.v1')!);return (Object.values(saved.layout.panels) as any[]).find(p=>p.contentComponent==='depth-matrix').params.referenceSourceId;})).toBe('binance-perpetual');
  await page.reload();
  await page.locator('.depth-matrix-panel').getByRole('button',{name:'Depth Matrix settings'}).click();
  await expect(page.getByLabel('Reference midpoint source',{exact:true})).toHaveValue('binance-perpetual');
  await page.locator('.depth-matrix-source-setting').first().locator('[title="Remove source"]').click();
  await expect(page.getByLabel('Reference midpoint source',{exact:true})).toHaveValue('');
  await expect(status).toContainText('Choose reference');
  await expect(matrix.getByRole('button',{name:'CENTER',exact:true})).toBeDisabled();
  await expect.poll(() => page.evaluate(() => {
    const saved=JSON.parse(localStorage.getItem('basis.layout.v1')!);
    return (Object.values(saved.layout.panels) as any[]).find(p=>p.contentComponent==='depth-matrix').params.referenceSourceId;
  })).toBeNull();
  await page.reload();
  await expect(status).toContainText('Choose reference');
  // Simulate a saved legacy layout: migration follows its order once.
  await page.evaluate(() => {
    const saved=JSON.parse(localStorage.getItem('basis.layout.v1')!);
    const panel=(Object.values(saved.layout.panels) as any[]).find(p=>p.contentComponent==='depth-matrix');
    panel.params.sources=['binance-perpetual','binance-spot'];delete panel.params.referenceSourceId;
    localStorage.setItem('basis.layout.v1',JSON.stringify(saved));
  });
  await page.reload();
  await matrix.getByRole('button',{name:'Depth Matrix settings'}).click();
  await expect(page.getByLabel('Reference midpoint source',{exact:true})).toHaveValue('binance-perpetual');
  await matrix.locator('.depth-matrix-source-setting').nth(1).locator('[title="Move column left"]').click();
  await expect(page.getByLabel('Reference midpoint source',{exact:true})).toHaveValue('binance-perpetual');
  await expect.poll(() => page.evaluate(() => {
    const saved=JSON.parse(localStorage.getItem('basis.layout.v1')!);
    return (Object.values(saved.layout.panels) as any[]).find(p=>p.contentComponent==='depth-matrix').params.referenceSourceId;
  })).toBe('binance-perpetual');
  await page.reload();
  await matrix.getByRole('button',{name:'Depth Matrix settings'}).click();
  await expect(page.getByLabel('Reference midpoint source',{exact:true})).toHaveValue('binance-perpetual');
});

test('mixed rows share geometry, preserve scroll anchors, contract after delay and paint side-specific walls', async ({page}) => {
  test.setTimeout(90_000);
  await setup(page);
  const matrix=page.locator('.depth-matrix-panel'), mixed=matrix.locator('.depth-matrix-price-row[data-price-range^="$83500"]');
  await matrix.getByRole('button',{name:'Depth Matrix settings'}).click();
  await matrix.getByLabel('Wall threshold mode').selectOption('absolute');
  await matrix.getByLabel('Wall threshold',{exact:true}).fill('100');
  await matrix.getByLabel('Wall threshold',{exact:true}).press('Tab');
  await matrix.getByRole('button',{name:'Depth Matrix settings'}).click();
  await page.evaluate(() => {const s=window as any;s.__matrixOverrides={'binance-spot':{cells:{83500:[117,15.6]}},'binance-perpetual':{cells:{83500:[0,98.8]}}};s.__matrixPaint=[];s.__matrixRefresh();});
  await expect(mixed).toHaveCSS('height','36px');
  await expect.poll(() => page.evaluate(() => (window as any).__matrixPaint.some((p:any)=>p.kind==='text'&&p.text==='117'))).toBe(true);
  const geometry=await panelState(page), position=geometry.rowLayout.find((row:any)=>row.index==='835');
  const paints=await page.evaluate(() => (window as any).__matrixPaint);
  const side=(text:string,source='binance-spot')=>paints.filter((p:any)=>p.kind==='text'&&p.source===source&&p.text===text).at(-1);
  expect(side('15.6').y).toBeLessThan(side('117').y);
  const bar=(source:string,y:number)=>paints.filter((p:any)=>p.kind==='rect'&&p.source===source&&p.w>1&&p.y===y).at(-1);
  expect(bar('binance-spot',position.top+2).alpha).toBe(.36);
  expect(bar('binance-spot',position.top+19).alpha).toBe(.5);
  expect(side('98.8','binance-perpetual').y).toBe(position.top+18);
  // Hover all strips and verify the same absolute bucket and shared highlight.
  for (const y of [1,17,18,35]) {
    await matrix.locator('.depth-matrix-book').first().evaluate((canvas,{top,y})=>{const r=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+30,clientY:r.top+top+y,bubbles:true}));},{top:position.top,y});
    await expect(matrix.locator('.depth-matrix-tooltip')).toContainText('$83500–$83600');
    await expect(matrix.locator('.depth-matrix-hover-line')).toHaveCSS('height','36px');
    await expect(mixed).toHaveAttribute('data-hovered','true');
  }
  const anchorBefore=(await panelState(page)).anchor;
  // Expand a row above the viewport in only Perp; every column must move together.
  await page.evaluate(() => {const s=window as any;s.__matrixOverrides['binance-perpetual'].cells['89000']=[1,1];s.__matrixRefresh();});
  await expect(matrix.locator('.depth-matrix-price-row[data-price-range^="$89000"]')).toHaveCSS('height','36px');
  expect((await panelState(page)).anchor).toEqual(anchorBefore);
  await page.evaluate(() => {const s=window as any;s.__matrixOverrides['binance-perpetual'].cells['89000']=[1,0];s.__matrixRefresh();});
  await expect(matrix.locator('.depth-matrix-price-row[data-price-range^="$89000"]')).toHaveCSS('height','36px');
  await expect(matrix.locator('.depth-matrix-price-row[data-price-range^="$89000"]')).toHaveCSS('height','28px',{timeout:3000});
  expect((await panelState(page)).anchor).toEqual(anchorBefore);
  // Global quote override changes labels, never bar geometry or BTC wall thresholds.
  const widths=paints.filter((p:any)=>p.kind==='rect'&&p.source==='binance-spot'&&[position.top+2,position.top+19].includes(p.y)).map((p:any)=>p.w);
  await page.getByRole('button',{name:'Global settings',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Global settings'});
  await dialog.getByLabel('Override indicator currencies').check();
  await dialog.getByLabel('Default display currency').selectOption('quote');
  await page.evaluate(()=>{(window as any).__matrixPaint=[];});
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(matrix.locator('.depth-matrix-book').first()).toHaveAttribute('aria-label',/cell labels use USDT/);
  const quotePaint=await page.evaluate(()=>(window as any).__matrixPaint);
  expect(quotePaint.some((p:any)=>p.kind==='text'&&p.text==='9.77m')).toBe(true);
  expect(quotePaint.filter((p:any)=>p.kind==='rect'&&p.source==='binance-spot'&&[position.top+2,position.top+19].includes(p.y)).map((p:any)=>p.w)).toEqual(widths);
});
