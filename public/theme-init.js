/* Apply appearance before CSS/app startup, including the standalone licences page. */
(() => {
  let saved;
  try { saved = localStorage.getItem('basis.theme.v1'); } catch { /* Storage is optional. */ }
  let light = false;
  try { light = matchMedia('(prefers-color-scheme: light)').matches; } catch { /* Dark fallback. */ }
  const theme = saved === 'light' || saved === 'dark' || saved === 'terminal' || saved === 'ios' ? saved : light ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'light' || theme === 'ios' ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'ios' ? '#f2f2f7' : theme === 'light' ? '#f6f4ee' : theme === 'terminal' ? '#000000' : '#080808');
})();
