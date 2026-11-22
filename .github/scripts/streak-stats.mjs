// Gera o card de sequência de contribuições (versões clara e escura) a partir do calendário de
// contribuições da API GraphQL do GitHub, no lugar do streak-stats.vercel.app público (que saiu do ar).
// Uso: node streak-stats.mjs <pasta-de-saida>
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const USER = process.env.GH_USER || "viniventur";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = process.argv[2] || "dist";

const THEMES = {
  dark: { stroke: "#30363D", ring: "#58A6FF", fire: "#58A6FF", currLabel: "#58A6FF", sideLabel: "#C9D1D9", num: "#C9D1D9", dates: "#8B949E" },
  light: { stroke: "#D0D7DE", ring: "#0969DA", fire: "#0969DA", currLabel: "#0969DA", sideLabel: "#1F2328", num: "#1F2328", dates: "#656D76" },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const num = new Intl.NumberFormat("pt-BR");

if (!TOKEN) throw new Error("Defina GITHUB_TOKEN.");

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}

// Todos os dias (AAAA-MM-DD, em UTC, como no calendário do GitHub) do primeiro ano com contribuições até hoje.
// A API limita cada contributionsCollection a 1 ano, então pede um alias por ano numa única consulta.
async function fetchDays(now) {
  const { user } = await graphql(
    `query($login: String!) { user(login: $login) { contributionsCollection { contributionYears } } }`,
    { login: USER },
  );
  const lastYear = now.getUTCFullYear();
  const firstYear = Math.min(lastYear, ...user.contributionsCollection.contributionYears);
  const parts = [];
  for (let y = firstYear; y <= lastYear; y++) {
    const to = y === lastYear ? now.toISOString() : `${y}-12-31T23:59:59Z`;
    parts.push(`y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${to}") {
      contributionCalendar { weeks { contributionDays { date contributionCount } } } }`);
  }
  const data = await graphql(`query($login: String!) { user(login: $login) { ${parts.join("\n")} } }`, { login: USER });

  const today = now.toISOString().slice(0, 10);
  const byDate = new Map();
  for (const year of Object.values(data.user))
    for (const week of year.contributionCalendar.weeks)
      for (const day of week.contributionDays) if (day.date <= today) byDate.set(day.date, day.contributionCount);

  // Percorre data a data para não depender de o calendário vir sem buracos.
  const days = [];
  for (let d = new Date(`${firstYear}-01-01T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    days.push({ date, count: byDate.get(date) ?? 0 });
    if (date >= today) break;
  }
  return days;
}

function computeStats(days) {
  const today = days.at(-1).date;
  const total = days.reduce((s, d) => s + d.count, 0);
  const first = days.find((d) => d.count > 0)?.date ?? today;

  let longest = { len: 0, start: today, end: today };
  let run = 0, runStart;
  for (const d of days) {
    if (d.count > 0) {
      if (!run) runStart = d.date;
      run++;
      if (run > longest.len) longest = { len: run, start: runStart, end: d.date };
    } else run = 0;
  }

  // A sequência atual não quebra só porque hoje ainda não tem contribuição: o dia não acabou.
  let i = days.length - 1;
  if (days[i].count === 0) i--;
  const end = i;
  while (i >= 0 && days[i].count > 0) i--;
  const current = end > i ? { len: end - i, start: days[i + 1].date, end: days[end].date } : { len: 0, start: today, end: today };

  return { today, total, first, current, longest };
}

function fmtDate(iso, currentYear) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${y !== currentYear ? ` ${y}` : ""}`;
}

function fmtRange(start, end, currentYear) {
  return start === end ? fmtDate(start, currentYear) : `${fmtDate(start, currentYear)} – ${fmtDate(end, currentYear)}`;
}

function render(s, c) {
  const year = Number(s.today.slice(0, 4));
  const totalDates = `${fmtDate(s.first, year)} – Presente`;
  const currentDates = fmtRange(s.current.start, s.current.end, year);
  const longestDates = s.longest.len ? fmtRange(s.longest.start, s.longest.end, year) : fmtDate(s.today, year);

  // Colunas centradas em 82,5 / 247,5 / 412,5 num card de 495×195.
  const side = (x, value, label, dates) => `<text x="${x}" y="80" font-size="28" font-weight="700" fill="${c.num}">${value}</text>
<text x="${x}" y="116" font-size="14" fill="${c.sideLabel}">${label}</text>
<text x="${x}" y="146" font-size="12" fill="${c.dates}">${dates}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-labelledby="t d">
<title id="t">Sequência de contribuições</title>
<desc id="d">${num.format(s.total)} contribuições desde ${s.first}; sequência atual de ${s.current.len} dias; maior sequência de ${s.longest.len} dias.</desc>
<defs><mask id="gap"><rect width="495" height="195" fill="#fff"/><circle cx="247.5" cy="31" r="14" fill="#000"/></mask></defs>
<g stroke="${c.stroke}" stroke-width="1"><line x1="165" y1="28" x2="165" y2="170"/><line x1="330" y1="28" x2="330" y2="170"/></g>
<circle cx="247.5" cy="71" r="40" fill="none" stroke="${c.ring}" stroke-width="5" mask="url(#gap)"/>
<path transform="translate(247.5 31)" fill="${c.fire}" d="M0,-12C4,-7 9,-2 9,4C9,9 5,12 0,12C-5,12 -9,9 -9,4C-9,0 -6.5,-2.5 -5,-6.5C-4,-3 -2.5,-1 -0.5,0C-1,-4 -1.5,-8 0,-12Z"/>
<g font-family="${FONT}" text-anchor="middle">
${side(82.5, num.format(s.total), "Total de contribuições", totalDates)}
<text x="247.5" y="81" font-size="28" font-weight="700" fill="${c.num}">${num.format(s.current.len)}</text>
<text x="247.5" y="140" font-size="14" font-weight="700" fill="${c.currLabel}">Sequência atual</text>
<text x="247.5" y="166" font-size="12" fill="${c.dates}">${currentDates}</text>
${side(412.5, num.format(s.longest.len), "Maior sequência", longestDates)}
</g>
</svg>
`;
}

const stats = computeStats(await fetchDays(new Date()));
await mkdir(OUT_DIR, { recursive: true });
for (const [name, colors] of Object.entries(THEMES))
  await writeFile(join(OUT_DIR, `streak-stats-${name}.svg`), render(stats, colors));
console.log(`${USER}: ${stats.total} contribuições, sequência atual ${stats.current.len}, maior ${stats.longest.len} → ${OUT_DIR}`);
