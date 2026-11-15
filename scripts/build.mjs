// Собирает сайт: тянет данные, сохраняет data/latest.json, пишет dist/.
// Каждый источник независим: если он недоступен, берётся прошлое значение из data/latest.json.
//
// Источники (все разрешают коммерческое использование с указанием авторства):
//   погода  — MET Norway Locationforecast 2.0 (CC BY 4.0), требует осмысленный User-Agent
//   волны   — NOAA WAVEWATCH III через PacIOOS ERDDAP
//   вода    — NASA JPL MUR SST через NOAA CoastWatch ERDDAP (запасной: NOAA OISST)
//   курсы   — Банк России через cbr-xml-daily.ru
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderPage } from '../src/page.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const FRAGMENT_OUT = process.env.FRAGMENT_OUT || '';
const USER_AGENT = process.env.USER_AGENT || 'static-weather-site/0.1';
const OFFLINE = process.argv.includes('--offline');

const LAT = 12.2451, LON = 109.1943;       // город
const WAVE_LAT = 12.0, WAVE_LON = 109.5;   // ближайшая морская ячейка модели волн, около 40 км от берега
const SST_LAT = 12.25, SST_LON = 109.3;    // залив
const UTC_OFFSET_H = 7;

const local = iso => new Date(Date.parse(iso) + UTC_OFFSET_H * 3600e3).toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:MM' по Нячангу
const nowIso = () => new Date().toISOString();

async function getJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90000), headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

