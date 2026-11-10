/**
 * Vẽ ảnh bao bì cho từng dòng sản phẩm (ảnh lớn cho trang chi tiết, ảnh nhỏ cho danh sách) và icon app.
 * Ảnh là minh họa dựng bằng SVG, có lớp nhiễu để dung lượng gần với ảnh chụp thật khi thử tải bundle nặng.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CATEGORIES, FAMILIES, type Shape } from './catalog-data.js';
import { createRng, hashString } from './rng.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fePublic = path.resolve(here, '..', process.env.FE_PUBLIC ?? '../../miniapp_samples/apps/kho-hang/public');
const imgDir = path.join(fePublic, 'img');
const thumbDir = path.join(imgDir, 't');
fs.mkdirSync(thumbDir, { recursive: true });

/** Hệ tọa độ vẽ là 640. Ảnh xuất ra 960px để gần với ảnh sản phẩm thật. */
const SIZE = 640;
const OUT = 960;
const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${s}% ${l}%)`;

function shapeSvg(shape: Shape, hue: number, accent: number, variant: number): string {
  const body = `url(#body)`;
  const label = `url(#label)`;
  const stripe = hsl(accent, 70, 52);
  const emblem = (cx: number, cy: number, r: number) => {
    const kind = variant % 3;
    if (kind === 0) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${stripe}" opacity=".92"/><circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="white" opacity=".9"/>`;
    if (kind === 1) return `<path d="M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z" fill="${stripe}" opacity=".92"/>`;
    return `<path d="M${cx - r} ${cy} q${r / 2} ${-r} ${r} 0 t${r} 0" stroke="${stripe}" stroke-width="${r / 2.2}" fill="none" stroke-linecap="round"/>`;
  };
  switch (shape) {
    case 'bottle':
      return `
        <rect x="285" y="70" width="70" height="46" rx="10" fill="${hsl(accent, 60, 38)}"/>
        <path d="M290 116 H350 V170 C350 200 400 220 400 270 V500 Q400 548 352 548 H288 Q240 548 240 500 V270 C240 220 290 200 290 170 Z" fill="${body}"/>
        <rect x="244" y="300" width="152" height="170" rx="14" fill="${label}"/>
        <rect x="244" y="300" width="152" height="26" fill="${stripe}"/>
        ${emblem(320, 395, 36)}
        <rect x="262" y="240" width="20" height="250" rx="10" fill="white" opacity=".22"/>`;
    case 'carton':
      return `
        <path d="M230 150 L320 100 L410 150 V520 H230 Z" fill="${body}"/>
        <path d="M230 150 L320 100 L410 150 L320 190 Z" fill="${hsl(hue, 55, 78)}"/>
        <path d="M320 190 L410 150 V520 H320 Z" fill="black" opacity=".12"/>
        <rect x="248" y="250" width="144" height="170" rx="12" fill="${label}"/>
        <rect x="248" y="250" width="144" height="24" fill="${stripe}"/>
        ${emblem(320, 345, 34)}`;
    case 'bag':
      return `
        <path d="M190 120 q20 -22 40 0 t40 0 t40 0 t40 0 t40 0 L452 150 q22 160 0 340 L450 520 q-22 22 -44 0 t-44 0 t-44 0 t-44 0 t-44 0 L188 490 q-22 -180 0 -340 z" fill="${body}"/>
        <ellipse cx="320" cy="330" rx="104" ry="126" fill="${label}"/>
        <ellipse cx="320" cy="330" rx="104" ry="126" fill="none" stroke="${stripe}" stroke-width="12"/>
        ${emblem(320, 330, 40)}
        <rect x="226" y="170" width="20" height="300" rx="10" fill="white" opacity=".2"/>`;
    case 'can':
      return `
        <rect x="236" y="130" width="168" height="400" rx="24" fill="${body}"/>
        <ellipse cx="320" cy="132" rx="84" ry="22" fill="${hsl(hue, 20, 82)}"/>
        <ellipse cx="320" cy="132" rx="56" ry="12" fill="${hsl(hue, 15, 68)}"/>
        <rect x="236" y="260" width="168" height="150" fill="${label}"/>
        <rect x="236" y="260" width="168" height="22" fill="${stripe}"/>
        ${emblem(320, 345, 32)}
        <rect x="258" y="160" width="20" height="340" rx="10" fill="white" opacity=".3"/>`;
    case 'box':
      return `
        <path d="M190 200 H420 V520 H190 Z" fill="${body}"/>
        <path d="M420 200 L470 170 V490 L420 520 Z" fill="black" opacity=".18"/>
        <path d="M190 200 L240 170 H470 L420 200 Z" fill="${hsl(hue, 50, 80)}"/>
        <rect x="214" y="250" width="182" height="190" rx="14" fill="${label}"/>
        <rect x="214" y="250" width="182" height="26" fill="${stripe}"/>
        ${emblem(305, 360, 38)}`;
    case 'tube':
      return `
        <rect x="270" y="90" width="100" height="70" rx="16" fill="${hsl(accent, 55, 40)}"/>
        <path d="M250 160 H390 L404 520 H236 Z" fill="${body}"/>
        <path d="M236 520 H404 V540 H236 Z" fill="${hsl(hue, 40, 36)}"/>
        <rect x="250" y="260" width="140" height="150" rx="12" fill="${label}" transform="skewX(-1)"/>
        ${emblem(320, 335, 32)}
        <rect x="268" y="180" width="16" height="320" rx="8" fill="white" opacity=".25"/>`;
    case 'cup':
      return `
        <path d="M210 190 H430 L404 520 q-2 18 -20 18 H256 q-18 0 -20 -18 Z" fill="${body}"/>
        <rect x="200" y="160" width="240" height="38" rx="12" fill="${hsl(accent, 55, 44)}"/>
        <rect x="226" y="290" width="188" height="120" rx="12" fill="${label}"/>
        ${emblem(320, 350, 32)}`;
    case 'jar':
      return `
        <rect x="210" y="130" width="220" height="70" rx="14" fill="${hsl(accent, 55, 40)}"/>
        <rect x="190" y="196" width="260" height="330" rx="46" fill="${body}" opacity=".95"/>
        <rect x="214" y="270" width="212" height="180" rx="14" fill="${label}"/>
        <rect x="214" y="270" width="212" height="24" fill="${stripe}"/>
        ${emblem(320, 372, 38)}`;
    case 'tray': {
      const fruits = [hsl(hue, 75, 52), hsl(accent, 70, 50), hsl(hue + 25, 70, 56), hsl(accent + 30, 65, 46)];
      const cells = Array.from({ length: 9 }, (_, i) => {
        const cx = 215 + (i % 3) * 105 + (Math.floor(i / 3) % 2) * 18;
        const cy = 320 + Math.floor(i / 3) * 70;
        return `<circle cx="${cx}" cy="${cy}" r="${40 + ((i * 7 + variant) % 10)}" fill="${fruits[(i + variant) % fruits.length]}"/><circle cx="${cx - 12}" cy="${cy - 14}" r="10" fill="white" opacity=".35"/>`;
      }).join('');
      return `
        <path d="M130 270 H510 L476 520 H164 Z" fill="${hsl(35, 35, 82)}"/>
        <path d="M150 290 H490 L462 500 H178 Z" fill="${hsl(35, 30, 70)}"/>
        ${cells}
        <path d="M130 270 H510 V286 H130 Z" fill="white" opacity=".4"/>`;
    }
    case 'pouch':
    default:
      return `
        <path d="M210 120 H430 L452 200 V490 q0 36 -36 36 H224 q-36 0 -36 -36 V200 Z" fill="${body}"/>
        <rect x="210" y="128" width="220" height="14" fill="white" opacity=".35"/>
        <ellipse cx="320" cy="340" rx="96" ry="116" fill="${label}"/>
        ${emblem(320, 340, 38)}
        <rect x="222" y="200" width="18" height="260" rx="9" fill="white" opacity=".2"/>`;
  }
}

