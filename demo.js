// Gera data/jogos.json com DADOS DE EXEMPLO (inventados), só para ver a interface funcionando.
// Uso: node demo.js   — depois rode "node atualizar.js" para voltar aos dados reais.
const fs = require("fs");
const path = require("path");

let semente = 7;
const rand = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
const escolher = (arr) => arr[Math.floor(rand() * arr.length)];

const ligas = [
  { id: 71, nome: "Serie A", pais: "Brazil", times: ["Flamengo", "Palmeiras", "Botafogo", "Fortaleza", "São Paulo", "Internacional", "Bahia", "Cruzeiro"] },
  { id: 39, nome: "Premier League", pais: "England", times: ["Arsenal", "Liverpool", "Chelsea", "Newcastle", "Brighton", "Aston Villa"] },
  { id: 78, nome: "Bundesliga", pais: "Germany", times: ["Bayern München", "Leverkusen", "Dortmund", "Leipzig", "Stuttgart", "Frankfurt"] },
  { id: 88, nome: "Eredivisie", pais: "Netherlands", times: ["Ajax", "PSV", "Feyenoord", "AZ Alkmaar", "Twente", "Utrecht"] },
  { id: 135, nome: "Serie A", pais: "Italy", times: ["Inter", "Napoli", "Juventus", "Atalanta", "Roma", "Lazio"] },
];

const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

function historico(nome, adversarios) {
  const h = [];
  for (let i = 1; i <= 10; i++) {
    const d = new Date(Date.now() - i * 7 * 86400000).toISOString().slice(0, 10);
    const zeroZero = rand() < 0.07;
    h.push({
      data: `${d}T16:00:00-03:00`,
      adversario: escolher(adversarios.filter((t) => t !== nome)),
      local: rand() < 0.5 ? "C" : "F",
      competicao: "Liga",
      gm: zeroZero ? 0 : Math.floor(rand() * 4),
      gs: zeroZero ? 0 : Math.floor(rand() * 3) + (rand() < 0.3 ? 0 : 1),
    });
  }
  return h;
}

const jogos = [];
let id = 1;
for (const liga of ligas) {
  const times = [...liga.times].sort(() => rand() - 0.5);
  for (let i = 0; i + 1 < times.length; i += 2) {
    const hora = String(12 + Math.floor(rand() * 10)).padStart(2, "0") + ":" + escolher(["00", "30", "45"]);
    const base = 1.02 + rand() * 0.07;
    const casas = ["Bet365", "Betano", "1xBet", "Pinnacle"].filter(() => rand() < 0.8);
    const odd = (extra) => casas.map((c) => ({ casa: c, odd: +(base + extra + (rand() - 0.5) * 0.02).toFixed(2) }));
    jogos.push({
      id: id++,
      data: `${hoje}T${hora}:00-03:00`,
      status: "NS",
      liga: { id: liga.id, nome: liga.nome, pais: liga.pais },
      casa: { id: id * 10, nome: times[i], historico: historico(times[i], liga.times) },
      fora: { id: id * 10 + 1, nome: times[i + 1], historico: historico(times[i + 1], liga.times) },
      odds: casas.length ? { "0.5": odd(0), "1.5": odd(0.22), "2.5": odd(0.75) } : {},
    });
  }
}
jogos.sort((a, b) => a.data.localeCompare(b.data));

fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "data", "jogos.json"), JSON.stringify({
  demo: true,
  gerado_em: new Date().toISOString(),
  fuso_horario: "America/Sao_Paulo",
  modo_historico: "liga",
  jogos_no_historico: 10,
  avisos: [],
  jogos,
}));
console.log(`${jogos.length} jogos de EXEMPLO gravados em data/jogos.json.`);
