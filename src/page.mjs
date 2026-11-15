// Рендер страницы в готовый HTML. Весь текст и цифры попадают в разметку на этапе сборки,
// чтобы поисковики видели содержимое без выполнения скриптов.
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WIND = ['северный', 'северо-восточный', 'восточный', 'юго-восточный', 'южный', 'юго-западный', 'западный', 'северо-западный'];
const SYMBOLS = {
  clearsky: 'Ясно', fair: 'Малооблачно', partlycloudy: 'Переменная облачность', cloudy: 'Пасмурно', fog: 'Туман',
  lightrain: 'Небольшой дождь', rain: 'Дождь', heavyrain: 'Сильный дождь',
  lightrainshowers: 'Кратковременный дождь', rainshowers: 'Ливни', heavyrainshowers: 'Сильные ливни',
  lightrainandthunder: 'Дождь с грозой', rainandthunder: 'Дождь с грозой', heavyrainandthunder: 'Сильный дождь с грозой',
  lightrainshowersandthunder: 'Ливни с грозой', rainshowersandthunder: 'Ливни с грозой', heavyrainshowersandthunder: 'Сильные ливни с грозой',
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (x, d = 0) => Number(x).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
const capital = s => s[0].toUpperCase() + s.slice(1);
const dayMonth = iso => `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;
const weekday = iso => WEEKDAYS[new Date(iso.slice(0, 10) + 'T00:00:00Z').getUTCDay()];
const condition = symbol => SYMBOLS[String(symbol || '').replace(/_(day|night|polartwilight)$/, '')] || '';
const pct = x => `${Math.max(0, Math.min(100, x)).toFixed(1)}%`;

// Состояние моря по шкале Дугласа (высота значительных волн). Цвет флажка — наша оценка для открытой воды.
function seaState(h) {
  if (h == null) return null;
  const title = h < 0.1 ? 'Штиль' : h < 0.5 ? 'Спокойное море' : h < 1.25 ? 'Слабое волнение' : h < 2.5 ? 'Умеренное волнение' : h < 4 ? 'Сильное волнение' : 'Очень сильное волнение';
  return { key: h < 1.25 ? 'green' : h < 2.5 ? 'yellow' : 'red', title };
}
const flagSvg = (key, size = 30) =>
  `<svg class="flag flag-${key}" width="${size}" height="${size}" viewBox="0 0 30 30" aria-hidden="true">` +
  `<rect class="flag-pole" x="5" y="2" width="2.4" height="26" rx="1.2"/>` +
  `<path class="flag-cloth" d="M8 4c4-2 7 2 11 0s5-1 6-1v12c-1 0-2-1-6 1s-7-2-11 0z"/></svg>`;

function rangeBar(lo, hi, min, max, cls) {
  const span = max - min || 1;
  return `<span class="track"><span class="bar ${cls}" style="left:${pct((lo - min) / span * 100)};width:${pct(Math.max((hi - lo) / span * 100, 2))}"></span></span>`;
}
function magnitudeBar(v, max, cls) {
  return `<span class="track"><span class="bar bar-from-zero ${cls}" style="width:${pct(v / (max || 1) * 100)}"></span></span>`;
}

function nowSection(weather, waves, sst) {
  const c = weather.current, today = c.time.slice(0, 10);
  const cond = condition(c.symbol);
  const lead = [cond, c.feels != null && Math.abs(c.feels - c.temp) >= 1 ? `ощущается как ${fmt(c.feels)}°` : ''].filter(Boolean).join(', ');
  const uv = weather.uv, sun = weather.sun;
  const air = `
    <div class="pane">
      <p class="eyebrow">Воздух</p>
      <p class="big">${fmt(c.temp)}°</p>
      ${lead ? `<p class="lead">${esc(capital(lead))}</p>` : ''}
      <dl class="facts">
        <div><dt>Ветер</dt><dd>${fmt(c.wind, 1)} м/с, ${WIND[Math.round(c.windDir / 45) % 8]}</dd></div>
        <div><dt>Влажность</dt><dd>${fmt(c.humidity)}%</dd></div>
        ${sun ? `<div><dt>Рассвет и закат</dt><dd>${sun.sunrise} и ${sun.sunset}</dd></div>` : ''}
        ${uv ? `<div><dt>УФ-индекс в полдень, ${uv.date === today ? 'сегодня' : dayMonth(uv.date)}</dt><dd>${fmt(uv.value)} при ясном небе</dd></div>` : ''}
      </dl>
    </div>`;
  const state = waves ? seaState(waves.current.height) : null;
  const water = (sst || waves) ? `
    <div class="pane">
      <p class="eyebrow">Море</p>
      ${sst ? `<p class="big">${fmt(sst.water, 1)}°</p>
      <p class="lead">Вода у берега, спутниковый замер за ${dayMonth(sst.date)}</p>` : ''}
      ${waves ? `<dl class="facts">
        <div><dt>Волна в открытом море</dt><dd>${fmt(waves.current.height, 1)} м</dd></div>
        <div><dt>Период волны</dt><dd>${fmt(waves.current.period)} с</dd></div>
      </dl>
      <div class="verdict">${flagSvg(state.key)}<p><strong>${state.title}</strong><span>в 40 км от берега, в бухте волна обычно ниже</span></p></div>` : ''}
    </div>` : `
    <div class="pane">
      <p class="eyebrow">Море</p>
      <p class="lead">Данные о море сейчас недоступны. Обновим при следующей сборке.</p>
    </div>`;
  return `<section class="now" aria-label="Погода и море сейчас">${air}${water}</section>`;
}

function weekSection(weather, waves) {
  const days = weather.daily, todayIso = weather.current.time.slice(0, 10);
  const tMin = Math.min(...days.map(d => d.tmin)), tMax = Math.max(...days.map(d => d.tmax));
  const rainMax = Math.max(20, ...days.map(d => d.rain));
  const waveBy = Object.fromEntries((waves?.daily || []).map(d => [d.date, d.waveMax]));
  const rows = days.map(d => {
    const w = waveBy[d.date], f = seaState(w);
    return `
    <li class="row week-row">
      <span class="c-day"><b>${weekday(d.date)}, ${dayMonth(d.date)}</b>${d.date === todayIso ? '<i class="tag">сегодня</i>' : ''}</span>
      <span class="c-cond">${esc(condition(d.symbol))}</span>
      <span class="c-temp"><span class="k">Воздух</span><span class="num lo">${fmt(d.tmin)}°</span>${rangeBar(d.tmin, d.tmax, tMin, tMax, 'bar-temp')}<span class="num hi">${fmt(d.tmax)}°</span></span>
      <span class="c-rain"><span class="k">Дождь</span>${magnitudeBar(d.rain, rainMax, 'bar-rain')}<span class="num rain-val">${fmt(d.rain, 1)} мм</span></span>
      <span class="c-wave"><span class="k">Волна до</span>${w != null ? `${flagSvg(f.key, 16)}<span class="num">${fmt(w, 1)} м</span><span class="sr">${f.title}</span>` : '<span class="num dim">нет прогноза</span>'}</span>
    </li>`;
  }).join('');
  return `
  <section aria-labelledby="h-week">
    <h2 id="h-week">Прогноз на неделю</h2>
    <ul class="rows">
      <li class="row week-row head" aria-hidden="true"><span>День</span><span>Погода</span><span>Воздух, мин. и макс.</span><span>Дождь за сутки</span><span>Волна до</span></li>${rows}
    </ul>
    <p class="note">Флажок у высоты волны: зелёный до 1,25 м, жёлтый до 2,5 м, красный выше. Это расчёт для открытого моря в 40 км от берега. В бухте волна обычно ниже, а на пляже смотрите на флаги спасателей.</p>
  </section>`;
}

function fxSection(fx) {
  if (!fx) return '';
  const vndPerRub = 1 / fx.rubPerVnd, vndPerUsd = fx.rubPerUsd / fx.rubPerVnd;
  return `
  <section aria-labelledby="h-fx">
    <h2 id="h-fx">Курс донга</h2>
    <div class="fx">
      <dl class="rates">
        <div><dt>10 000 донгов</dt><dd>${fmt(fx.rubPerVnd * 10000, 2)} ₽</dd></div>
        <div><dt>1 рубль</dt><dd>${fmt(vndPerRub)} ₫</dd></div>
        <div><dt>1 доллар</dt><dd>${fmt(vndPerUsd)} ₫</dd></div>
      </dl>
      <form class="conv" id="conv" data-vnd="${fx.rubPerVnd}" data-usd="${fx.rubPerUsd}" novalidate>
        <label for="conv-rub">Рубли<span class="field"><input id="conv-rub" data-cur="rub" inputmode="decimal" autocomplete="off" value="${fmt(10000)}"><em>₽</em></span></label>
        <label for="conv-vnd">Донги<span class="field"><input id="conv-vnd" data-cur="vnd" inputmode="decimal" autocomplete="off" value="${fmt(10000 * vndPerRub)}"><em>₫</em></span></label>
        <label for="conv-usd">Доллары<span class="field"><input id="conv-usd" data-cur="usd" inputmode="decimal" autocomplete="off" value="${fmt(10000 / fx.rubPerUsd, 2)}"><em>$</em></span></label>
      </form>
    </div>
    <p class="note">Официальный курс ЦБ РФ на ${dayMonth(fx.date)}, курс доллара к донгу посчитан через рубль. В обменниках и банкоматах Нячанга курс будет другим.</p>
  </section>`;
}

function climateSection(climate, nowIso) {
  if (!climate) return '';
  const ms = climate.months, cur = Number(nowIso.slice(5, 7)) - 1;
  const tMin = Math.min(...ms.map(m => m.tmin)), tMax = Math.max(...ms.map(m => m.tmax));
  const rainMax = Math.max(...ms.map(m => m.rain));
  const byRain = ms.map((m, i) => ({ i, rain: m.rain })).sort((a, b) => a.rain - b.rain);
  const names = list => list.map(x => x.i).sort((a, b) => a - b).map(i => MONTHS[i]).join(', ');
  const rows = ms.map((m, i) => `
    <li class="row month-row">
      <span class="c-day"><b>${capital(MONTHS[i])}</b>${i === cur ? '<i class="tag">сейчас</i>' : ''}</span>
      <span class="c-temp"><span class="k">Воздух</span><span class="num lo">${fmt(m.tmin)}°</span>${rangeBar(m.tmin, m.tmax, tMin, tMax, 'bar-temp')}<span class="num hi">${fmt(m.tmax)}°</span></span>
      <span class="c-rain"><span class="k">Осадки</span>${magnitudeBar(m.rain, rainMax, 'bar-rain')}<span class="num rain-val">${fmt(m.rain)} мм</span></span>
      <span class="c-wet"><span class="k">Дней с дождём</span><span class="num">${fmt(m.wetDays)}</span></span>
    </li>`).join('');
  return `
  <section aria-labelledby="h-climate">
    <h2 id="h-climate">Погода в Нячанге по месяцам</h2>
    <p class="summary">Меньше всего осадков выпадает в месяцы: ${names(byRain.slice(0, 3))}. Больше всего: ${names(byRain.slice(-3))}.</p>
    <ul class="rows">
      <li class="row month-row head" aria-hidden="true"><span>Месяц</span><span>Воздух ночью и днём</span><span>Осадки за месяц</span><span>Дней с дождём</span></li>${rows}
    </ul>
    <p class="note">Средние значения за ${climate.from}–${climate.to} годы по наблюдениям метеостанции. День с дождём считается от 1 мм осадков.</p>
  </section>`;
}

function partnersSection(partners) {
  if (!Array.isArray(partners) || !partners.length) return '';
  const items = partners.map(p => `<li><a href="${esc(p.url)}" target="_blank" rel="sponsored noopener">${esc(p.title)}</a><span>${esc(p.text || '')}</span></li>`).join('');
  return `
  <section aria-labelledby="h-plan">
    <h2 id="h-plan">Спланировать поездку</h2>
    <ul class="partners">${items}</ul>
    <p class="note">Ссылки партнёрские: если вы что-то купите по ним, сайт получит комиссию. Цена для вас не меняется.</p>
  </section>`;
}

const SCRIPT = `
(function () {
  var form = document.getElementById('conv');
  if (!form) return;
  var rate = { rub: 1, vnd: parseFloat(form.dataset.vnd), usd: parseFloat(form.dataset.usd) };
  var digits = { rub: 0, vnd: 0, usd: 2 };
  var inputs = form.querySelectorAll('input');
  function show(x, cur) { return x.toLocaleString('ru-RU', { minimumFractionDigits: digits[cur], maximumFractionDigits: digits[cur] }); }
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  form.addEventListener('input', function (e) {
    var src = e.target.dataset.cur;
    var value = parseFloat(e.target.value.replace(/[\\s\\u00a0\\u202f]/g, '').replace(',', '.'));
    inputs.forEach(function (el) {
      if (el === e.target) return;
      el.value = isFinite(value) ? show(value * rate[src] / rate[el.dataset.cur], el.dataset.cur) : '';
    });
  });
})();`;

export function renderPage(data, { siteUrl = '', config = {}, fragment = false } = {}) {
  const { weather, waves, sst, fx, climate } = data;
  const c = weather.current;
  const stamp = `${dayMonth(c.time)}, ${c.time.slice(11, 16)}`;
  const description = `Нячанг сейчас: воздух ${fmt(c.temp)}°` +
    (sst ? `, вода ${fmt(sst.water, 1)}°` : '') + (waves ? `, волна в море ${fmt(waves.current.height, 1)} м` : '') +
    `. Прогноз на неделю и курс донга к рублю.`;
  const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=Unbounded:wght@400;600&display=swap">`;
  const body = `
<div class="page">
  <header class="top">
    <h1>Нячанг сейчас</h1>
    <p class="stamp">Данные на <time datetime="${c.time}+07:00">${stamp}</time> по местному времени</p>
  </header>
  <main>
    ${nowSection(weather, waves, sst)}
    ${weekSection(weather, waves)}
    ${fxSection(fx)}
    ${climateSection(climate, c.time)}
    ${partnersSection(config.partners)}
  </main>
  <footer class="foot">
    <p>Источники: погода — <a href="https://www.met.no/en" target="_blank" rel="noopener">MET Norway</a> (CC BY 4.0); волны — модель NOAA WAVEWATCH III через <a href="https://www.pacioos.hawaii.edu/" target="_blank" rel="noopener">PacIOOS</a>; температура воды — NASA JPL MUR SST через NOAA CoastWatch; курсы валют — Банк России.</p>
    <p>Страница обновляется автоматически несколько раз в день. Это расчётные данные моделей, а не официальный прогноз. Перед выходом в море уточняйте обстановку на месте.</p>
  </footer>
</div>
<script>${SCRIPT}</script>`;

  if (fragment) {
    return `<title>Нячанг сейчас</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<style>${CSS}</style>\n${body}\n`;
  }
  const title = 'Нячанг сейчас: погода, температура моря и курс донга';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${esc(description)}">
${siteUrl ? `<link rel="canonical" href="${esc(siteUrl)}/">\n<meta property="og:url" content="${esc(siteUrl)}/">` : ''}
<meta property="og:type" content="website">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
${fonts}
<style>${CSS}</style>
</head>
<body>${body}
</body>
</html>
`;
}
