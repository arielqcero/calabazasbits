// Configuración
const CFG = {
  lat: -34.77,
  lon: -58.17,
  tz: 'America/Argentina/Buenos_Aires',
  refreshMs: 15 * 60 * 1000 // 15 minutos
};

// Utilidades
const set = (sel, val) => { const el = document.querySelector(sel); if (el) el.textContent = val; };
const degToCompass = deg => {
  if (deg == null) return '--';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW','N'];
  return `${dirs[Math.round(deg / 22.5)]} (${Math.round(deg)}°)`;
};

// Relojes
function startClocks() {
  const tick = () => {
    const d = new Date();
    // Hora en formato 24hs
    set('#time-local', d.toLocaleTimeString('es-AR', { timeZone: CFG.tz, hour12: false }));
    set('#date-local', d.toLocaleDateString('es-AR', { timeZone: CFG.tz, day: '2-digit', month: '2-digit', year: 'numeric' }));
    set('#time-utc', d.toLocaleTimeString('es-AR', { timeZone: 'UTC', hour12: false }));
    set('#date-utc', d.toLocaleDateString('es-AR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }));
  };
  tick();
  setInterval(tick, 1000);
}

// Clima: Open‑Meteo (público y gratuito)
async function fetchWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CFG.lat}&longitude=${CFG.lon}&current=temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_gusts_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max,weathercode&timezone=${CFG.tz}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Open‑Meteo no responde');
    const data = await res.json();

    const c = data.current;
    set('#temp', `${Math.round(c.temperature_2m)} °C`);
    set('#humidity', `${Math.round(c.relative_humidity_2m)} %`);
    set('#pressure', `${Math.round(c.pressure_msl)} hPa`);
    set('#wind', `${Math.round(c.wind_speed_10m)} km/h`);
    set('#gusts', `${Math.round(c.wind_gusts_10m)} km/h`);
    set('#wind-dir', degToCompass(c.wind_direction_10m));

    const dly = data.daily;
    set('#forecast-now', weatherCodeToText(dly.weathercode[0]));
    set('#minmax', `${Math.round(dly.temperature_2m_min[1])} / ${Math.round(dly.temperature_2m_max[1])} °C`);
    set('#wind-max-tomorrow', `${Math.round(dly.wind_speed_10m_max[1])} km/h`);
    set('#gusts-max-tomorrow', `${Math.round(dly.wind_gusts_10m_max[1])} km/h`);
    set('#forecast-tomorrow', weatherCodeToText(dly.weathercode[1]));
  } catch (e) {
    console.error('Error clima:', e);
  }
}

// Función auxiliar para agregar una banda a la lista
function addBand(parent, name, status) {
  const li = document.createElement('li');
  li.textContent = `${name}: ${status}`;
  parent.appendChild(li);
}

// Propagación propia: NOAA SWPC (público y gratuito) + reglas simples
async function fetchSolar() {
  try {
    // Kp (último minuto)
    const kpRes = await fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', { cache: 'no-store' });
    const kpJson = await kpRes.json();
    const kp = Number(kpJson[kpJson.length - 1]?.kp_index ?? NaN);

    // X-ray flux como proxy (simple) para actividad solar
    const xrRes = await fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json', { cache: 'no-store' });
    const xrJson = await xrRes.json();
    const lastFlux = Number(xrJson[xrJson.length - 1]?.flux ?? NaN);

    // Estimar SFI de forma básica (POC). Nota: en producción conviene consumir SFI directo si disponible.
    const sfi = Number.isFinite(lastFlux) ? Math.round(90 + lastFlux * 1200) : 100;

    // Índice A aproximado desde Kp (heurística simple)
    const a = Number.isFinite(kp) ? Math.round(kp * 3) : 8;

    set('#kp', Number.isFinite(kp) ? kp : '--');
    set('#sfi', Number.isFinite(sfi) ? sfi : '--');
    set('#a-index', Number.isFinite(a) ? a : '--');

    // MUF y estados de banda
    const muf = estimateMUF(sfi, kp);
    set('#muf', `${muf.toFixed(1)} MHz`);

    const ul = document.querySelector('#bands-list');
    ul.innerHTML = '';
    addBand(ul, 'HF baja (160/80 m)', bandStatus('low', sfi, kp));
    addBand(ul, 'HF media (40/30 m)', bandStatus('mid', sfi, kp));
    addBand(ul, 'HF alta (20/17/15 m)', bandStatus('high', sfi, kp));
    addBand(ul, '10 m', bandStatus('10', sfi, kp));
    addBand(ul, '6 m', bandStatus('6', sfi, kp));

    set('#windows', estimateWindows(muf, kp));
  } catch (e) {
    console.error('Error solar/NOAA:', e);
    set('#kp', '--'); set('#sfi', '--'); set('#a-index', '--'); set('#muf', '--'); set('#windows', 'Sin datos');
  }
}

