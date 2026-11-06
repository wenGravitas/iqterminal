import {expect,test} from '@playwright/test';
import {addIndicator} from './indicator-actions';

test('optional settings construct on first open and keep current data/status',async({page})=>{
 test.setTimeout(60000);
 await page.goto('/?fixture=1&fixtureTime=now');
 await page.waitForFunction(()=>(window as any).__terminal?.panels.size>0);
 const panel=page.locator('.candle-panel').first();
 const tpo=panel.locator('dialog.tpo-settings'),totals=panel.locator('dialog.footprint-totals-settings');
 await expect(tpo).toHaveCount(0);await expect(totals).toHaveCount(0);
 await addIndicator(panel,'UTC TPO Profile');
 await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].tpoSessions.size)).toBeGreaterThan(0);
 // Data and status arrive before the settings controls exist.
 await expect(tpo).toHaveCount(0);
 const status=await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].tpoStatus.message);
 const tpoButton=panel.getByRole('button',{name:'UTC TPO Profile settings',exact:true});
 await tpoButton.click();await expect(tpo).toBeVisible();await expect(tpo.locator('.dialog-status')).toContainText(status);
 await tpo.getByRole('button',{name:'Close',exact:true}).click();
 await tpoButton.click();await expect(tpo).toHaveCount(1);await expect(tpo).toBeVisible();
 await tpo.getByRole('button',{name:'Close',exact:true}).click();
 await addIndicator(panel,'Footprint Totals');
 await expect(totals).toHaveCount(0);
 const totalsButton=panel.getByRole('button',{name:'Footprint Totals settings',exact:true});
 await totalsButton.click();await expect(totals).toBeVisible();
 await totals.getByLabel('Highlight highest value in each row',{exact:true}).uncheck();
 await totals.getByRole('button',{name:'Apply',exact:true}).click();
 await totalsButton.click();await expect(totals).toHaveCount(1);
 await expect(totals.getByLabel('Highlight highest value in each row',{exact:true})).not.toBeChecked();
 // Disposal works whether or not the other restored charts opened settings.
 await page.evaluate(()=>{for(const p of (window as any).__terminal.panels.values())p.dispose();});
 await expect(page.locator('dialog[open].tpo-settings,dialog[open].footprint-totals-settings')).toHaveCount(0);
});