async function fetchWeather() {
  const j = await getJson(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${LAT}&lon=${LON}`);
  const ts = j.properties.timeseries;
  const now = Date.now();
  const cur = [...ts].reverse().find(t => Date.parse(t.time) <= now) || ts[0];
  const ci = cur.data.instant.details;

  const days = new Map();
  for (const t of ts) {
    const lt = local(t.time), date = lt.slice(0, 10), hour = Number(lt.slice(11, 13));
    if (!days.has(date)) days.set(date, { date, temps: [], rain: 0, hours: 0, uv: [], firstHour: hour, entries: [] });
    const d = days.get(date), inst = t.data.instant.details, n1 = t.data.next_1_hours, n6 = t.data.next_6_hours;
    d.temps.push(inst.air_temperature);
    d.entries.push({ hour, t });
    if (n1) {
      d.rain += n1.details?.precipitation_amount ?? 0; d.hours += 1;
      if (hour >= 10 && hour <= 14 && inst.ultraviolet_index_clear_sky != null) d.uv.push(inst.ultraviolet_index_clear_sky);
    } else if (n6) {
      d.rain += n6.details?.precipitation_amount ?? 0; d.hours += 6;
      if (n6.details?.air_temperature_max != null) d.temps.push(n6.details.air_temperature_max, n6.details.air_temperature_min);
    }
  }
  const symbolOf = d => {
    const morning = d.entries.find(e => e.hour >= 6 && e.hour <= 9 && e.t.data.next_12_hours);
    const pick = morning ? morning.t.data.next_12_hours : (d.entries[0].t.data.next_6_hours || d.entries[0].t.data.next_12_hours || d.entries[0].t.data.next_1_hours);
    return pick?.summary?.symbol_code || null;
  };
  const all = [...days.values()];
  const daily = all.filter(d => d.firstHour <= 9 && d.hours >= 15).slice(0, 7).map(d => ({
    date: d.date, symbol: symbolOf(d), tmax: Math.max(...d.temps), tmin: Math.min(...d.temps), rain: d.rain,
  }));
  if (!daily.length) throw new Error('в прогнозе нет полных суток');
  const uvDay = all.find(d => d.uv.length >= 4);

  const today = local(nowIso()).slice(0, 10);
  let sun = null;
  try {
    const s = await getJson(`https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${LAT}&lon=${LON}&date=${today}&offset=%2B07:00`, 2);
    sun = { date: today, sunrise: s.properties.sunrise.time.slice(11, 16), sunset: s.properties.sunset.time.slice(11, 16) };
  } catch { /* без рассвета страница тоже полная */ }

  return {
    fetchedAt: nowIso(),
    current: {
      time: local(cur.time), temp: ci.air_temperature, feels: ci.apparent_air_temperature ?? null, humidity: ci.relative_humidity,
      wind: ci.wind_speed, windDir: ci.wind_from_direction,
      symbol: (cur.data.next_1_hours || cur.data.next_6_hours)?.summary?.symbol_code || null,
    },
    uv: uvDay ? { date: uvDay.date, value: Math.max(...uvDay.uv) } : null,
    sun,
    daily,
  };
}

async function fetchWaves() {
  const from = new Date(Date.now() - 3600e3).toISOString().slice(0, 13) + ':00:00Z';
  const sel = `[(${from}):1:(last)][(0.0)][(${WAVE_LAT})][(${WAVE_LON})]`;
  const j = await getJson(`https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ww3_global.json?Thgt${sel},Tper${sel}`);
  const rows = j.table.rows.filter(r => r[4] != null).map(r => ({ time: r[0], h: r[4], period: r[5] }));
  if (!rows.length) throw new Error('пустой ответ модели волн');
  const now = Date.now();
  const cur = rows.reduce((a, b) => Math.abs(Date.parse(b.time) - now) < Math.abs(Date.parse(a.time) - now) ? b : a);
  const byDay = new Map();
  for (const r of rows) {
    const date = local(r.time).slice(0, 10), d = byDay.get(date) || { date, max: 0, n: 0 };
    d.max = Math.max(d.max, r.h); d.n += 1; byDay.set(date, d);
  }
  const today = local(nowIso()).slice(0, 10);
  return {
    fetchedAt: nowIso(),
    current: { time: local(cur.time), height: cur.h, period: cur.period },
    daily: [...byDay.values()].filter(d => d.n >= 12 || d.date === today).map(d => ({ date: d.date, waveMax: d.max })),
  };
}

async function fetchSst() {
  try {
    const j = await getJson(`https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json?analysed_sst[(last)][(${SST_LAT})][(${SST_LON})]`, 2);
    const r = j.table.rows[0];
    if (r?.[3] == null) throw new Error('нет значения');
    return { fetchedAt: nowIso(), date: r[0].slice(0, 10), water: r[3], source: 'MUR' };
  } catch {
    const j = await getJson(`https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21NrtAgg.json?sst[(last)][(0.0)][(12.375)][(109.375)]`, 2);
    const r = j.table.rows[0];
    if (r?.[4] == null) throw new Error('нет значения');
    return { fetchedAt: nowIso(), date: r[0].slice(0, 10), water: r[4], source: 'OISST' };
  }
}

async function fetchFx() {
  const j = await getJson('https://www.cbr-xml-daily.ru/daily_json.js');
  const vnd = j.Valute?.VND, usd = j.Valute?.USD;
  if (!vnd || !usd) throw new Error('в ответе ЦБ нет VND или USD');
  return { fetchedAt: nowIso(), date: j.Date.slice(0, 10), rubPerVnd: vnd.Value / vnd.Nominal, rubPerUsd: usd.Value / usd.Nominal };
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

const prev = await readJson(path.join(ROOT, 'data/latest.json'), {});
const config = await readJson(path.join(ROOT, 'config.json'), {});
const data = { ...prev };
// Раздел «по месяцам» появится, когда в data/latest.json будет блок climate из данных метеостанции.
const report = [];

async function refresh(key, fn, { skip = false } = {}) {
  if (skip || OFFLINE) { report.push(`${key}: без обновления`); return; }
  try { data[key] = await fn(); report.push(`${key}: обновлено`); }
  catch (e) { report.push(`${key}: ОШИБКА (${e.message}), ${prev[key] ? 'оставлены прошлые данные' : 'данных нет'}`); }
}

await Promise.all([
  refresh('weather', fetchWeather),
  refresh('waves', fetchWaves),
  refresh('sst', fetchSst),
  refresh('fx', fetchFx),
]);
console.log(report.join('\n'));

if (!data.weather) { console.error('Нет данных о погоде, сборка остановлена.'); process.exit(1); }
// Прогноз старше суток показывать нельзя: лучше оставить на сайте прошлую сборку.
if ((Date.now() - Date.parse(data.weather.fetchedAt)) / 36e5 > 24 && !OFFLINE) { console.error('Данные о погоде старше суток, сборка остановлена.'); process.exit(1); }
data.builtAt = nowIso();

await mkdir(path.join(ROOT, 'data'), { recursive: true });
await mkdir(path.join(ROOT, 'dist'), { recursive: true });
await writeFile(path.join(ROOT, 'data/latest.json'), JSON.stringify(data, null, 1) + '\n');
await writeFile(path.join(ROOT, 'dist/index.html'), renderPage(data, { siteUrl: SITE_URL, config }));
await writeFile(path.join(ROOT, 'dist/data.json'), JSON.stringify(data));
await writeFile(path.join(ROOT, 'dist/robots.txt'), `User-agent: *\nAllow: /\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ''}`);
if (SITE_URL) {
  await writeFile(path.join(ROOT, 'dist/sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `<url><loc>${SITE_URL}/</loc><lastmod>${data.builtAt.slice(0, 10)}</lastmod><changefreq>hourly</changefreq></url>\n</urlset>\n`);
}
if (FRAGMENT_OUT) await writeFile(FRAGMENT_OUT, renderPage(data, { siteUrl: SITE_URL, config, fragment: true }));
console.log('Готово: dist/index.html');