// Heurísticas (reglas simples)
function estimateMUF(sfi, kp) {
  if (!Number.isFinite(sfi)) sfi = 100;
  if (!Number.isFinite(kp)) kp = 2;
  const base = 3;
  const factor = 0.08 * sfi + 0.5;      // sube con SFI
  const penalty = Math.max(0.7, 1 - kp * 0.06); // baja con Kp
  return base * factor * penalty;
}

function bandStatus(band, sfi, kp) {
  sfi = Number(sfi) || 100;
  kp = Number(kp) || 2;
  const good = sfi >= 120 && kp <= 3;
  const fair = sfi >= 80 && kp <= 5;
  switch (band) {
    case 'low': return kp <= 4 ? 'Abierta (noche/local)' : 'Ruidosa';
    case 'mid': return good ? 'Buena' : fair ? 'Aceptable' : 'Floja';
    case 'high': return good ? 'Buena' : fair ? 'Variable' : 'Cerrada parcial';
    case '10': return sfi >= 100 && kp <= 3 ? 'Aperturas diurnas' : 'Esporádica';
    case '6': return kp <= 3 ? 'Posible Es/TEP' : 'Esporádica';
    default: return 'Variable';
  }
}

function estimateWindows(muf, kp) {
  const notes = [];
  if (muf > 18) notes.push('20 m diurno, 17/15 m ventanas cortas');
  if (muf > 24) notes.push('10 m posible al mediodía');
  if (kp >= 5) notes.push('Geomagnética activa: HF ruidosa');
  if (notes.length === 0) notes.push('Ventanas estándar según hora local');
  return notes.join(' — ');
}

// Tabla de pronósticos meteorológicos (texto)
function weatherCodeToText(code) {
  const map = {
    0:'Despejado',1:'Mayormente despejado',2:'Parcialmente nublado',3:'Nublado',
    45:'Niebla',48:'Niebla con escarcha',
    51:'Llovizna ligera',53:'Llovizna',55:'Llovizna intensa',
    61:'Lluvia ligera',63:'Lluvia',65:'Lluvia intensa',
    66:'Lluvia helada ligera',67:'Lluvia helada',
    71:'Nieve ligera',73:'Nieve',75:'Nieve intensa',
    80:'Chubascos ligeros',81:'Chubascos',82:'Chubascos intensos',
    95:'Tormenta',96:'Tormenta con granizo',99:'Tormenta fuerte con granizo'
  };
  return map[code] || 'Sin datos';
}

//sunrise/sunset y moonrise/moonset + moonphase
async function fetchAstronomy() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CFG.lat}&longitude=${CFG.lon}&daily=sunrise,sunset,moonphase&timezone=${CFG.tz}`;
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Open-Meteo error: ${res.status} ${txt}`);
    }
    const data = await res.json();

    // Hoy
    set('#sunrise-today', formatTime(data.daily.sunrise[0]));
    set('#sunset-today', formatTime(data.daily.sunset[0]));
    set('#moonphase-today', moonPhaseText(data.daily.moonphase[0]));

    // Mañana
    set('#sunrise-tomorrow', formatTime(data.daily.sunrise[1]));
    set('#sunset-tomorrow', formatTime(data.daily.sunset[1]));
  } catch (e) {
    console.error("Error astronomía:", e);
  }
}

// Formatear hora en 24hs
function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Traducir fase de la luna
function moonPhaseText(val) {
  const phases = [
    "Luna nueva", "Creciente", "Cuarto creciente",
    "Gibosa creciente", "Luna llena", "Gibosa menguante",
    "Cuarto menguante", "Creciente menguante"
  ];
  // Open-Meteo devuelve 0–1 (fracción del ciclo lunar)
  if (val === 0) return "Luna nueva";
  if (val < 0.25) return "Creciente";
  if (val === 0.25) return "Cuarto creciente";
  if (val < 0.5) return "Gibosa creciente";
  if (val === 0.5) return "Luna llena";
  if (val < 0.75) return "Gibosa menguante";
  if (val === 0.75) return "Cuarto menguante";
  return "Creciente menguante";
}

function formatTime(isoString) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function moonPhaseText(val) {
  if (val === null || val === undefined) return '--';
  if (val === 0) return "Luna nueva";
  if (val < 0.25) return "Creciente";
  if (val === 0.25) return "Cuarto creciente";
  if (val < 0.5) return "Gibosa creciente";
  if (val === 0.5) return "Luna llena";
  if (val < 0.75) return "Gibosa menguante";
  if (val === 0.75) return "Cuarto menguante";
  return "Creciente menguante";
}


// Inicialización
window.addEventListener('DOMContentLoaded', () => {
  // Arranca los relojes en formato 24hs y fecha dd/mm/yyyy
  startClocks();

  // Primera carga de datos
  fetchWeather();
  fetchSolar();

  // Refrescar cada 15 minutos (900000 ms)
  setInterval(fetchWeather, CFG.refreshMs);
  setInterval(fetchSolar, CFG.refreshMs);
});