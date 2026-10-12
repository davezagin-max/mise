#!/usr/bin/env node
/**
 * Draws the three sample fridges and the app icons, then exports them to PNG
 * with headless Chromium.
 *
 *   pnpm samples
 *
 * The samples are illustrations on purpose: no photograph of unknown licence
 * is used anywhere in this repo. Each scene lists exactly the food its demo
 * scan reports, so the picture and the sample ingredient list agree.
 * Output: public/samples/<id>.png, public/icons/*.png, app/icon.png, app/apple-icon.png.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const W = 1200;
const H = 1500;
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (value) => {
    const next = amount >= 0 ? value + (255 - value) * amount : value * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(channel);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Small deterministic random generator so the drawings are identical on every run. */
function rng(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const text = (x, y, value, { size = 15, fill = "#ffffff", weight = 700, spacing = 1 } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" fill="${fill}">${value}</text>`;

/** A two-line product label centred in a box. */
function label(x, y, w, lines, { bg = "#ffffff", fg = "#2b2a26", size = 15 } = {}) {
  const h = lines.length * (size + 5) + 12;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${bg}"/>` +
    lines
      .map((line, i) =>
        text(x + w / 2, y + size + 6 + i * (size + 5), line, {
          size: i === 0 ? size : size - 3,
          fill: fg,
          weight: i === 0 ? 800 : 600,
        }),
      )
      .join("")
  );
}

// ---------------------------------------------------------------- the items
// Every item is drawn from its bottom-left corner (x, y) and returns SVG.

const items = {
  carton(x, y, { w = 112, h = 250, color = "#3b7dc4", name = "MILK", sub = "2%" }) {
    const top = y - h;
    return `<g>
      <path d="M${x} ${top + 52} L${x + w / 2} ${top + 6} L${x + w} ${top + 52} Z" fill="${shade(color, 0.75)}"/>
      <rect x="${x + w / 2 - 34}" y="${top}" width="68" height="16" rx="3" fill="${shade(color, 0.6)}"/>
      <rect x="${x}" y="${top + 52}" width="${w}" height="${h - 52}" rx="4" fill="#f3f0e6" stroke="#d5d0c2" stroke-width="2"/>
      <rect x="${x}" y="${top + 52}" width="${w}" height="64" fill="${color}"/>
      <rect x="${x + w - 16}" y="${top + 52}" width="16" height="${h - 52}" rx="4" fill="#000" opacity="0.06"/>
      ${text(x + w / 2, top + 94, name, { size: 22 })}
      ${text(x + w / 2, top + 150, sub, { size: 26, fill: color, weight: 800 })}
      <circle cx="${x + w / 2}" cy="${top + 196}" r="20" fill="${shade(color, 0.8)}"/>
    </g>`;
  },

  tub(x, y, { w = 150, h = 140, color = "#2f6f9f", lid = "#e9e6dc", name = ["GREEK", "YOGURT"], sub }) {
    const top = y - h;
    const lines = sub ? [...name, sub] : name;
    return `<g>
      <path d="M${x + 6} ${top + 22} H${x + w - 6} L${x + w - 16} ${y - 6} Q${x + w - 17} ${y} ${x + w - 24} ${y} H${x + 24} Q${x + 17} ${y} ${x + 16} ${y - 6} Z" fill="#f1eee4" stroke="#d5d0c2" stroke-width="2"/>
      <path d="M${x + 9} ${top + 46} H${x + w - 9} L${x + w - 14} ${y - 26} H${x + 14} Z" fill="${color}"/>
      <rect x="${x}" y="${top}" width="${w}" height="24" rx="8" fill="${lid}"/>
      <rect x="${x}" y="${top + 16}" width="${w}" height="8" rx="3" fill="${shade(lid, -0.12)}"/>
      ${lines.map((line, i) => text(x + w / 2, (top + 46 + y - 26) / 2 - (lines.length - 1) * 10 + 6 + i * 20, line, { size: i < name.length ? 16 : 13 })).join("")}
    </g>`;
  },

  eggs(x, y, { count = 10, slots = 12 }) {
    const perRow = slots / 2;
    const w = perRow * 40 + 24;
    let out = `<g>
      <rect x="${x + 6}" y="${y - 150}" width="${w - 12}" height="100" rx="10" fill="#b9ab8f"/>
      ${text(x + w / 2, y - 116, "EGGS", { size: 20, fill: "#7d7058" })}
      <rect x="${x}" y="${y - 62}" width="${w}" height="62" rx="12" fill="#cfc3aa"/>
      <rect x="${x}" y="${y - 20}" width="${w}" height="20" rx="8" fill="#b9ab8f"/>`;
    for (let i = 0; i < slots; i++) {
      const row = Math.floor(i / perRow);
      const cx = x + 32 + (i % perRow) * 40;
      const cy = y - 66 + row * 26;
      out += `<ellipse cx="${cx}" cy="${cy + 12}" rx="17" ry="9" fill="#a89a7e"/>`;
      if (i < count) {
        out += `<ellipse cx="${cx}" cy="${cy}" rx="15" ry="19" fill="${i % 3 === 0 ? "#e9cfae" : "#f4e7d3"}"/>
          <ellipse cx="${cx - 5}" cy="${cy - 7}" rx="4" ry="6" fill="#fff" opacity="0.55"/>`;
      }
    }
    return `${out}</g>`;
  },

  block(x, y, { w = 140, h = 78, color = "#f2a93b", wrap = "#ffffff", name = ["CHEDDAR"], fg = "#2b2a26" }) {
    return `<g>
      <rect x="${x}" y="${y - h}" width="${w}" height="${h}" rx="7" fill="${color}"/>
      <rect x="${x}" y="${y - h}" width="${w}" height="12" rx="6" fill="#fff" opacity="0.25"/>
      <rect x="${x + w - 14}" y="${y - h}" width="14" height="${h}" rx="6" fill="#000" opacity="0.08"/>
      ${label(x + 12, y - h + 16, w - 34, name, { bg: wrap, fg, size: 14 })}
    </g>`;
  },

  wedge(x, y, { w = 130, h = 84, color = "#ead48f", name = "PARMESAN" }) {
    return `<g>
      <path d="M${x} ${y} L${x + w} ${y} L${x + w} ${y - h} Z" fill="${color}"/>
      <path d="M${x} ${y} L${x + w} ${y - h} L${x + w} ${y - h + 12} L${x + 26} ${y} Z" fill="${shade(color, -0.14)}"/>
      <path d="M${x + 34} ${y - 4} L${x + w - 4} ${y - 4} L${x + w - 4} ${y - h + 28} Z" fill="#fff" opacity="0.35"/>
      <g transform="rotate(-33 ${x + w * 0.66} ${y - 20})">${text(x + w * 0.66, y - 16, name, { size: 11, fill: "#6e5b1c" })}</g>
    </g>`;
  },

  /** A wrapped tray of meat or fish. */
  tray(x, y, { w = 230, h = 104, kind = "chicken", name = ["CHICKEN", "BREAST"] }) {
    const top = y - h;
    const random = rng(w + h + kind.length);
    let contents = "";
    const inner = { x: x + 14, y: top + 12, w: w - 28 - 78, h: h - 26 };
    if (kind === "chicken") {
      for (let i = 0; i < 3; i++) {
        const cx = inner.x + 22 + i * (inner.w / 3);
        contents += `<path d="M${cx - 18} ${inner.y + 18} q20 -22 40 -2 q14 34 -8 52 q-28 10 -36 -16 z" fill="#f1b9a9"/>
          <path d="M${cx - 8} ${inner.y + 24} q10 -8 20 0" stroke="#fbd9cf" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      }
    } else if (kind === "ground") {
      contents += `<rect x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" rx="12" fill="#d88b84"/>`;
      for (let i = 0; i < 26; i++) {
        const px = inner.x + 8 + random() * (inner.w - 26);
        const py = inner.y + 8 + random() * (inner.h - 16);
        contents += `<path d="M${px} ${py} q6 -6 12 0" stroke="${random() > 0.5 ? "#edb1aa" : "#bf706a"}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      }
    } else if (kind === "salmon") {
      for (let i = 0; i < 2; i++) {
        const fx = inner.x + i * (inner.w / 2 + 2);
        const fw = inner.w / 2 - 6;
        contents += `<rect x="${fx}" y="${inner.y + 6}" width="${fw}" height="${inner.h - 12}" rx="18" fill="#f58a62"/>`;
        for (let j = 1; j < 5; j++) {
          contents += `<path d="M${fx + (fw / 5) * j} ${inner.y + 12} q-9 ${(inner.h - 24) / 2} 0 ${inner.h - 24}" stroke="#fbc3ab" stroke-width="3" fill="none"/>`;
        }
      }
    } else if (kind === "cod") {
      for (let i = 0; i < 2; i++) {
        contents += `<rect x="${inner.x + i * (inner.w / 2 + 2)}" y="${inner.y + 8}" width="${inner.w / 2 - 6}" height="${inner.h - 16}" rx="18" fill="#f3ebe0"/>`;
      }
    }
    return `<g>
      <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="12" fill="#2f3133"/>
      <rect x="${x + 6}" y="${top + 6}" width="${w - 12}" height="${h - 12}" rx="9" fill="#3d4043"/>
      ${contents}
      <path d="M${x + 10} ${top + 8} L${x + 46} ${top + 8} L${x + 18} ${y - 8} L${x + 10} ${y - 8} Z" fill="#fff" opacity="0.13"/>
      ${label(x + w - 86, top + 16, 74, name, { size: 11 })}
      <rect x="${x + w - 86}" y="${y - 30}" width="74" height="16" rx="3" fill="#e9483b"/>
    </g>`;
  },

  /** A clear bag: leaves, shrimp or flatbreads. */
  bag(x, y, { w = 170, h = 200, kind = "spinach", name = ["BABY", "SPINACH"], color = "#3f8b3a" }) {
    const top = y - h;
    const random = rng(w * 3 + kind.length * 7);
    let contents = "";
    if (kind === "spinach") {
      for (let i = 0; i < 42; i++) {
        const cx = x + 20 + random() * (w - 40);
        const cy = top + 44 + random() * (h - 62);
        const tone = ["#2f7a34", "#3f9443", "#58a84f", "#256b2e"][Math.floor(random() * 4)];
        contents += `<ellipse cx="${cx}" cy="${cy}" rx="${15 + random() * 7}" ry="${9 + random() * 4}" transform="rotate(${random() * 180} ${cx} ${cy})" fill="${tone}"/>`;
      }
    } else if (kind === "shrimp") {
      for (let i = 0; i < 16; i++) {
        const cx = x + 30 + random() * (w - 60);
        const cy = top + 60 + random() * (h - 90);
        contents += `<path d="M${cx - 12} ${cy} a13 13 0 1 1 13 13" stroke="${random() > 0.5 ? "#f2a48f" : "#e8937f"}" stroke-width="9" fill="none" stroke-linecap="round" transform="rotate(${random() * 360} ${cx} ${cy})"/>`;
      }
    }
    return `<g>
      <path d="M${x + 8} ${top + 14} H${x + w - 8} Q${x + w} ${top + 60} ${x + w - 4} ${y - 8} Q${x + w - 5} ${y} ${x + w - 14} ${y} H${x + 14} Q${x + 5} ${y} ${x + 4} ${y - 8} Q${x} ${top + 60} ${x + 8} ${top + 14} Z" fill="${kind === "shrimp" ? "#e6eef2" : "#dfeedd"}"/>
      ${contents}
      <rect x="${x + 4}" y="${top}" width="${w - 8}" height="20" rx="4" fill="${color}"/>
      <path d="M${x + 14} ${top + 26} L${x + 34} ${top + 26} L${x + 22} ${y - 10} L${x + 12} ${y - 10} Z" fill="#fff" opacity="0.3"/>
      ${label(x + w / 2 - 54, top + h / 2 - 12, 108, name, { size: 14, bg: "#fffdf7", fg: color })}
    </g>`;
  },

  /** A clear tub of small round things. */
  punnet(x, y, { w = 170, h = 104, kind = "tomato", name }) {
    const top = y - h;
    const random = rng(w + kind.length * 31);
    const palette = {
      tomato: { fill: ["#d8382f", "#e2513c", "#c92d2a"], r: 15, n: 16 },
      blueberry: { fill: ["#3c4f93", "#4a5fae", "#2f3f7c"], r: 10, n: 34 },
      mushroom: { fill: ["#efe6d6", "#e3d6c0", "#f6efe2"], r: 19, n: 9 },
    }[kind];
    let contents = "";
    for (let i = 0; i < palette.n; i++) {
      const cx = x + 22 + random() * (w - 44);
      const cy = top + 30 + random() * (h - 52);
      const fill = palette.fill[Math.floor(random() * palette.fill.length)];
      if (kind === "mushroom") {
        contents += `<rect x="${cx - 6}" y="${cy}" width="12" height="18" rx="5" fill="#f4eee4"/>
          <path d="M${cx - 19} ${cy + 4} a19 16 0 0 1 38 0 z" fill="${fill}"/>`;
      } else {
        contents += `<circle cx="${cx}" cy="${cy}" r="${palette.r}" fill="${fill}"/>
          <circle cx="${cx - palette.r / 3}" cy="${cy - palette.r / 3}" r="${palette.r / 4}" fill="#fff" opacity="0.5"/>`;
        if (kind === "tomato") contents += `<circle cx="${cx + 2}" cy="${cy - palette.r + 3}" r="3.5" fill="#3d7a35"/>`;
      }
    }
    return `<g>
      <path d="M${x} ${top + 10} H${x + w} L${x + w - 12} ${y} H${x + 12} Z" fill="#d3e3e6"/>
      ${contents}
      <path d="M${x} ${top + 10} H${x + w} L${x + w - 12} ${y} H${x + 12} Z" fill="#fff" opacity="0.14" stroke="#a9c3c8" stroke-width="2.5"/>
      <rect x="${x - 3}" y="${top}" width="${w + 6}" height="13" rx="6" fill="#eef5f6" stroke="#a9c3c8" stroke-width="2"/>
      ${name ? label(x + w / 2 - 50, y - 36, 100, name, { size: 12 }) : ""}
    </g>`;
  },

  container(x, y, { w = 180, h = 104, lid = "#3f7fb5", name = "RICE" }) {
    const top = y - h;
    const random = rng(w);
    let grains = "";
    for (let i = 0; i < 60; i++) {
      const cx = x + 18 + random() * (w - 36);
      const cy = top + 40 + random() * (h - 56);
      grains += `<ellipse cx="${cx}" cy="${cy}" rx="5.5" ry="2.6" transform="rotate(${random() * 180} ${cx} ${cy})" fill="${random() > 0.5 ? "#fffdf8" : "#eee8da"}"/>`;
    }
    return `<g>
      <rect x="${x + 4}" y="${top + 14}" width="${w - 8}" height="${h - 14}" rx="12" fill="#d3e3e6" stroke="#a9c3c8" stroke-width="2.5"/>
      <rect x="${x + 12}" y="${top + 32}" width="${w - 24}" height="${h - 40}" rx="8" fill="#f6f1e6"/>
      ${grains}
      <rect x="${x}" y="${top}" width="${w}" height="22" rx="8" fill="${lid}"/>
      <rect x="${x + w / 2 - 22}" y="${top - 6}" width="44" height="10" rx="5" fill="${shade(lid, -0.2)}"/>
      ${name ? `<rect x="${x + w / 2 - 34}" y="${y - 34}" width="68" height="22" rx="4" fill="#fff8d6"/>${text(x + w / 2, y - 18, name, { size: 12, fill: "#5a5340" })}` : ""}
    </g>`;
  },

  jar(x, y, { w = 92, h = 132, color = "#c0392b", lid = "#2f6b3a", name = ["SALSA"] }) {
    const top = y - h;
    return `<g>
      <rect x="${x + 8}" y="${top}" width="${w - 16}" height="22" rx="5" fill="${lid}"/>
      <rect x="${x}" y="${top + 18}" width="${w}" height="${h - 18}" rx="14" fill="${color}"/>
      <rect x="${x + 8}" y="${top + 26}" width="10" height="${h - 40}" rx="5" fill="#fff" opacity="0.25"/>
      ${label(x + 6, top + 50, w - 12, name, { size: 13 })}
    </g>`;
  },

  /** A flat vacuum pack lying on the shelf. */
  flatpack(x, y, { w = 170, h = 64, color = "#f39a6b", name = ["SMOKED", "SALMON"] }) {
    const top = y - h;
    let slices = "";
    for (let i = 0; i < 4; i++) {
      slices += `<path d="M${x + 12 + i * 22} ${y - 10} q14 -${h - 24} 40 -${h - 22} l12 0 q-22 6 -30 ${h - 22} z" fill="${i % 2 ? color : shade(color, 0.18)}"/>`;
    }
    return `<g>
      <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="6" fill="#23262b"/>
      ${slices}
      ${label(x + w - 80, top + 10, 70, name, { size: 11, bg: "#f7d774" })}
    </g>`;
  },

  /** A stack of flatbreads in a sleeve, seen from the side. */
  stack(x, y, { w = 190, h = 70, color = "#ecd9ae", name = ["FLOUR", "TORTILLAS"], band = "#c4472d" }) {
    let out = "<g>";
    const layers = Math.floor(h / 9);
    for (let i = 0; i < layers; i++) {
      out += `<rect x="${x + (i % 2) * 3}" y="${y - 10 - i * 9}" width="${w - 3}" height="10" rx="5" fill="${i % 2 ? color : shade(color, -0.07)}"/>`;
    }
    out += `<rect x="${x - 4}" y="${y - h - 4}" width="${w + 8}" height="${h + 4}" rx="10" fill="#fff" opacity="0.2"/>
      <rect x="${x + w / 2 - 52}" y="${y - h - 4}" width="104" height="${h + 4}" fill="${band}"/>
      ${name.map((line, i) => text(x + w / 2, y - h / 2 - 6 + i * 17, line, { size: 13 })).join("")}`;
    return `${out}</g>`;
  },

  round(x, y, { r = 34, color = "#e3ba2c", stem = null, squash = 1, nub = false }) {
    const cx = x + r;
    const cy = y - r * squash;
    return `<g>
      <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * squash}" fill="${color}"/>
      <ellipse cx="${cx - r / 3}" cy="${cy - (r * squash) / 3}" rx="${r / 3.2}" ry="${(r * squash) / 4}" fill="#fff" opacity="0.32"/>
      ${nub ? `<ellipse cx="${cx + r - 2}" cy="${cy}" rx="7" ry="6" fill="${shade(color, -0.12)}"/>` : ""}
      ${stem ? `<path d="M${cx - 9} ${cy - r * squash + 4} l9 -9 l9 9 l-9 3 z" fill="${stem}"/>` : ""}
    </g>`;
  },

  avocado(x, y, { r = 36 }) {
    const cx = x + r;
    return `<g>
      <path d="M${cx} ${y - r * 2.5} q${r * 0.7} 0 ${r * 0.9} ${r * 1.1} q${r * 0.35} ${r * 1.4} -${r * 0.9} ${r * 1.4} q-${r * 1.25} 0 -${r * 0.9} -${r * 1.4} q${r * 0.2} -${r * 1.1} ${r * 0.9} -${r * 1.1} z" fill="#2f4a2a"/>
      <ellipse cx="${cx - r * 0.3}" cy="${y - r * 1.2}" rx="${r * 0.2}" ry="${r * 0.45}" fill="#fff" opacity="0.14"/>
    </g>`;
  },

  pepper(x, y, { color = "#d8342c", r = 44 }) {
    const cx = x + r;
    const cy = y - r;
    return `<g>
      <ellipse cx="${cx - r * 0.42}" cy="${cy + 2}" rx="${r * 0.6}" ry="${r}" fill="${color}"/>
      <ellipse cx="${cx + r * 0.42}" cy="${cy + 2}" rx="${r * 0.6}" ry="${r}" fill="${color}"/>
      <ellipse cx="${cx}" cy="${cy + 4}" rx="${r * 0.55}" ry="${r * 0.98}" fill="${shade(color, 0.1)}"/>
      <ellipse cx="${cx - r * 0.5}" cy="${cy - r * 0.3}" rx="${r * 0.14}" ry="${r * 0.4}" fill="#fff" opacity="0.35"/>
      <path d="M${cx - 8} ${cy - r + 4} q8 -24 14 -22 q5 3 2 22 z" fill="#3d7a35"/>
    </g>`;
  },

  broccoli(x, y, { w = 150 }) {
    const random = rng(w);
    let crown = "";
    for (let i = 0; i < 22; i++) {
      const cx = x + 26 + random() * (w - 52);
      const cy = y - 78 - random() * 62;
      crown += `<circle cx="${cx}" cy="${cy}" r="${20 + random() * 10}" fill="${["#2f7d32", "#3b9140", "#256a2b"][i % 3]}"/>`;
    }
    return `<g>
      <path d="M${x + w / 2 - 20} ${y} L${x + w / 2 - 28} ${y - 78} L${x + w / 2 + 28} ${y - 78} L${x + w / 2 + 20} ${y} Z" fill="#8fbf6a"/>
      ${crown}
    </g>`;
  },

  carrots(x, y, { n = 5 }) {
    let out = "<g>";
    for (let i = 0; i < n; i++) {
      const top = y - 14 - i * 21;
      out += `<path d="M${x + 60} ${top - 13} L${x + 240 - i * 8} ${top - 3} L${x + 60} ${top + 9} Z" fill="${i % 2 ? "#ee7d22" : "#f28f2e"}"/>
        <path d="M${x + 62} ${top - 2} q-36 -16 -60 -6 M${x + 62} ${top} q-34 2 -58 12 M${x + 62} ${top - 4} q-26 -22 -42 -22" stroke="#3f8b3a" stroke-width="6" fill="none" stroke-linecap="round"/>`;
    }
    return `${out}</g>`;
  },

  long(x, y, { w = 220, h = 48, color = "#3f7a34", stripe = "#5a9a48" }) {
    return `<g>
      <rect x="${x}" y="${y - h}" width="${w}" height="${h}" rx="${h / 2}" fill="${color}"/>
      <rect x="${x + 18}" y="${y - h + 9}" width="${w - 40}" height="6" rx="3" fill="${stripe}"/>
      <rect x="${x + 28}" y="${y - h + 24}" width="${w - 70}" height="5" rx="2.5" fill="${stripe}" opacity="0.6"/>
      <rect x="${x + w - 8}" y="${y - h / 2 - 7}" width="14" height="14" rx="4" fill="#7a8f4b"/>
    </g>`;
  },

  sweetPotato(x, y, { w = 160 }) {
    return `<g>
      <path d="M${x} ${y - 30} Q${x + w * 0.3} ${y - 78} ${x + w * 0.7} ${y - 66} Q${x + w} ${y - 50} ${x + w} ${y - 30} Q${x + w * 0.8} ${y} ${x + w * 0.4} ${y} Q${x + w * 0.1} ${y} ${x} ${y - 30} Z" fill="#c8683a"/>
      <path d="M${x + 30} ${y - 46} q30 -10 54 -4 M${x + 60} ${y - 22} q26 -6 46 0" stroke="#a8502a" stroke-width="3" fill="none" stroke-linecap="round"/>
    </g>`;
  },

  /** Standing green things: asparagus, herbs, kale, basil in a glass. */
  bunch(x, y, { kind = "asparagus", w = 110, h = 210 }) {
    const random = rng(w + h + kind.length * 13);
    let out = "<g>";
    if (kind === "asparagus") {
      for (let i = 0; i < 11; i++) {
        const sx = x + 8 + i * ((w - 16) / 10);
        const lean = (i - 5) * 1.6;
        out += `<path d="M${sx} ${y} L${sx + lean} ${y - h + 26}" stroke="${i % 2 ? "#5d9a45" : "#4c8a3a"}" stroke-width="11" stroke-linecap="round"/>
          <path d="M${sx + lean - 6} ${y - h + 30} q6 -34 12 0 z" fill="#3f7a34"/>`;
      }
      out += `<rect x="${x - 2}" y="${y - 70}" width="${w + 4}" height="18" rx="4" fill="#7b5ea7"/>`;
    } else {
      const leaf = { cilantro: "#3f9443", kale: "#2e6b3f", basil: "#3a8f3f" }[kind];
      if (kind === "basil") {
        out += `<path d="M${x + 14} ${y - 96} H${x + w - 14} L${x + w - 22} ${y} H${x + 22} Z" fill="#dcebf0" opacity="0.9"/>
          <path d="M${x + 18} ${y - 44} H${x + w - 18} L${x + w - 22} ${y - 4} H${x + 22} Z" fill="#bcdbe6"/>`;
      }
      for (let i = 0; i < 7; i++) {
        const sx = x + w / 2 + (i - 3) * 5;
        out += `<path d="M${sx} ${y - (kind === "basil" ? 8 : 0)} L${x + 14 + i * ((w - 28) / 6)} ${y - h + 60}" stroke="${shade(leaf, 0.25)}" stroke-width="${kind === "kale" ? 7 : 4}" stroke-linecap="round"/>`;
      }
      const count = kind === "kale" ? 46 : 60;
      for (let i = 0; i < count; i++) {
        const cx = x + 6 + random() * (w - 12);
        const cy = y - h + 14 + random() * (h * 0.52);
        const r = kind === "kale" ? 17 + random() * 9 : kind === "basil" ? 13 + random() * 5 : 8 + random() * 5;
        out += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * (kind === "basil" ? 0.62 : 0.85)}" transform="rotate(${random() * 180} ${cx} ${cy})" fill="${shade(leaf, (random() - 0.5) * 0.36)}"/>`;
      }
      if (kind !== "basil") out += `<rect x="${x + w / 2 - 22}" y="${y - 46}" width="44" height="12" rx="4" fill="#d9c7a0"/>`;
    }
    return `${out}</g>`;
  },

  chili(x, y, { color = "#2f7a34" }) {
    return `<g>
      <path d="M${x} ${y - 14} q34 -24 76 -8 q10 6 0 12 q-40 14 -76 -4 z" fill="${color}"/>
      <path d="M${x + 4} ${y - 14} q-10 -8 -6 -16" stroke="#5b7a2e" stroke-width="5" fill="none" stroke-linecap="round"/>
    </g>`;
  },
};

// -------------------------------------------------------------- the fridge

const SHELF_Y = [408, 694, 968];
const INSIDE = { left: 96, right: 824, top: 118, bottom: 1404 };
const DRAWER = { top: 1020, bottom: 1380 };
const DOOR = { left: 872, right: 1150, bins: [470, 820, 1170] };

function drawItems(list, originX, baseline) {
  return list.map(([kind, dx, options = {}, dy = 0]) => items[kind](originX + dx, baseline + dy, options)).join("");
}

function fridge(scene) {
  const mid = (INSIDE.left + INSIDE.right) / 2;
  const shelves = SHELF_Y.map(
    (y, i) => `
    ${drawItems(scene.shelves[i], INSIDE.left, y)}
    <rect x="${INSIDE.left}" y="${y}" width="${INSIDE.right - INSIDE.left}" height="12" fill="#cfe3e6" opacity="0.9"/>
    <rect x="${INSIDE.left}" y="${y}" width="${INSIDE.right - INSIDE.left}" height="3" fill="#ffffff"/>
    <rect x="${INSIDE.left}" y="${y + 12}" width="${INSIDE.right - INSIDE.left}" height="16" fill="url(#under)"/>`,
  ).join("");

  const drawers = [0, 1]
    .map((i) => {
      const left = i === 0 ? INSIDE.left + 8 : mid + 6;
      const width = mid - INSIDE.left - 14;
      return `
      <rect x="${left}" y="${DRAWER.top}" width="${width}" height="${DRAWER.bottom - DRAWER.top}" rx="14" fill="#dfeaec"/>
      ${drawItems(scene.drawers[i], left, DRAWER.bottom - 14)}
      <rect x="${left}" y="${DRAWER.top}" width="${width}" height="${DRAWER.bottom - DRAWER.top}" rx="14" fill="#ffffff" opacity="0.2"/>
      <rect x="${left}" y="${DRAWER.top}" width="${width}" height="${DRAWER.bottom - DRAWER.top}" rx="14" fill="none" stroke="#ffffff" stroke-width="5"/>
      <rect x="${left + width / 2 - 70}" y="${DRAWER.top + 14}" width="140" height="14" rx="7" fill="#ffffff"/>`;
    })
    .join("");

  const bins = DOOR.bins
    .map(
      (y, i) => `
      ${drawItems(scene.door[i], DOOR.left + 16, y)}
      <rect x="${DOOR.left + 8}" y="${y - 84}" width="${DOOR.right - DOOR.left - 16}" height="96" rx="12" fill="#ffffff" opacity="0.36"/>
      <rect x="${DOOR.left + 8}" y="${y - 84}" width="${DOOR.right - DOOR.left - 16}" height="96" rx="12" fill="none" stroke="#ffffff" stroke-width="5"/>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>
      <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9cdb8"/><stop offset="1" stop-color="#c7b99f"/></linearGradient>
      <linearGradient id="inside" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#eef4f5"/><stop offset="1" stop-color="#dde8ea"/></linearGradient>
      <linearGradient id="under" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7f9aa0" stop-opacity="0.28"/><stop offset="1" stop-color="#7f9aa0" stop-opacity="0"/></linearGradient>
      <radialGradient id="lamp" cx="0.5" cy="0" r="0.8"><stop offset="0" stop-color="#fffbe6" stop-opacity="0.95"/><stop offset="1" stop-color="#fffbe6" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#wall)"/>
    <rect x="0" y="${H - 70}" width="${W}" height="70" fill="#9c8a6d"/>
    <rect x="56" y="70" width="808" height="1380" rx="34" fill="#f1eee6"/>
    <rect x="56" y="70" width="808" height="1380" rx="34" fill="none" stroke="#d6d0c2" stroke-width="4"/>
    <rect x="${INSIDE.left}" y="${INSIDE.top}" width="${INSIDE.right - INSIDE.left}" height="${INSIDE.bottom - INSIDE.top}" rx="16" fill="url(#inside)"/>
    <rect x="${INSIDE.left}" y="${INSIDE.top}" width="${INSIDE.right - INSIDE.left}" height="300" rx="16" fill="url(#lamp)"/>
    <rect x="${mid - 90}" y="${INSIDE.top + 10}" width="180" height="16" rx="8" fill="#fff7cf"/>
    ${shelves}
    ${drawers}
    <path d="M${DOOR.left - 8} 60 L${DOOR.right + 20} 20 L${DOOR.right + 20} ${H - 30} L${DOOR.left - 8} ${H - 50} Z" fill="#e7e3d9"/>
    <path d="M${DOOR.left} 96 L${DOOR.right} 64 L${DOOR.right} ${H - 78} L${DOOR.left} ${H - 96} Z" fill="#edf1f1"/>
    ${bins}
    <rect x="${DOOR.right + 6}" y="560" width="12" height="380" rx="6" fill="#bdb6a6"/>
  </svg>`;
}

const scenes = {
  weeknight: {
    shelves: [
      [
        ["tub", 30, { name: ["GREEK", "YOGURT"], sub: "32 OZ", w: 164, h: 168 }],
        ["eggs", 230, { count: 10 }],
        ["block", 530, { name: ["CHEDDAR", "8 OZ"], w: 170, h: 86 }],
      ],
      [
        ["tray", 24, { kind: "chicken", name: ["CHICKEN", "BREAST"], w: 262, h: 116 }],
        ["tray", 304, { kind: "ground", name: ["GROUND", "TURKEY"], w: 232, h: 108 }],
        ["stack", 556, { name: ["FLOUR", "TORTILLAS"], w: 156, h: 76 }],
      ],
      [
        ["bag", 26, { kind: "spinach", name: ["BABY", "SPINACH"], w: 176, h: 212 }],
        ["punnet", 226, { kind: "tomato", w: 200, h: 118 }],
        ["container", 452, { name: "RICE", w: 250, h: 112 }],
      ],
    ],
    drawers: [
      [
        ["long", 96, { w: 230, h: 52 }, -118],
        ["carrots", 20, { n: 5 }],
      ],
      [
        ["broccoli", 8, { w: 150 }],
        ["pepper", 150, { color: "#d8342c", r: 46 }],
        ["pepper", 238, { color: "#f1b81f", r: 44 }],
        ["avocado", 150, { r: 30 }, -108],
        ["avocado", 226, { r: 31 }, -104],
      ],
    ],
    door: [
      [
        ["block", 14, { name: ["BUTTER"], color: "#f6e08a", w: 132, h: 56 }],
        ["jar", 158, { name: ["SALSA"], w: 84, h: 124 }],
      ],
      [
        ["round", 30, { r: 34, color: "#f0cf3a", squash: 0.82, nub: true }],
        ["round", 124, { r: 33, color: "#ecc62f", squash: 0.82, nub: true }],
      ],
      [["carton", 64, { name: "MILK", sub: "2%", w: 120, h: 262 }]],
    ],
  },
  garden: {
    shelves: [
      [
        ["carton", 30, { name: "MILK", sub: "2%", w: 104, h: 226, color: "#3b7dc4" }],
        ["tub", 160, { name: ["GREEK", "YOGURT"], sub: "32 OZ", w: 160, h: 166 }],
        ["eggs", 380, { count: 12 }],
      ],
      [
        ["block", 24, { name: ["TOFU", "EXTRA FIRM"], color: "#f1ead9", wrap: "#2f8f5b", fg: "#ffffff", w: 172, h: 92 }],
        ["block", 44, { name: ["TOFU", "EXTRA FIRM"], color: "#f1ead9", wrap: "#2f8f5b", fg: "#ffffff", w: 172, h: 92 }, -92],
        ["block", 226, { name: ["FETA"], color: "#fbfaf4", wrap: "#2c5fa8", fg: "#ffffff", w: 140, h: 76 }],
        ["wedge", 392, { w: 136, h: 90 }],
        ["stack", 552, { name: ["PITA", "BREAD"], w: 160, h: 62, band: "#3f6b3a", color: "#e6cf9e" }],
      ],
      [
        ["bag", 22, { kind: "spinach", name: ["BABY", "SPINACH"], w: 170, h: 206 }],
        ["punnet", 208, { kind: "mushroom", w: 176, h: 112 }],
        ["punnet", 398, { kind: "tomato", w: 164, h: 110 }],
        ["punnet", 576, { kind: "blueberry", w: 136, h: 86, name: ["BLUEBERRIES"] }],
      ],
    ],
    drawers: [
      [
        ["bunch", 18, { kind: "kale", w: 170, h: 250 }],
        ["long", 136, { w: 204, h: 54, color: "#2f6b34", stripe: "#3f8544" }],
      ],
      [
        ["long", 12, { w: 196, h: 48 }, -100],
        ["long", 30, { w: 196, h: 48 }, -154],
        ["pepper", 40, { color: "#d8342c", r: 48 }],
        ["pepper", 170, { color: "#ef8a22", r: 47 }],
      ],
    ],
    door: [
      [["bunch", 70, { kind: "basil", w: 104, h: 190 }]],
      [
        ["round", 14, { r: 32, color: "#f0cf3a", squash: 0.82, nub: true }],
        ["round", 92, { r: 31, color: "#ecc62f", squash: 0.82, nub: true }],
        ["round", 168, { r: 31, color: "#f3d444", squash: 0.82, nub: true }],
      ],
      [["tub", 50, { name: ["HUMMUS"], color: "#b9772d", w: 150, h: 118 }]],
    ],
  },
  catch: {
    shelves: [
      [
        ["tub", 28, { name: ["COTTAGE", "CHEESE"], sub: "16 OZ", color: "#2c8f84", w: 170, h: 158 }],
        ["eggs", 250, { count: 6, slots: 6 }],
        ["flatpack", 440, { w: 250, h: 74 }],
      ],
      [
        ["tray", 24, { kind: "salmon", name: ["SALMON", "FILLETS"], w: 282, h: 120 }],
        ["bag", 328, { kind: "shrimp", name: ["SHRIMP", "12 OZ"], color: "#2a6ea3", w: 180, h: 196 }],
        ["stack", 534, { name: ["CORN", "TORTILLAS"], w: 172, h: 92, color: "#f0d778", band: "#2f6b3a" }],
      ],
      [
        ["bag", 22, { kind: "spinach", name: ["BABY", "SPINACH"], w: 170, h: 206 }],
        ["punnet", 210, { kind: "tomato", w: 180, h: 112 }],
        ["bunch", 418, { kind: "asparagus", w: 112, h: 226 }],
        ["bunch", 566, { kind: "cilantro", w: 130, h: 200 }],
      ],
    ],
    drawers: [
      [
        ["sweetPotato", 14, { w: 176 }],
        ["sweetPotato", 60, { w: 164 }, -70],
        ["round", 206, { r: 48, color: "#8e3460", stem: "#c9a37a" }],
        ["chili", 22, {}, -150],
        ["chili", 120, { color: "#3a8a3a" }, -168],
      ],
      [
        ["long", 16, { w: 226, h: 54, color: "#2f6b34", stripe: "#3f8544" }, -130],
        ["avocado", 18, { r: 34 }],
        ["avocado", 104, { r: 35 }],
      ],
    ],
    door: [
      [
        ["round", 22, { r: 33, color: "#f0cf3a", squash: 0.82, nub: true }],
        ["round", 104, { r: 33, color: "#ecc62f", squash: 0.82, nub: true }],
      ],
      [
        ["round", 26, { r: 30, color: "#6fae3d", squash: 0.9 }],
        ["round", 104, { r: 30, color: "#62a336", squash: 0.9 }],
      ],
      [["tub", 54, { name: ["GREEK", "YOGURT"], sub: "17 OZ", w: 150, h: 156 }]],
    ],
  },
};

// ------------------------------------------------------------------- icons

function icon(size, { maskable = false } = {}) {
  const pad = maskable ? 0 : 0;
  const scale = maskable ? 0.78 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
    <rect x="${pad}" y="${pad}" width="512" height="512" rx="${maskable ? 0 : 112}" fill="#35603a"/>
    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
      <circle cx="256" cy="268" r="170" fill="#f6efe0"/>
      <circle cx="256" cy="268" r="122" fill="none" stroke="#dccfb4" stroke-width="8"/>
      <path d="M256 372 C256 300 252 232 276 150" stroke="#35603a" stroke-width="16" fill="none" stroke-linecap="round"/>
      <path d="M262 300 C206 300 178 264 176 222 C226 220 258 250 262 300 Z" fill="#4c8a4a"/>
      <path d="M268 250 C320 246 346 212 346 172 C298 172 270 204 268 250 Z" fill="#5d9a55"/>
      <path d="M260 214 C228 200 218 170 226 140 C258 152 270 182 260 214 Z" fill="#4c8a4a"/>
    </g>
  </svg>`;
}

// ------------------------------------------------------------------ export

const browser = await chromium.launch();
async function render(svg, width, height, file) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width, height } });
  await page.close();
  console.log(`wrote ${file}`);
}

try {
  for (const [id, scene] of Object.entries(scenes)) {
    await render(fridge(scene), W, H, `public/samples/${id}.png`);
  }
  await render(icon(192), 192, 192, "public/icons/icon-192.png");
  await render(icon(512), 512, 512, "public/icons/icon-512.png");
  await render(icon(512, { maskable: true }), 512, 512, "public/icons/maskable-512.png");
  await render(icon(180, { maskable: true }), 180, 180, "app/apple-icon.png");
  await render(icon(64), 64, 64, "app/icon.png");
  writeFileSync("public/icons/icon.svg", icon(512));
} finally {
  await browser.close();
}
