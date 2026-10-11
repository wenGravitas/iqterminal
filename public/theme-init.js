/* Apply appearance before CSS/app startup, including the standalone licences page. */
(() => {
  let saved;
  try { saved = localStorage.getItem('basis.theme.v1'); } catch { /* Storage is optional. */ }
  let light = false;
  try { light = matchMedia('(prefers-color-scheme: light)').matches; } catch { /* Dark fallback. */ }
  const theme = saved === 'light' || saved === 'dark' ? saved : light ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f6f4ee' : '#080808');
})();
