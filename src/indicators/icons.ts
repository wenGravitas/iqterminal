/** Small authored controls share the terminal's existing 16px outline convention. */
export function indicatorIcon(action: string) {
  const paths: Record<string, string> = {
    visibility: 'M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    settings: 'M6 2h4l.4 1.5 1.5.8 1.5-.4 2 3-1.2 1.1v1l1.2 1.1-2 3-1.5-.4-1.5.8L10 15H6l-.4-1.5-1.5-.8-1.5.4-2-3L1.8 9V8L.6 6.9l2-3 1.5.4 1.5-.8L6 2Z M8 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
    remove: 'M4 4l8 8M12 4l-8 8', duplicate: 'M5 5h9v9H5Z M2 10V2h8',
    source: 'M5 4L1 8l4 4 M11 4l4 4-4 4 M9 2L7 14',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 16 16'); svg.setAttribute('aria-hidden','true');
  const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',paths[action] ?? paths.settings!); path.setAttribute('fill','none'); path.setAttribute('stroke','currentColor'); path.setAttribute('stroke-width','1.2'); svg.append(path); return svg;
}
