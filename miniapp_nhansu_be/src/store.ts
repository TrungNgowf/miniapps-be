import fs from 'node:fs';
import path from 'node:path';
import type { Employee, Leave } from './types.js';

export interface Meta {
  version: string;
  count: number;
}

const DAY = 86_400_000;

/** Dữ liệu nằm trong bộ nhớ. Đơn nghỉ phép được ghi lại vào data/leaves-live.json để sống sót qua lần khởi động lại. */
export class Store {
  readonly byId = new Map<number, Employee>();
  private liveFile: string;
  private timer: NodeJS.Timeout | null = null;

  private constructor(
    readonly meta: Meta,
    readonly employees: Employee[],
    readonly leaves: Leave[],
    dataDir: string,
  ) {
    for (const e of employees) this.byId.set(e.id, e);
    this.liveFile = path.join(dataDir, 'leaves-live.json');
  }

  static load(dataDir: string): Store {
    const read = <T>(name: string): T => {
      const file = path.join(dataDir, name);
      if (!fs.existsSync(file)) throw new Error(`Thiếu ${file}. Chạy "pnpm gen" trước.`);
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    };
    const live = path.join(dataDir, 'leaves-live.json');
    const leaves = fs.existsSync(live) ? (JSON.parse(fs.readFileSync(live, 'utf8')) as Leave[]) : read<Leave[]>('leaves.json');
    return new Store(read<Meta>('meta.json'), read<Employee[]>('employees.json'), leaves, dataDir);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      fs.writeFileSync(this.liveFile, JSON.stringify(this.leaves));
    }, 300);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    fs.writeFileSync(this.liveFile, JSON.stringify(this.leaves));
  }

  addLeave(leave: Leave): void {
    this.leaves.unshift(leave);
    this.schedule();
  }

  touch(): void {
    this.schedule();
  }

  /** Chấm công 30 ngày gần nhất, suy ra từ mã nhân viên nên mỗi lần gọi cho cùng kết quả. */
  attendance(emp: Employee, days = 30): { date: string; status: 'present' | 'late' | 'absent' | 'weekend'; hours: number }[] {
    const out: { date: string; status: 'present' | 'late' | 'absent' | 'weekend'; hours: number }[] = [];
    const now = Date.now();
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(now - i * DAY);
      const date = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) {
        out.push({ date, status: 'weekend', hours: 0 });
        continue;
      }
      const h = hash(emp.id * 7919 + Math.floor(d.getTime() / DAY));
      const r = (h % 1000) / 1000;
      if (r < 0.04) out.push({ date, status: 'absent', hours: 0 });
      else if (r < 0.16) out.push({ date, status: 'late', hours: 7 + ((h >> 10) % 20) / 10 });
      else out.push({ date, status: 'present', hours: 8 + ((h >> 10) % 15) / 10 });
    }
    return out;
  }

  /** Số liệu tổng hợp, tính một lần (dữ liệu nhân viên không đổi trong lúc chạy). */
  private statsCache: unknown = null;
  stats(withSalary: boolean): unknown {
    if (!this.statsCache) {
      const byDept = new Map<string, { count: number; salary: number }>();
      const byLevel = new Array<number>(8).fill(0);
      const byBranch = new Map<string, number>();
      const ages = new Array<number>(9).fill(0);
      const hires = new Map<string, number>();
      let late = 0;
      let total = 0;
      for (const e of this.employees) {
        const d = byDept.get(e.dept) ?? { count: 0, salary: 0 };
        d.count += 1;
        d.salary += e.salary;
        byDept.set(e.dept, d);
        byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
        byBranch.set(e.branch, (byBranch.get(e.branch) ?? 0) + 1);
        const ai = Math.min(8, Math.max(0, Math.floor((e.age - 20) / 5)));
        ages[ai] = (ages[ai] ?? 0) + 1;
        const m = e.hired.slice(0, 7);
        hires.set(m, (hires.get(m) ?? 0) + 1);
      }
      const sample = this.employees.filter((e) => e.id % 20 === 0);
      const daily = new Map<string, { present: number; late: number; absent: number }>();
      for (const e of sample) {
        for (const a of this.attendance(e)) {
          if (a.status === 'weekend') continue;
          const r = daily.get(a.date) ?? { present: 0, late: 0, absent: 0 };
          r[a.status] += 1;
          daily.set(a.date, r);
          total += 1;
          if (a.status === 'late') late += 1;
        }
      }
      const months: { month: string; count: number }[] = [];
      const base = new Date();
      for (let i = 23; i >= 0; i -= 1) {
        const m = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
        months.push({ month: m, count: hires.get(m) ?? 0 });
      }
      this.statsCache = {
        headcount: this.employees.length,
        byDept: [...byDept].map(([name, v]) => ({ name, count: v.count, avgSalary: Math.round(v.salary / v.count) })),
        byLevel: byLevel.slice(1).map((count, i) => ({ level: i + 1, count })),
        byBranch: [...byBranch].map(([name, count]) => ({ name, count })),
        ages: ages.map((count, i) => ({ range: `${20 + i * 5}-${24 + i * 5}`, count })),
        hires: months,
        attendance: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
        lateRate: total ? late / total : 0,
      };
    }
    const s = this.statsCache as { byDept: { name: string; count: number; avgSalary?: number }[] };
    if (withSalary) return s;
    return { ...s, byDept: s.byDept.map(({ avgSalary: _a, ...rest }) => rest) };
  }
}

function hash(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