function familySvg(index: number): string {
  const family = FAMILIES[index];
  if (!family) throw new Error(`Không có dòng sản phẩm ${index}`);
  const rng = createRng(hashString(`${family.b}|${family.n}`));
  const hue = (hashString(family.b) % 360) + rng.int(-8, 8);
  const accent = (hue + 150 + rng.int(-25, 25) + 360) % 360;
  const category = CATEGORIES.find((c) => c.id === family.c);
  const tint = ((category ? CATEGORIES.indexOf(category) : 0) * 21) % 360;
  const variant = hashString(family.n) % 9;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT}" height="${OUT}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${hsl(tint, 30, 97)}"/><stop offset="1" stop-color="${hsl(tint, 28, 86)}"/></radialGradient>
    <linearGradient id="body" x1="0" x2="1"><stop offset="0" stop-color="${hsl(hue, 62, 40)}"/><stop offset=".45" stop-color="${hsl(hue, 68, 56)}"/><stop offset="1" stop-color="${hsl(hue, 60, 34)}"/></linearGradient>
    <linearGradient id="label" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hsl(hue, 40, 98)}"/><stop offset="1" stop-color="${hsl(hue, 35, 90)}"/></linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="noise" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="3" seed="${hashString(family.n) % 1000}"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.9 -0.2"/>
    </filter>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  <ellipse cx="320" cy="548" rx="150" ry="22" fill="black" opacity=".22" filter="url(#blur)"/>
  ${shapeSvg(family.s, hue, accent, variant)}
  <rect width="${SIZE}" height="${SIZE}" filter="url(#noise)" opacity=".5"/>
</svg>`;
}

async function main(): Promise<void> {
  let bytes = 0;
  const queue = FAMILIES.map((_, index) => index);
  async function worker(): Promise<void> {
    for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
      const id = `f${String(index).padStart(3, '0')}`;
      const svg = Buffer.from(familySvg(index));
      const big = await sharp(svg).jpeg({ quality: 90, chromaSubsampling: '4:2:0' }).toBuffer();
      fs.writeFileSync(path.join(imgDir, `${id}.jpg`), big);
      bytes += big.length;
      const thumb = await sharp(big).resize(200, 200).jpeg({ quality: 78 }).toBuffer();
      fs.writeFileSync(path.join(thumbDir, `${id}.jpg`), thumb);
      bytes += thumb.length;
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);

  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f766e"/><stop offset="1" stop-color="#0e4f6b"/></linearGradient></defs>
    <rect width="512" height="512" rx="112" fill="url(#g)"/>
    <path d="M136 200 L256 140 L376 200 V330 L256 392 L136 330 Z" fill="#f8fafc"/>
    <path d="M136 200 L256 262 L376 200" fill="none" stroke="#0f766e" stroke-width="18" stroke-linejoin="round"/>
    <path d="M256 262 V392" stroke="#0f766e" stroke-width="18"/>
    <path d="M196 170 L316 232" stroke="#0f766e" stroke-width="14" stroke-linecap="round"/>
  </svg>`;
  await sharp(Buffer.from(icon)).png().toFile(path.join(fePublic, 'icon.png'));

  console.log(`${FAMILIES.length} dòng sản phẩm, ${(bytes / 1_048_576).toFixed(1)} MB ảnh (lớn + nhỏ)`);
  console.log(`Ảnh nằm ở ${imgDir}`);
}

void main();
