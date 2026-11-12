import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.resolve(process.cwd(), "public", "demo-kit");
fs.mkdirSync(OUT_DIR, { recursive: true });

function badge(text) {
  return `<g font-family="ui-monospace, Menlo, monospace" font-size="13">
    <rect x="16" y="16" width="388" height="28" rx="6" fill="#0b1324" opacity="0.84"/>
    <text x="28" y="35" fill="#f8fafc">${text}</text>
  </g>`;
}

function wallPaintSvg(variant) {
  let detail;
  let label = "DEMO KIT · PAINTING (AFTER · UNIFORM)";
  if (variant === "before") {
    label = "DEMO KIT · PAINTING (BEFORE · SCUFFS)";
    detail = `<g opacity="0.9">
      <path d="M385 275 q42 -22 92 -10 q38 10 62 -8 q14 28 -20 44 q-52 24 -104 8 q-32 -10 -30 -34z" fill="#6f6a60" filter="url(#blur)"/>
      <path d="M402 278 l108 -14 M392 294 l126 -6 M416 306 l72 5" stroke="#47423a" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M446 258 l-18 52" stroke="#5c564c" stroke-width="2" stroke-dasharray="4 3"/>
    </g>`;
  } else if (variant === "uneven") {
    label = "DEMO KIT · PAINTING (AFTER · UNEVEN)";
    detail = `<g>
      <rect x="355" y="218" width="215" height="132" rx="14" fill="#fbf9f3" opacity="0.72" filter="url(#blur)"/>
      <rect x="288" y="164" width="22" height="118" rx="4" fill="#b7b0a0" opacity="0.65"/>
      <path d="M412 290 l92 -8" stroke="#cfc8b8" stroke-width="4" opacity="0.7"/>
    </g>`;
  } else {
    detail = `<!-- Cleanly feathered, uniform matte finish matching the surrounding wall -->`;
  }

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
  <rect x="44" y="64" width="240" height="370" fill="#e5e1d6" stroke="#c8c2b2" stroke-width="4"/>
  <rect x="64" y="84" width="200" height="330" fill="#dbe6ee"/>
  <line x1="164" y1="84" x2="164" y2="414" stroke="#f5f3ec" stroke-width="10"/>
  <line x1="64" y1="248" x2="264" y2="248" stroke="#f5f3ec" stroke-width="10"/>
  <rect x="34" y="434" width="260" height="18" fill="#f7f5ee" stroke="#cbc5b5" stroke-width="2"/>
  <rect x="0" y="514" width="800" height="86" fill="#ebe7dc"/>
  <rect x="0" y="510" width="800" height="6" fill="#c7c0b0"/>
  <rect width="800" height="514" fill="url(#sun)"/>
  ${detail}
  ${badge(label)}
</svg>`;
}

function tileSvg(variant) {
  let tiles = '<rect width="800" height="600" fill="#d5cfc2"/>';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = 36 + c * 184;
      const y = 38 + r * 98;
      const target = r === 2 && c === 1;
      if (target && variant === "issue") {
        tiles += `
          <g transform="rotate(2.2 ${x + 88} ${y + 44}) translate(-2 8)">
            <rect x="${x}" y="${y}" width="172" height="88" rx="3" fill="#f8f7f2" stroke="#dedad0" stroke-width="2"/>
            <rect x="${x}" y="${y}" width="172" height="16" rx="3" fill="#ffffff" opacity="0.6"/>
          </g>
          <rect x="${x + 170}" y="${y}" width="13" height="98" fill="#3b362f"/>
          <rect x="${x}" y="${y - 4}" width="174" height="7" fill="#5b554c"/>
        `;
      } else {
        tiles += `
          <rect x="${x}" y="${y}" width="176" height="88" rx="3" fill="#f5f3ec" stroke="#e4e0d6" stroke-width="1.5"/>
          <rect x="${x}" y="${y}" width="176" height="16" rx="3" fill="#ffffff" opacity="0.55"/>
        `;
        if (target && variant === "before") {
          tiles += `
            <path d="M${x + 32} ${y + 6} l26 26 l-10 15 l34 22 l8 19" fill="none" stroke="#3f3a32" stroke-width="4" stroke-linejoin="round"/>
            <path d="M${x + 58} ${y + 32} l28 -12" fill="none" stroke="#4d473e" stroke-width="2.5" stroke-linecap="round"/>
          `;
        }
      }
    }
  }
  const label =
    variant === "before"
      ? "DEMO KIT · TILE (BEFORE · CRACKED)"
      : variant === "issue"
      ? "DEMO KIT · TILE (AFTER · GAP / TILT)"
      : "DEMO KIT · TILE (AFTER · ALIGNED)";
  tiles += `
    <rect x="0" y="434" width="800" height="166" fill="#bfc3bf"/>
    <rect x="0" y="434" width="800" height="8" fill="#9ea39f"/>
    <ellipse cx="575" cy="520" rx="160" ry="38" fill="#aeb3af"/>
    ${badge(label)}
  `;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">${tiles}</svg>`;
}

