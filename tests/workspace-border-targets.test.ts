import { expect, it } from 'vitest';
import { borderAtPoint } from '../src/workspaces/borders';
it('recognizes all four workspace edges without stealing central or external drops', () => {
 const rect={left:10,right:1010,top:20,bottom:720};
 expect(borderAtPoint(rect,12,300)).toBe('left');expect(borderAtPoint(rect,1008,300)).toBe('right');
 expect(borderAtPoint(rect,500,22)).toBe('top');expect(borderAtPoint(rect,500,718)).toBe('bottom');
 expect(borderAtPoint(rect,500,300)).toBeUndefined();expect(borderAtPoint(rect,9,300)).toBeUndefined();
 expect(borderAtPoint(rect,500,721)).toBeUndefined();
});
