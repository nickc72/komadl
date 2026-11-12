export interface PlateSpec {
  id: string;
  aspect: 'portrait' | 'spread';
  motif: 'railway-signal' | 'tunnel-dawn' | 'botanical-specimen' | 'conservatory-dome' | 'spiral-stairs' | 'bathymetry-chart' | 'astrolabe-sounding' | 'basalt-beacon' | 'night-cab' | 'bridge-crossing';
  sealKanji: string;
  pageNumber: number;
}

export function renderMangaPlateSvg(spec: PlateSpec): string {
  const width = spec.aspect === 'spread' ? 1600 : 900;
  const height = spec.aspect === 'spread' ? 900 : 1280;
  const pad = 44;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const defs = `
    <defs>
      <pattern id="tone-${spec.id}" width="8" height="8" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1.15" fill="#1b1917" />
        <circle cx="6" cy="6" r="0.85" fill="#1b1917" />
      </pattern>
      <pattern id="tone-dense-${spec.id}" width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="1.5" cy="1.5" r="1.35" fill="#181614" />
        <circle cx="4.5" cy="4.5" r="1.2" fill="#181614" />
      </pattern>
      <pattern id="hatch-${spec.id}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
        <line x1="0" y1="0" x2="0" y2="10" stroke="#1b1917" stroke-width="1.3" />
      </pattern>
    </defs>
  `;

  let bodyArt = '';

  if (spec.motif === 'railway-signal' || spec.motif === 'night-cab') {
    const topH = Math.round(innerH * 0.42);
    const botY = pad + topH + 22;
    const botH = innerH - topH - 22;
    const midSplit = Math.round(innerW * 0.52);

    bodyArt = `
      <!-- Top panel: Signal tower against night sky -->
      <rect x="${pad}" y="${pad}" width="${innerW}" height="${topH}" fill="#161412" stroke="#111" stroke-width="4" />
      <circle cx="${pad + innerW * 0.78}" cy="${pad + topH * 0.28}" r="42" fill="#f3ede0" />
      <circle cx="${pad + innerW * 0.80}" cy="${pad + topH * 0.26}" r="36" fill="#161412" />
      <polygon points="${pad},${pad + topH} ${pad + innerW * 0.34},${pad + topH * 0.44} ${pad + innerW * 0.62},${pad + topH}" fill="url(#tone-dense-${spec.id})" />
      <rect x="${pad + innerW * 0.24}" y="${pad + 38}" width="26" height="${topH - 38}" fill="#111" />
      <rect x="${pad + innerW * 0.24 - 46}" y="${pad + 76}" width="118" height="44" fill="#1e1b18" stroke="#f3ede0" stroke-width="2.5" />
      <circle cx="${pad + innerW * 0.24 + 13}" cy="${pad + 98}" r="13" fill="#c83e2b" />

      <!-- Bottom left panel: Telegraph & timetable mechanical detail -->
      <rect x="${pad}" y="${botY}" width="${midSplit - 11}" height="${botH}" fill="#f4efe4" stroke="#111" stroke-width="4" />
      <rect x="${pad + 18}" y="${botY + 18}" width="${midSplit - 47}" height="${botH - 36}" fill="url(#tone-${spec.id})" />
      <circle cx="${pad + (midSplit - 11) / 2}" cy="${botY + botH * 0.5}" r="118" fill="#f4efe4" stroke="#111" stroke-width="4" />
      <circle cx="${pad + (midSplit - 11) / 2}" cy="${botY + botH * 0.5}" r="102" fill="none" stroke="#111" stroke-width="1.5" stroke-dasharray="6 8" />
      <line x1="${pad + (midSplit - 11) / 2}" y1="${botY + botH * 0.5}" x2="${pad + (midSplit - 11) / 2 + 58}" y2="${botY + botH * 0.5 - 64}" stroke="#111" stroke-width="4.5" stroke-linecap="round" />
      <line x1="${pad + (midSplit - 11) / 2}" y1="${botY + botH * 0.5}" x2="${pad + (midSplit - 11) / 2 - 42}" y2="${botY + botH * 0.5 - 24}" stroke="#c83e2b" stroke-width="3.5" stroke-linecap="round" />
      <circle cx="${pad + (midSplit - 11) / 2}" cy="${botY + botH * 0.5}" r="8" fill="#111" />

      <!-- Bottom right panel: Converging iron rails -->
      <rect x="${pad + midSplit + 11}" y="${botY}" width="${innerW - midSplit - 11}" height="${botH}" fill="#ede6d6" stroke="#111" stroke-width="4" />
      <rect x="${pad + midSplit + 11}" y="${botY}" width="${innerW - midSplit - 11}" height="${botH * 0.45}" fill="url(#hatch-${spec.id})" />
      <line x1="${pad + midSplit + (innerW - midSplit) * 0.5}" y1="${botY + botH * 0.35}" x2="${pad + midSplit + 32}" y2="${botY + botH}" stroke="#111" stroke-width="5" />
      <line x1="${pad + midSplit + (innerW - midSplit) * 0.5}" y1="${botY + botH * 0.35}" x2="${pad + innerW - 32}" y2="${botY + botH}" stroke="#111" stroke-width="5" />
      <line x1="${pad + midSplit + (innerW - midSplit) * 0.35}" y1="${botY + botH * 0.55}" x2="${pad + midSplit + (innerW - midSplit) * 0.65}" y2="${botY + botH * 0.55}" stroke="#111" stroke-width="3" />
      <line x1="${pad + midSplit + (innerW - midSplit) * 0.25}" y1="${botY + botH * 0.72}" x2="${pad + midSplit + (innerW - midSplit) * 0.75}" y2="${botY + botH * 0.72}" stroke="#111" stroke-width="4" />
      <line x1="${pad + midSplit + (innerW - midSplit) * 0.14}" y1="${botY + botH * 0.9}" x2="${pad + midSplit + (innerW - midSplit) * 0.86}" y2="${botY + botH * 0.9}" stroke="#111" stroke-width="5" />
    `;
  } else if (spec.aspect === 'spread') {
    const midX = width / 2;
    bodyArt = `
      <!-- Full wide double-page architectural/landscape ink spread -->
      <rect x="${pad}" y="${pad}" width="${innerW}" height="${innerH}" fill="#efe9da" stroke="#111" stroke-width="4.5" />
      <rect x="${pad}" y="${pad}" width="${innerW}" height="${innerH * 0.54}" fill="url(#tone-${spec.id})" />
      <!-- Dramatic perspective arches / mountain horizon across spread -->
      <path d="M ${pad} ${pad + innerH * 0.66} Q ${width * 0.28} ${pad + innerH * 0.22}, ${midX} ${pad + innerH * 0.48} T ${width - pad} ${pad + innerH * 0.32} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z" fill="url(#hatch-${spec.id})" stroke="#111" stroke-width="3.5" />
      <!-- Viaduct / Conservatory / Nautical horizon bridge spanning both pages -->
      <line x1="${pad}" y1="${pad + innerH * 0.58}" x2="${width - pad}" y2="${pad + innerH * 0.58}" stroke="#111" stroke-width="8" />
      <line x1="${pad}" y1="${pad + innerH * 0.61}" x2="${width - pad}" y2="${pad + innerH * 0.61}" stroke="#f4efe4" stroke-width="2.5" />
      ${Array.from({ length: 9 })
        .map((_, idx) => {
          const x = pad + 80 + idx * ((innerW - 160) / 8);
          return `<path d="M ${x - 55} ${height - pad} L ${x - 55} ${pad + innerH * 0.61} A 55 48 0 0 1 ${x + 55} ${pad + innerH * 0.61} L ${x + 55} ${height - pad}" fill="#171513" stroke="#111" stroke-width="3" />`;
        })
        .join('')}
      <!-- Center binding gutter shadow hint -->
      <line x1="${midX}" y1="${pad}" x2="${midX}" y2="${height - pad}" stroke="#111" stroke-opacity="0.28" stroke-width="2" />
      <circle cx="${width * 0.82}" cy="${pad + innerH * 0.24}" r="46" fill="#c83e2b" opacity="0.88" />
    `;
  } else {
    const row1 = Math.round(innerH * 0.34);
    const row2 = Math.round(innerH * 0.31);
    const row3 = innerH - row1 - row2 - 40;
    const y2 = pad + row1 + 20;
    const y3 = y2 + row2 + 20;

    bodyArt = `
      <!-- Panel 1: Architectural canopy crosshatching -->
      <rect x="${pad}" y="${pad}" width="${innerW}" height="${row1}" fill="#f4efe4" stroke="#111" stroke-width="4" />
      <rect x="${pad}" y="${pad}" width="${innerW}" height="${row1}" fill="url(#tone-${spec.id})" />
      ${Array.from({ length: 6 })
        .map((_, i) => {
          const x = pad + (i + 1) * (innerW / 7);
          return `<line x1="${x}" y1="${pad}" x2="${pad + innerW * 0.5}" y2="${pad + row1}" stroke="#111" stroke-width="3" />`;
        })
        .join('')}
      <circle cx="${pad + innerW * 0.5}" cy="${pad + row1 * 0.45}" r="74" fill="#f4efe4" stroke="#111" stroke-width="4" />
      <circle cx="${pad + innerW * 0.5}" cy="${pad + row1 * 0.45}" r="52" fill="url(#hatch-${spec.id})" stroke="#111" stroke-width="2.5" />

      <!-- Panel 2: Split dynamic focus panels -->
      <rect x="${pad}" y="${y2}" width="${innerW * 0.44}" height="${row2}" fill="#181614" stroke="#111" stroke-width="4" />
      <circle cx="${pad + innerW * 0.22}" cy="${y2 + row2 * 0.5}" r="68" fill="none" stroke="#f4efe4" stroke-width="3" />
      <polygon points="${pad + innerW * 0.22},${y2 + 34} ${pad + innerW * 0.27},${y2 + row2 - 34} ${pad + innerW * 0.22},${y2 + row2 * 0.64} ${pad + innerW * 0.17},${y2 + row2 - 34}" fill="#c83e2b" />

      <rect x="${pad + innerW * 0.44 + 20}" y="${y2}" width="${innerW * 0.56 - 20}" height="${row2}" fill="#efe9da" stroke="#111" stroke-width="4" />
      <rect x="${pad + innerW * 0.44 + 38}" y="${y2 + 18}" width="${innerW * 0.56 - 56}" height="${row2 - 36}" fill="url(#hatch-${spec.id})" stroke="#111" stroke-width="2" />

      <!-- Panel 3: Wide dramatic silhouette -->
      <rect x="${pad}" y="${y3}" width="${innerW}" height="${row3}" fill="#f4efe4" stroke="#111" stroke-width="4" />
      <path d="M ${pad} ${y3 + row3} L ${pad} ${y3 + row3 * 0.48} Q ${pad + innerW * 0.45} ${y3 + row3 * 0.18}, ${pad + innerW} ${y3 + row3 * 0.56} L ${pad + innerW} ${y3 + row3} Z" fill="#181614" />
      <circle cx="${pad + innerW * 0.76}" cy="${y3 + row3 * 0.34}" r="22" fill="#c83e2b" />
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${defs}
  <rect width="${width}" height="${height}" fill="#f4efe3" />
  ${bodyArt}
  <!-- Vermilion hanko stamp & folio number -->
  <g>
    <rect x="${width - pad - 54}" y="${height - pad - 58}" width="42" height="46" rx="4" fill="#f4efe3" stroke="#b93825" stroke-width="2.5" />
    <text x="${width - pad - 33}" y="${height - pad - 27}" text-anchor="middle" font-family="serif" font-size="24" font-weight="700" fill="#b93825">${spec.sealKanji}</text>
    <text x="${pad + 6}" y="${height - 14}" font-family="monospace" font-size="15" fill="#4a453e">${String(spec.pageNumber).padStart(3, '0')}</text>
  </g>
</svg>`;
}