function drywallPatchSvg(variant) {
  let detail;
  let label = "DEMO KIT · WALL PATCH (AFTER · COMPLETED)";
  if (variant === "before") {
    label = "DEMO KIT · WALL PATCH (BEFORE · HOLE)";
    detail = `<g>
      <path d="M375 245 l46 -18 l52 24 l-14 58 l-54 14 l-38 -36 z" fill="#2c2925"/>
      <path d="M368 242 l54 -22 l58 26 l-16 64 l-58 16 l-44 -40 z" fill="none" stroke="#b9b1a1" stroke-width="5"/>
      <path d="M362 288 l-18 24 M478 250 l24 -12" stroke="#6d6559" stroke-width="2.5"/>
    </g>`;
  } else if (variant === "issue") {
    label = "DEMO KIT · WALL PATCH (AFTER · RIDGE / SEAM)";
    detail = `<g>
      <rect x="358" y="216" width="142" height="120" rx="3" fill="#eceae4" stroke="#8f8779" stroke-width="4"/>
      <rect x="364" y="222" width="130" height="108" fill="none" stroke="#c3bcb0" stroke-width="3" stroke-dasharray="6 4"/>
      <line x1="500" y1="220" x2="500" y2="334" stroke="#6f685c" stroke-width="3"/>
    </g>`;
  } else {
    detail = `<!-- Clean feathered and primed drywall patch -->`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs>
    <linearGradient id="drywall" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#efebe1"/>
      <stop offset="100%" stop-color="#ded8c9"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#drywall)"/>
  <!-- Light switch landmark on left for framing consistency -->
  <rect x="165" y="220" width="58" height="94" rx="5" fill="#f7f5f0" stroke="#c9c2b2" stroke-width="2.5"/>
  <rect x="188" y="250" width="12" height="34" rx="2" fill="#e2ddd0" stroke="#b6afa0" stroke-width="1.5"/>
  <rect x="0" y="516" width="800" height="84" fill="#e9e4d9"/>
  <rect x="0" y="512" width="800" height="6" fill="#c6bfb0"/>
  ${detail}
  ${badge(label)}
</svg>`;
}

async function run() {
  const files = [
    ["painting-before.png", wallPaintSvg("before")],
    ["painting-after.png", wallPaintSvg("clean")],
    ["painting-after-uneven.png", wallPaintSvg("uneven")],
    ["tile-before.png", tileSvg("before")],
    ["tile-after-aligned.png", tileSvg("clean")],
    ["tile-after-issue.png", tileSvg("issue")],
    ["wall-before.png", drywallPatchSvg("before")],
    ["wall-after.png", drywallPatchSvg("clean")],
    ["wall-after-issue.png", drywallPatchSvg("issue")],
  ];
  for (const [name, svg] of files) {
    await sharp(Buffer.from(svg)).png().toFile(path.join(OUT_DIR, name));
    console.log("Generated", path.join("public/demo-kit", name));
  }
}

run();
