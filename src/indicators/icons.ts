/** Small authored controls share the terminal's existing 16px outline convention. */
export function indicatorIcon(action: string) {
  const paths: Record<string, string> = {
    visibility: 'M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    settings: 'M6 2h4l.4 1.5 1.5.8 1.5-.4 2 3-1.2 1.1v1l1.2 1.1-2 3-1.5-.4-1.5.8L10 15H6l-.4-1.5-1.5-.8-1.5.4-2-3L1.8 9V8L.6 6.9l2-3 1.5.4 1.5-.8L6 2Z M8 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
    pause: 'M4.5 3.5h2.4v9H4.5z M9.1 3.5h2.4v9H9.1z',
    play: 'M5 3.5v9L12.5 8 5 3.5Z',
    clear: 'M3 4.5h10 M5 4.5V3h6v1.5m-7 2v6.8h8V6.5M6.5 7.5v4m3-4v4',
    'audio-off': 'M2 6h2.5l3-2.5v9l-3-2.5H2z M10 6l4 4m0-4-4 4',
    audio: 'M2 6h2.5l3-2.5v9l-3-2.5H2z M10 6a3 3 0 0 1 0 4 M11.5 4.5a5 5 0 0 1 0 7',
    latest: 'M2.5 8h8 M7.5 4l4 4-4 4 M13.5 3v10',
    remove: 'M4 4l8 8M12 4l-8 8', duplicate: 'M5 5h9v9H5Z M2 10V2h8',
    source: 'M5 4L1 8l4 4 M11 4l4 4-4 4 M9 2L7 14',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 16 16'); svg.setAttribute('width','14'); svg.setAttribute('height','14'); svg.setAttribute('aria-hidden','true');
  const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',paths[action] ?? paths.settings!); path.setAttribute('fill','none'); path.setAttribute('stroke','currentColor'); path.setAttribute('stroke-width','1.2'); svg.append(path); return svg;
}
