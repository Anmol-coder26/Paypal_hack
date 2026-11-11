import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.resolve(process.cwd(), "public", "demo-kit");
fs.mkdirSync(OUT_DIR, { recursive: true });

function wallSvg(withScuff) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f3efe6"/>
      <stop offset="100%" stop-color="#dfd9ca"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0%" stop-color="#fffdf8" stop-opacity="0.65"/>
      <stop offset="65%" stop-color="#fffdf8" stop-opacity="0"/>
    </linearGradient>
    <filter id="blur" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="2"/>
    </filter>
  </defs>
  <rect width="800" height="600" fill="url(#wall)"/>
  <!-- Window frame on left -->
  <rect x="44" y="64" width="240" height="370" fill="#e5e1d6" stroke="#c8c2b2" stroke-width="4"/>
  <rect x="64" y="84" width="200" height="330" fill="#dbe6ee"/>
  <line x1="164" y1="84" x2="164" y2="414" stroke="#f5f3ec" stroke-width="10"/>
  <line x1="64" y1="248" x2="264" y2="248" stroke="#f5f3ec" stroke-width="10"/>
  <rect x="34" y="434" width="260" height="18" fill="#f7f5ee" stroke="#cbc5b5" stroke-width="2"/>
  <!-- Baseboard & oak floor -->
  <rect x="0" y="514" width="800" height="86" fill="#ebe7dc"/>
  <rect x="0" y="510" width="800" height="6" fill="#c7c0b0"/>
  <rect width="800" height="514" fill="url(#sun)"/>
  ${
    withScuff
      ? `<g opacity="0.88">
          <path d="M385 275 q42 -22 92 -10 q38 10 62 -8 q14 28 -20 44 q-52 24 -104 8 q-32 -10 -30 -34z" fill="#6f6a60" filter="url(#blur)"/>
          <path d="M402 278 l108 -14 M392 294 l126 -6 M416 306 l72 5" stroke="#47423a" stroke-width="3.5" stroke-linecap="round"/>
          <path d="M446 258 l-18 52" stroke="#5c564c" stroke-width="2" stroke-dasharray="4 3"/>
        </g>`
      : `<g opacity="0.16">
          <ellipse cx="458" cy="285" rx="95" ry="38" fill="#f7f4ec" filter="url(#blur)"/>
        </g>`
  }
  <g font-family="ui-monospace, Menlo, monospace" font-size="13">
    <rect x="16" y="16" width="320" height="28" rx="6" fill="#0b1324" opacity="0.82"/>
    <text x="28" y="35" fill="#f8fafc">${
      withScuff ? "DEMO KIT · PAINTING (BEFORE)" : "DEMO KIT · PAINTING (AFTER FIX)"
    }</text>
  </g>
</svg>`;
}

function tileSvg(flawedAfter) {
  let tiles = '<rect width="800" height="600" fill="#d5cfc2"/>';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = 36 + c * 184;
      const y = 38 + r * 98;
      const target = r === 2 && c === 1;
      if (target && flawedAfter) {
        tiles += `
          <g transform="rotate(2.2 ${x + 88} ${y + 44}) translate(-2 8)">
            <rect x="${x}" y="${y}" width="172" height="88" rx="3" fill="#f8f7f2" stroke="#dedad0" stroke-width="2"/>
            <rect x="${x}" y="${y}" width="172" height="16" rx="3" fill="#ffffff" opacity="0.6"/>
          </g>
          <!-- Wide dark unfilled grout gap on right joint -->
          <rect x="${x + 170}" y="${y}" width="13" height="98" fill="#3b362f"/>
          <rect x="${x}" y="${y - 4}" width="174" height="7" fill="#5b554c"/>
        `;
      } else {
        tiles += `
          <rect x="${x}" y="${y}" width="176" height="88" rx="3" fill="#f5f3ec" stroke="#e4e0d6" stroke-width="1.5"/>
          <rect x="${x}" y="${y}" width="176" height="16" rx="3" fill="#ffffff" opacity="0.55"/>
        `;
        if (target && !flawedAfter) {
          tiles += `
            <path d="M${x + 32} ${y + 6} l26 26 l-10 15 l34 22 l8 19" fill="none" stroke="#3f3a32" stroke-width="4" stroke-linejoin="round"/>
            <path d="M${x + 58} ${y + 32} l28 -12" fill="none" stroke="#4d473e" stroke-width="2.5" stroke-linecap="round"/>
          `;
        }
      }
    }
  }
  tiles += `
    <rect x="0" y="434" width="800" height="166" fill="#bfc3bf"/>
    <rect x="0" y="434" width="800" height="8" fill="#9ea39f"/>
    <ellipse cx="575" cy="520" rx="160" ry="38" fill="#aeb3af"/>
    <g font-family="ui-monospace, Menlo, monospace" font-size="13">
      <rect x="16" y="16" width="356" height="28" rx="6" fill="#0b1324" opacity="0.82"/>
      <text x="28" y="35" fill="#f8fafc">${
        flawedAfter ? "DEMO KIT · TILE (AFTER · GAP/TILT)" : "DEMO KIT · TILE (BEFORE · CRACKED)"
      }</text>
    </g>
  `;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">${tiles}</svg>`;
}

async function run() {
  const files = [
    ["painting-before.png", wallSvg(true)],
    ["painting-after.png", wallSvg(false)],
    ["tile-before.png", tileSvg(false)],
    ["tile-after-issue.png", tileSvg(true)],
  ];
  for (const [name, svg] of files) {
    await sharp(Buffer.from(svg)).png().toFile(path.join(OUT_DIR, name));
    console.log("Generated", path.join("public/demo-kit", name));
  }
}

run();
