// Разовый расчёт климатических средних по наблюдениям метеостанции Нячанга (NOAA GSOD, станция 48877).
// Результат пишется в data/climate.json и хранится в репозитории; перезапускать раз в год-два.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATION = '48877099999', FROM = '2016-01-01', TO = process.env.CLIMATE_TO || '2025-12-31';

const res = await fetch(`https://www.ncei.noaa.gov/access/services/data/v1?dataset=global-summary-of-the-day&stations=${STATION}` +
  `&startDate=${FROM}&endDate=${TO}&dataTypes=MAX,MIN,PRCP&format=json`, { signal: AbortSignal.timeout(180000) });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const rows = await res.json();
if (!rows.length) throw new Error('пустой ответ');

// GSOD отдаёт градусы Фаренгейта и дюймы; 9999.9 и 99.99 означают пропуск.
const byMonth = new Map();
for (const r of rows) {
  const key = r.DATE.slice(0, 7);
  if (!byMonth.has(key)) byMonth.set(key, { tmax: [], tmin: [], rain: [] });
  const m = byMonth.get(key), mx = Number(r.MAX), mn = Number(r.MIN), p = Number(r.PRCP);
  if (mx < 9000) m.tmax.push((mx - 32) / 1.8);
  if (mn < 9000) m.tmin.push((mn - 32) / 1.8);
  if (p < 99) m.rain.push(p * 25.4);
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const months = Array.from({ length: 12 }, (_, i) => {
  const tmax = [], tmin = [], rain = [], wet = [];
  for (const [key, m] of byMonth) {
    if (Number(key.slice(5)) !== i + 1) continue;
    const days = new Date(Date.UTC(Number(key.slice(0, 4)), i + 1, 0)).getUTCDate();
    tmax.push(...m.tmax); tmin.push(...m.tmin);
    // Месяц идёт в расчёт осадков, если есть замеры хотя бы за 80% дней; сумма приводится к полному месяцу.
    if (m.rain.length >= 0.8 * days) {
      const k = days / m.rain.length;
      rain.push(m.rain.reduce((s, x) => s + x, 0) * k);
      wet.push(m.rain.filter(x => x >= 1).length * k);
    }
  }
  if (rain.length < 5) throw new Error(`мало данных за месяц ${i + 1}`);
  return { tmax: mean(tmax), tmin: mean(tmin), rain: mean(rain), wetDays: mean(wet), years: rain.length };
});
const last = rows[rows.length - 1].DATE;
const out = { fetchedAt: new Date().toISOString(), station: STATION, from: FROM.slice(0, 7), through: last.slice(0, 7), months };
await writeFile(path.join(ROOT, 'data/climate.json'), JSON.stringify(out, null, 1) + '\n');
console.log(months.map((m, i) => `${i + 1}: ${m.tmin.toFixed(1)}–${m.tmax.toFixed(1)}°, ${m.rain.toFixed(0)} мм, ${m.wetDays.toFixed(1)} дн.`).join('\n'));
