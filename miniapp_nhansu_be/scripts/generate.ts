/**
 * Sinh dữ liệu giả cho mini-app Nhân sự:
 *  - data/employees.json  (đầy đủ, có lương, backend đọc)
 *  - data/leaves.json     (đơn nghỉ phép ban đầu)
 *  - FE public/data/employees.json  (gói danh bạ offline, không lương)
 *  - FE public/img/p/*.jpg (ảnh chân dung lớn), public/img/t/*.jpg (ảnh nhỏ), public/icon.png
 * Mọi thứ có hạt giống cố định nên chạy lại cho cùng kết quả.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createRng } from './rng.js';
import type { Employee, Leave } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fePublic = path.resolve(root, process.env.FE_PUBLIC ?? '../../miniapp_samples/apps/nhan-su/public');
const dataDir = path.join(root, 'data');
const COUNT = Number(process.env.COUNT ?? 20000);
const PHOTOS = Number(process.env.PHOTOS ?? 120);
const PHOTO_SIZE = Number(process.env.PHOTO_SIZE ?? 800);
const PHOTO_QUALITY = Number(process.env.PHOTO_QUALITY ?? 92);

const rng = createRng(20261109);

const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Đinh', 'Trương', 'Lưu', 'Mạc'];
const MID = ['Văn', 'Thị', 'Minh', 'Hoài', 'Thanh', 'Quốc', 'Gia', 'Đức', 'Ngọc', 'Hải', 'Thu', 'Anh', 'Bảo', 'Hồng', 'Phương', 'Tuấn', 'Kim', 'Đăng', 'Xuân', 'Mỹ'];
const FIRST = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Hạnh', 'Hiếu', 'Hưng', 'Khoa', 'Lan', 'Linh', 'Long', 'Mai', 'Nam', 'Ngân', 'Nhung', 'Phúc', 'Quang', 'Quyên', 'Sơn', 'Thảo', 'Trang', 'Tuấn', 'Uyên', 'Việt', 'Vinh', 'Yến', 'Đạt', 'Hải'];
const DEPTS: { name: string; titles: string[]; base: number }[] = [
  { name: 'Công nghệ', titles: ['Kỹ sư phần mềm', 'Kỹ sư QA', 'DevOps', 'Kiến trúc sư', 'Data Engineer'], base: 24 },
  { name: 'Kinh doanh', titles: ['Nhân viên kinh doanh', 'Account Manager', 'Trưởng nhóm bán hàng'], base: 16 },
  { name: 'Marketing', titles: ['Chuyên viên marketing', 'Content', 'Designer', 'Performance'], base: 15 },
  { name: 'Nhân sự', titles: ['Chuyên viên tuyển dụng', 'C&B', 'HRBP'], base: 14 },
  { name: 'Kế toán', titles: ['Kế toán viên', 'Kế toán tổng hợp', 'Kiểm soát nội bộ'], base: 15 },
  { name: 'Vận hành', titles: ['Điều phối', 'Giám sát kho', 'Chuyên viên vận hành'], base: 12 },
  { name: 'Chăm sóc khách hàng', titles: ['Tổng đài viên', 'Chuyên viên CSKH', 'Trưởng ca'], base: 11 },
  { name: 'Pháp chế', titles: ['Chuyên viên pháp chế', 'Luật sư nội bộ'], base: 18 },
];
const BRANCHES = ['Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ'];
const SKILLS = ['TypeScript', 'React', 'Node.js', 'SQL', 'Excel', 'Figma', 'Tiếng Anh', 'Tiếng Nhật', 'Quản lý dự án', 'Đàm phán', 'SEO', 'Phân tích dữ liệu', 'Kế toán thuế', 'Pháp luật lao động', 'Kubernetes', 'Python', 'Giao tiếp', 'Lãnh đạo'];
const noAccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

const today = new Date();
const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

const employees: Employee[] = [];
for (let i = 1; i <= COUNT; i += 1) {
  const dept = rng.pick(DEPTS);
  const name = `${rng.pick(LAST)} ${rng.pick(MID)} ${rng.pick(FIRST)}`;
  const level = Math.min(7, Math.max(1, Math.round(2.6 + rng.normal() * 1.3)));
  const tenure = Math.max(1, Math.round(Math.abs(rng.normal()) * 900) + 5);
  const salary = Math.round((dept.base + level * 7.5 + rng.normal() * 2.5) / 0.5) * 500_000;
  const parts = noAccent(name).split(' ');
  const skills = Array.from(new Set(Array.from({ length: rng.int(2, 5) }, () => rng.pick(SKILLS))));
  employees.push({
    id: i,
    code: `TS${String(i).padStart(5, '0')}`,
    name,
    dept: dept.name,
    title: `${rng.pick(dept.titles)}${level >= 5 ? ' cấp cao' : ''}`,
    level,
    email: `${parts[parts.length - 1]}.${parts[0]}${i}@tinasoft.vn`,
    phone: `09${rng.int(0, 9)}${String(rng.int(0, 9_999_999)).padStart(7, '0')}`,
    branch: rng.pick(BRANCHES),
    hired: dateStr(daysAgo(tenure)),
    status: rng.chance(0.03) ? 'leave' : tenure < 90 ? 'probation' : 'active',
    avatar: rng.int(0, PHOTOS - 1),
    age: Math.max(20, Math.min(60, Math.round(31 + rng.normal() * 7))),
    skills,
    salary: Math.max(8_000_000, salary),
  });
}

const leaves: Leave[] = [];
const TYPES = ['Phép năm', 'Nghỉ ốm', 'Việc riêng', 'Thai sản'] as const;
for (let i = 0; i < 400; i += 1) {
  const emp = rng.pick(employees);
  const start = daysAgo(rng.int(-20, 120));
  const days = rng.int(1, 5);
  const status = start > today ? 'pending' : rng.pick(['approved', 'approved', 'approved', 'rejected', 'pending'] as const);
  leaves.push({
    id: `L${String(i + 1).padStart(5, '0')}`,
    employeeId: emp.id,
    type: rng.chance(0.02) ? 'Thai sản' : rng.pick(TYPES.slice(0, 3)),
    from: dateStr(start),
    to: dateStr(new Date(start.getTime() + (days - 1) * 86_400_000)),
    days,
    reason: rng.pick(['Việc gia đình', 'Khám sức khỏe', 'Đi du lịch', 'Về quê', 'Giải quyết giấy tờ']),
    status,
    createdBy: 'seed',
    createdAt: new Date(start.getTime() - 3 * 86_400_000).toISOString(),
    ...(status === 'pending' ? {} : { decidedBy: 'seed' }),
  });
}

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'employees.json'), JSON.stringify(employees));
fs.writeFileSync(path.join(dataDir, 'leaves.json'), JSON.stringify(leaves));
const version = `${dateStr(today)}-${COUNT}`;
fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify({ version, count: COUNT, generatedAt: today.toISOString() }));

// Gói offline: bỏ lương, rút gọn khóa để vừa đủ nặng nhưng vẫn giống dữ liệu thật
const pack = employees.map(({ salary: _salary, ...rest }) => rest);
fs.mkdirSync(path.join(fePublic, 'data'), { recursive: true });
fs.writeFileSync(path.join(fePublic, 'data', 'employees.json'), JSON.stringify({ version, count: COUNT, rows: pack }));
console.log(`employees ${COUNT}, leaves ${leaves.length}, version ${version}`);

// ---------- Ảnh ----------
const imgBig = path.join(fePublic, 'img', 'p');
const imgThumb = path.join(fePublic, 'img', 't');
fs.mkdirSync(imgBig, { recursive: true });
fs.mkdirSync(imgThumb, { recursive: true });
const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${s}% ${l}%)`;

function portrait(i: number): string {
  const r = createRng(1000 + i);
  const hue = r.int(0, 359);
  const skin = r.pick([[28, 55, 72], [24, 48, 62], [30, 40, 52], [20, 45, 45]]);
  const hair = hsl(r.int(15, 40), r.int(10, 40), r.int(8, 28));
  const shirt = hsl((hue + r.int(120, 240)) % 360, r.int(30, 65), r.int(35, 60));
  const long = r.chance(0.5);
  const S = 600;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(hue, 55, 70)}"/><stop offset="1" stop-color="${hsl((hue + 50) % 360, 60, 42)}"/></linearGradient>
    <radialGradient id="glow" cx=".3" cy=".25" r=".8"><stop offset="0" stop-color="white" stop-opacity=".45"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient>
    <filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${(0.7 + r.next() * 0.5).toFixed(2)}" numOctaves="4" seed="${i}"/><feColorMatrix type="saturate" values="0.2"/></filter>
    <filter id="blur"><feGaussianBlur stdDeviation="2"/></filter>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  ${Array.from({ length: 6 }, () => `<circle cx="${r.int(0, S)}" cy="${r.int(0, S)}" r="${r.int(40, 160)}" fill="white" opacity="${(r.next() * 0.12).toFixed(2)}"/>`).join('')}
  <rect width="${S}" height="${S}" fill="url(#glow)"/>
  <path d="M60 ${S} Q70 400 ${S / 2} 400 Q${S - 70} 400 ${S - 60} ${S} Z" fill="${shirt}"/>
  <rect x="${S / 2 - 38}" y="330" width="76" height="90" rx="30" fill="${hsl(skin[0]!, skin[1]!, skin[2]! - 8)}"/>
  ${long ? `<ellipse cx="${S / 2}" cy="270" rx="150" ry="170" fill="${hair}"/>` : ''}
  <ellipse cx="${S / 2}" cy="255" rx="106" ry="128" fill="${hsl(skin[0]!, skin[1]!, skin[2]!)}"/>
  <path d="M${S / 2 - 112} 235 Q${S / 2} ${long ? 90 : 105} ${S / 2 + 112} 235 Q${S / 2 + 90} 150 ${S / 2} 140 Q${S / 2 - 90} 150 ${S / 2 - 112} 235 Z" fill="${hair}"/>
  <circle cx="${S / 2 - 40}" cy="262" r="9" fill="#2b2b2b"/><circle cx="${S / 2 + 40}" cy="262" r="9" fill="#2b2b2b"/>
  <path d="M${S / 2 - 34} 318 Q${S / 2} ${r.int(336, 350)} ${S / 2 + 34} 318" stroke="#7a3b30" stroke-width="7" fill="none" stroke-linecap="round"/>
  <rect width="${S}" height="${S}" filter="url(#n)" opacity=".55" style="mix-blend-mode:overlay"/>
</svg>`;
}

let bytes = 0;
for (let i = 0; i < PHOTOS; i += 1) {
  const svg = portrait(i);
  const big = await sharp(Buffer.from(svg), { density: 72 * (PHOTO_SIZE / 600) })
    .resize(PHOTO_SIZE, PHOTO_SIZE)
    .jpeg({ quality: PHOTO_QUALITY, chromaSubsampling: '4:4:4' })
    .toBuffer();
  fs.writeFileSync(path.join(imgBig, `${i}.jpg`), big);
  bytes += big.length;
  const thumb = await sharp(big).resize(160, 160).jpeg({ quality: 80 }).toBuffer();
  fs.writeFileSync(path.join(imgThumb, `${i}.jpg`), thumb);
  bytes += thumb.length;
}
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#0f766e"/><circle cx="128" cy="98" r="40" fill="#ccfbf1"/><path d="M52 206 Q52 144 128 144 Q204 144 204 206 Z" fill="#ccfbf1"/></svg>`;
await sharp(Buffer.from(icon)).png().toFile(path.join(fePublic, 'icon.png'));
console.log(`ảnh ${PHOTOS} x2, tổng ${(bytes / 1048576).toFixed(1)} MB`);
