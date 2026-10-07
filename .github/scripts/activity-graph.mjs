// Gera o gráfico de atividade dos últimos N dias (versões clara e escura) a partir do
// calendário de contribuições da API GraphQL do GitHub. Uso: node activity-graph.mjs <pasta-de-saida>
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const USER = process.env.GH_USER || "viniventur";
const TOKEN = process.env.GITHUB_TOKEN;
const DAYS = Number(process.env.DAYS || 31);
const TIME_ZONE = process.env.TIME_ZONE || "America/Maceio";
const OUT_DIR = process.argv[2] || "dist";

const THEMES = {
  dark: { title: "#58A6FF", line: "#58A6FF", area: "#58A6FF", point: "#C9D1D9", text: "#8B949E", grid: "#30363D" },
  light: { title: "#0969DA", line: "#0969DA", area: "#0969DA", point: "#1F2328", text: "#656D76", grid: "#D0D7DE" },
};

const W = 1200, H = 420;
const PLOT = { left: 80, right: 1170, top: 78, bottom: 340 };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";

if (!TOKEN) throw new Error("Defina GITHUB_TOKEN.");

// Datas (AAAA-MM-DD) dos últimos DAYS dias, terminando hoje no fuso escolhido.
function lastDates() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
  const end = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - (DAYS - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

async function fetchCounts(dates) {
  const from = new Date(`${dates[0]}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const query = `query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) { contributionsCollection(from: $from, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: USER, from: from.toISOString(), to: new Date().toISOString() } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  const byDate = new Map();
  for (const week of json.data.user.contributionsCollection.contributionCalendar.weeks)
    for (const day of week.contributionDays) byDate.set(day.date, day.contributionCount);
  return dates.map((date) => ({ date, count: byDate.get(date) ?? 0 }));
}

// Passo "redondo" (1, 2 ou 5 × 10^k) para ~5 linhas de grade no eixo Y.
function niceStep(max) {
  const raw = Math.max(max, 1) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return Math.max(1, step);
}

// Curva monótona (Fritsch–Carlson): suave, sem ultrapassar os pontos nem descer abaixo de zero.
function monotonePath(pts) {
  const n = pts.length;
  if (n < 2) return `M${pts[0].x},${pts[0].y}`;
  const m = [];
  for (let i = 0; i < n - 1; i++) m.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  const f = (v) => +v.toFixed(2);
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1].x - pts[i].x) / 3;
    d += `C${f(pts[i].x + dx)},${f(pts[i].y + t[i] * dx)},${f(pts[i + 1].x - dx)},${f(pts[i + 1].y - t[i + 1] * dx)},${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

function render(data, c) {
  const max = Math.max(...data.map((d) => d.count));
  const step = niceStep(max);
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const x = (i) => PLOT.left + (i * (PLOT.right - PLOT.left)) / (data.length - 1);
  const y = (v) => PLOT.bottom - (v / yMax) * (PLOT.bottom - PLOT.top);
  const pts = data.map((d, i) => ({ x: x(i), y: y(d.count) }));
  const line = monotonePath(pts);
  const total = data.reduce((s, d) => s + d.count, 0);

  const grid = [];
  for (let v = 0; v <= yMax; v += step) {
    grid.push(`<line x1="${PLOT.left}" x2="${PLOT.right}" y1="${y(v)}" y2="${y(v)}" stroke="${c.grid}" stroke-width="1"${v ? ' stroke-dasharray="4 4"' : ""}/>`);
    grid.push(`<text x="${PLOT.left - 14}" y="${y(v) + 5}" text-anchor="end">${v}</text>`);
  }
  const xLabels = data.map((d, i) => `<text x="${x(i)}" y="${PLOT.bottom + 28}" text-anchor="middle">${Number(d.date.slice(8))}</text>`);
  const points = pts.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${c.point}"><title>${data[i].date}: ${data[i].count}</title></circle>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">Atividade nos últimos ${DAYS} dias</title>
<desc id="d">${total} contribuições de ${data[0].date} a ${data.at(-1).date}.</desc>
<defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${c.area}" stop-opacity="0.35"/><stop offset="1" stop-color="${c.area}" stop-opacity="0.02"/>
</linearGradient></defs>
<text x="${W / 2}" y="38" text-anchor="middle" font-family="${FONT}" font-size="24" font-weight="600" fill="${c.title}">Atividade nos últimos ${DAYS} dias</text>
<g font-family="${FONT}" font-size="15" fill="${c.text}">
${grid.join("\n")}
${xLabels.join("\n")}
<text x="${(PLOT.left + PLOT.right) / 2}" y="${H - 14}" text-anchor="middle" font-size="16">Dias</text>
<text transform="translate(22 ${(PLOT.top + PLOT.bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="16">Contribuições</text>
</g>
<path d="${line}L${PLOT.right},${PLOT.bottom}L${PLOT.left},${PLOT.bottom}Z" fill="url(#area)"/>
<path d="${line}" fill="none" stroke="${c.line}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
${points.join("\n")}
</svg>
`;
}

const data = await fetchCounts(lastDates());
await mkdir(OUT_DIR, { recursive: true });
for (const [name, colors] of Object.entries(THEMES))
  await writeFile(join(OUT_DIR, `activity-graph-${name}.svg`), render(data, colors));
console.log(`${USER}: ${data.reduce((s, d) => s + d.count, 0)} contribuições em ${DAYS} dias → ${OUT_DIR}`);
