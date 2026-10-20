// Monta data/jogos.json para o site, combinando duas fontes grátis:
//   - API-Sports (API-Football): jogos do dia e odds de Over/Under (busca por data, liberada no plano grátis)
//   - football-data.org: histórico dos times de 13 competições principais (Brasileirão, Libertadores, top europeias)
// Além disso, a cada execução os resultados dos jogos encerrados são guardados em data/historico.json,
// formando aos poucos um histórico próprio que cobre todas as ligas do mundo.
//
// Uso:
//   node atualizar.js                 -> atualiza jogos, odds e histórico
//   node atualizar.js --so-resultados -> só guarda os resultados do dia (1 a 2 requisições)
//   node atualizar.js --listar-ligas  -> gera ligas-disponiveis.csv com o id de todas as ligas
//
// Chaves: API_FOOTBALL_KEY (ou chave.txt) e FOOTBALL_DATA_KEY (ou chave-football-data.txt).

const fs = require("fs");
const path = require("path");

const RAIZ = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, "config.json"), "utf8"));
const TZ = config.fuso_horario;
const N = config.jogos_no_historico;
const ENCERRADO = new Set(["FT", "AET", "PEN"]);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function lerChave(variavel, arquivo) {
  if (process.env[variavel]) return process.env[variavel].trim();
  const arq = path.join(RAIZ, arquivo);
  return fs.existsSync(arq) ? fs.readFileSync(arq, "utf8").trim() : "";
}

// ---------- datas ----------
const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const diaLocal = (iso) => formatoDia.format(new Date(iso));
const diaDeslocado = (dias) => formatoDia.format(new Date(Date.now() + dias * 86400000));
const somarDias = (dia, n) => new Date(Date.parse(dia + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// ---------- API-Sports ----------
const AS = {
  url: process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io",
  chave: lerChave("API_FOOTBALL_KEY", "chave.txt"),
  pausa: Number(process.env.PAUSA_MS ?? 6500), // plano grátis: 10 requisições/minuto
  feitas: 0,
  restantes: null,
};

async function apiSports(endpoint, params) {
  if (AS.feitas > 0) await dormir(AS.pausa);
  const url = `${AS.url}/${endpoint}?${new URLSearchParams(params)}`;
  const resp = await fetch(url, { headers: { "x-apisports-key": AS.chave } });
  AS.feitas++;
  const restantes = resp.headers.get("x-ratelimit-requests-remaining");
  if (restantes !== null) AS.restantes = Number(restantes);
  if (!resp.ok) throw new Error(`API-Sports HTTP ${resp.status} em ${endpoint}`);
  const json = await resp.json();
  const erros = Object.values(json.errors ?? {});
  if (erros.length) throw new Error(`API-Sports recusou ${endpoint} ${JSON.stringify(params)}: ${erros.join(" | ")}`);
  console.log(`  [API-Sports ${AS.feitas}] ${endpoint} ${JSON.stringify(params)} -> ${json.results} resultado(s)`);
  return json;
}

// O plano grátis só libera até a página 3; as páginas já obtidas são mantidas.
async function apiSportsPaginado(endpoint, params, maxPaginas = 3) {
  const primeira = await apiSports(endpoint, params);
  const itens = [...primeira.response];
  const total = Math.min(primeira.paging?.total ?? 1, maxPaginas);
  for (let p = 2; p <= total; p++) {
    try {
      itens.push(...(await apiSports(endpoint, { ...params, page: p })).response);
    } catch (e) {
      console.warn("  AVISO:", e.message);
      break;
    }
  }
  return itens;
}

// ---------- football-data.org ----------
const FD = {
  url: "https://api.football-data.org/v4",
  chave: lerChave("FOOTBALL_DATA_KEY", "chave-football-data.txt"),
  disponiveis: null,
  reset: 60,
  feitas: 0,
};

// Respeita os cabeçalhos de limite do football-data.org (10 requisições/minuto no plano grátis).
async function footballData(caminho, tentativa = 1) {
  if (FD.disponiveis !== null && FD.disponiveis <= 0) {
    console.log(`  football-data: limite do minuto atingido, aguardando ${FD.reset + 1}s...`);
    await dormir((FD.reset + 1) * 1000);
  }
  const resp = await fetch(FD.url + caminho, { headers: { "X-Auth-Token": FD.chave } });
  FD.feitas++;
  FD.disponiveis = Number(resp.headers.get("x-requests-available-minute") ?? 1);
  FD.reset = Number(resp.headers.get("x-requestcounter-reset") ?? 60);
  if (resp.status === 429 && tentativa <= 3) {
    FD.disponiveis = 0;
    return footballData(caminho, tentativa + 1);
  }
  if (!resp.ok) throw new Error(`football-data HTTP ${resp.status} em ${caminho}: ${(await resp.text()).slice(0, 200)}`);
  console.log(`  [football-data ${FD.feitas}] ${caminho}`);
  return resp.json();
}

// ---------- cache em disco ----------
const PASTA_CACHE = path.join(RAIZ, "cache");

async function comCache(nome, horasValidade, buscar) {
  const arq = path.join(PASTA_CACHE, `${nome}.json`);
  if (fs.existsSync(arq)) {
    const salvo = JSON.parse(fs.readFileSync(arq, "utf8"));
    if (Date.now() - salvo.salvo_em < horasValidade * 3600000) return salvo.dados;
  }
  const dados = await buscar();
  fs.mkdirSync(PASTA_CACHE, { recursive: true });
  fs.writeFileSync(arq, JSON.stringify({ salvo_em: Date.now(), dados }));
  return dados;
}

function limparCacheAntigo() {
  if (!fs.existsSync(PASTA_CACHE)) return;
  // Usa a data gravada no arquivo: no GitHub Actions a data de modificação muda a cada checkout.
  for (const f of fs.readdirSync(PASTA_CACHE)) {
    const arq = path.join(PASTA_CACHE, f);
    let salvoEm = 0;
    try { salvoEm = JSON.parse(fs.readFileSync(arq, "utf8")).salvo_em ?? 0; } catch {}
    if (Date.now() - salvoEm > 3 * 86400000) fs.unlinkSync(arq);
  }
}

// ---------- histórico próprio (resultados guardados a cada execução) ----------
const ARQ_HISTORICO = path.join(RAIZ, "data", "historico.json");

// Jogos que a API não encerrou muito depois do horário (sem cobertura): não são consultados de novo.
let semResultado = new Set();

function carregarHistorico() {
  if (!fs.existsSync(ARQ_HISTORICO)) return {};
  const salvo = JSON.parse(fs.readFileSync(ARQ_HISTORICO, "utf8"));
  semResultado = new Set(salvo.sem_resultado ?? []);
  return salvo.jogos ?? {};
}

function salvarHistorico(base) {
  const limite = Date.now() - config.dias_guardados_no_historico * 86400000;
  for (const [id, j] of Object.entries(base)) if (Date.parse(j.d) < limite) delete base[id];
  fs.mkdirSync(path.dirname(ARQ_HISTORICO), { recursive: true });
  fs.writeFileSync(ARQ_HISTORICO, JSON.stringify({
    atualizado_em: new Date().toISOString(),
    sem_resultado: [...semResultado].slice(-2000),
    jogos: base,
  }));
  return Object.keys(base).length;
}

function registrarResultados(base, fixtures) {
  let novos = 0;
  for (const fx of fixtures) {
    if (!ENCERRADO.has(fx.fixture.status.short)) continue;
    const gh = fx.score?.fulltime?.home ?? fx.goals.home;
    const ga = fx.score?.fulltime?.away ?? fx.goals.away;
    if (gh === null || ga === null) continue;
    if (!base[fx.fixture.id]) novos++;
    base[fx.fixture.id] = {
      d: fx.fixture.date, lg: fx.league.name,
      h: fx.teams.home.id, hn: fx.teams.home.name,
      a: fx.teams.away.id, an: fx.teams.away.name,
      gh, ga,
    };
  }
  return novos;
}

// Índice: id do time (API-Sports) -> linhas de histórico do ponto de vista do time.
function indexarHistorico(base) {
  const porTime = new Map();
  const add = (time, linha) => {
    if (!porTime.has(time)) porTime.set(time, []);
    porTime.get(time).push(linha);
  };
  for (const j of Object.values(base)) {
    add(j.h, { data: j.d, adversario: j.an, local: "C", competicao: j.lg, gm: j.gh, gs: j.ga });
    add(j.a, { data: j.d, adversario: j.hn, local: "F", competicao: j.lg, gm: j.ga, gs: j.gh });
  }
  return porTime;
}

// Busca os jogos de um dia; também guarda os resultados dos encerrados.
// Dias fora da janela do plano grátis são ignorados sem erro.
async function jogosDoDia(base, dia, opcional) {
  try {
    const fixtures = (await apiSports("fixtures", { date: dia, timezone: TZ })).response;
    const novos = registrarResultados(base, fixtures);
    console.log(`  ${dia}: ${fixtures.length} jogos, ${novos} resultado(s) novo(s) guardado(s).`);
    return fixtures;
  } catch (e) {
    if (opcional) return [];
    throw e;
  }
}

// O plano grátis não consulta datas passadas. Para não perder resultados de jogos que terminaram
// depois da última execução, busca pelo id (1 jogo por requisição) os jogos da última lista gravada,
// começando pelos que têm odds (os mais relevantes para o filtro).
async function completarResultados(base) {
  const arq = path.join(RAIZ, "data", "jogos.json");
  if (!fs.existsSync(arq)) return;
  const limite = Date.now() - 2.5 * 3600000; // começou há mais de 2h30 = provavelmente encerrado
  const pendentes = JSON.parse(fs.readFileSync(arq, "utf8")).jogos
    .filter((j) => !base[j.id] && !semResultado.has(j.id) && Date.parse(j.data) < limite && !["PST", "CANC", "ABD", "AWD", "WO"].includes(j.status))
    .sort((a, b) => Object.keys(b.odds).length - Object.keys(a.odds).length)
    .slice(0, config.max_resultados_por_id ?? 15);
  let recuperados = 0;
  for (const j of pendentes) {
    if (AS.restantes !== null && AS.restantes <= (config.requisicoes_reservadas ?? 10)) break;
    try {
      const novos = registrarResultados(base, (await apiSports("fixtures", { id: j.id, timezone: TZ })).response);
      recuperados += novos;
      if (!novos && Date.now() - Date.parse(j.data) > 6 * 3600000) semResultado.add(j.id);
    } catch (e) {
      console.warn("  AVISO:", e.message);
      break;
    }
  }
  if (pendentes.length) console.log(`  ${recuperados} resultado(s) recuperado(s) pelo id.`);
}

// ---------- odds ----------
// Converte a resposta de /odds em { fixtureId: { "0.5": [{casa, odd}], "1.5": [...] } } (mercado Goals Over/Under, bet 5).
function extrairOdds(itens, destino) {
  for (const item of itens) {
    const linhas = {};
    for (const casa of item.bookmakers ?? []) {
      for (const aposta of casa.bets ?? []) {
        if (aposta.id !== 5) continue;
        for (const v of aposta.values ?? []) {
          const m = /^Over (\d+(?:\.\d+)?)$/.exec(v.value);
          if (m) (linhas[m[1]] ??= []).push({ casa: casa.name, odd: Number(v.odd) });
        }
      }
    }
    if (Object.keys(linhas).length) destino[item.fixture.id] = linhas;
  }
}

// A busca por data traz no máximo ~30 jogos (3 páginas). Os demais são buscados jogo a jogo,
// por ordem de prioridade, até o limite de requisições configurado.
async function buscarOdds(jogos, dias, prioridade, avisos) {
  const odds = {};
  for (const dia of dias) {
    try {
      extrairOdds(await apiSportsPaginado("odds", { date: dia, bet: 5, timezone: TZ }), odds);
    } catch (e) {
      avisos.push(`Odds de ${dia}: ${e.message}`);
      console.warn("  AVISO:", e.message);
    }
  }
  console.log(`  ${Object.keys(odds).length} jogos com odds pela busca por data.`);

  const reserva = config.requisicoes_reservadas ?? 15;
  let orcamento = config.max_consultas_odds_por_jogo ?? 40;
  const pendentes = jogos
    .filter((fx) => !odds[fx.fixture.id] && ["NS", "TBD"].includes(fx.fixture.status.short))
    .sort((a, b) => prioridade(b) - prioridade(a) || a.fixture.date.localeCompare(b.fixture.date));
  for (const fx of pendentes) {
    if (orcamento-- <= 0 || (AS.restantes !== null && AS.restantes <= reserva)) break;
    try {
      extrairOdds((await apiSports("odds", { fixture: fx.fixture.id, bet: 5 })).response, odds);
    } catch (e) {
      avisos.push(`Odds de ${fx.teams.home.name} x ${fx.teams.away.name}: ${e.message}`);
      console.warn("  AVISO:", e.message);
      break;
    }
  }
  return odds;
}

// ---------- histórico do football-data.org ----------
const normalizar = (s) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((t) => t.length >= 3 && !["club", "clube", "futebol", "football", "calcio", "esporte", "sport", "regatas"].includes(t));

function semelhanca(nomeAS, timeFD) {
  const a = new Set(normalizar(nomeAS));
  const b = new Set(normalizar(`${timeFD.name} ${timeFD.shortName} ${timeFD.tla}`));
  let comum = 0;
  for (const t of a) if (b.has(t) || [...b].some((x) => x.startsWith(t) || t.startsWith(x))) comum++;
  return comum;
}

// Liga cada jogo da API-Sports ao mesmo jogo no football-data (mesma competição e horário),
// e baixa o histórico dos times encontrados. Retorna Map(id do time API-Sports -> linhas).
async function historicoFootballData(jogos, dias) {
  const resultado = new Map();
  const mapa = config.football_data_competicoes ?? {};
  const candidatos = jogos.filter((fx) => mapa[fx.league.id]);
  if (!FD.chave || !candidatos.length) return resultado;

  const partidasFD = [];
  for (const dia of dias) {
    const r = await footballData(`/matches?dateFrom=${dia}&dateTo=${somarDias(dia, 1)}`);
    partidasFD.push(...r.matches);
  }

  const timesFD = new Map(); // id API-Sports -> id football-data
  for (const fx of candidatos) {
    const t = Date.parse(fx.fixture.date);
    const opcoes = partidasFD.filter((m) => m.competition.code === mapa[fx.league.id] && Math.abs(Date.parse(m.utcDate) - t) <= 20 * 60000);
    let melhor = null, nota = -1;
    for (const m of opcoes) {
      const s = semelhanca(fx.teams.home.name, m.homeTeam) + semelhanca(fx.teams.away.name, m.awayTeam);
      if (s > nota) [melhor, nota] = [m, s];
    }
    if (!melhor || (opcoes.length > 1 && nota === 0)) continue;
    timesFD.set(fx.teams.home.id, melhor.homeTeam.id);
    timesFD.set(fx.teams.away.id, melhor.awayTeam.id);
  }
  console.log(`  ${timesFD.size} times encontrados no football-data.org.`);

  const hoje = diaDeslocado(0);
  for (const [idAS, idFD] of timesFD) {
    try {
      const partidas = await comCache(`fd-time-${idFD}-${hoje}`, config.horas_cache_historico, async () => {
        const r = await footballData(`/teams/${idFD}/matches?status=FINISHED&dateFrom=${somarDias(hoje, -120)}&dateTo=${hoje}`);
        return r.matches.map((m) => ({
          data: m.utcDate, competicao: m.competition.name,
          casaId: m.homeTeam.id, casa: m.homeTeam.shortName ?? m.homeTeam.name, fora: m.awayTeam.shortName ?? m.awayTeam.name,
          gh: (m.score.regularTime ?? m.score.fullTime).home, ga: (m.score.regularTime ?? m.score.fullTime).away,
        }));
      });
      resultado.set(idAS, partidas.filter((p) => p.gh !== null).map((p) => {
        const emCasa = p.casaId === idFD;
        return { data: p.data, adversario: emCasa ? p.fora : p.casa, local: emCasa ? "C" : "F", competicao: p.competicao, gm: emCasa ? p.gh : p.ga, gs: emCasa ? p.ga : p.gh };
      }));
    } catch (e) {
      console.warn("  AVISO:", e.message);
    }
  }
  return resultado;
}

// Junta as duas fontes (football-data tem prioridade), sem repetir jogos do mesmo dia.
function ultimosJogos(timeId, antesDe, linhasFD, indice) {
  const vistos = new Set();
  return [...(linhasFD.get(timeId) ?? []), ...(indice.get(timeId) ?? [])]
    .filter((l) => Date.parse(l.data) < Date.parse(antesDe))
    .filter((l) => {
      const dia = diaLocal(l.data);
      if (vistos.has(dia)) return false;
      vistos.add(dia);
      return true;
    })
    .sort((a, b) => Date.parse(b.data) - Date.parse(a.data))
    .slice(0, N);
}

// ---------- principal ----------
async function listarLigas() {
  const r = await apiSports("leagues", { current: "true" });
  const linhas = ["id;pais;liga;tipo;temporada"];
  for (const l of r.response) {
    const temp = l.seasons?.find((s) => s.current)?.year ?? "";
    linhas.push([l.league.id, l.country.name, l.league.name, l.league.type, temp].join(";"));
  }
  fs.writeFileSync(path.join(RAIZ, "ligas-disponiveis.csv"), "﻿" + linhas.join("\n"), "utf8");
  console.log(`\n${r.response.length} ligas gravadas em ligas-disponiveis.csv (abra no Excel).`);
}

async function soResultados() {
  const base = carregarHistorico();
  await completarResultados(base);
  await jogosDoDia(base, diaDeslocado(0), true);
  console.log(`\nHistórico próprio: ${salvarHistorico(base)} jogos guardados. Requisições API-Sports: ${AS.feitas}.`);
}

async function atualizar() {
  limparCacheAntigo();
  const base = carregarHistorico();
  const avisos = [];
  const dias = [];
  for (let d = 0; d <= (config.dias_a_frente ?? 0); d++) dias.push(diaDeslocado(d));

  console.log("\nJogos e resultados:");
  await completarResultados(base);
  let jogos = [];
  for (const dia of dias) jogos.push(...(await jogosDoDia(base, dia, false)));
  salvarHistorico(base);

  if (config.somente_ligas_da_lista) {
    const ids = new Set(config.ligas.map((l) => l.id));
    jogos = jogos.filter((fx) => ids.has(fx.league.id));
  }

  console.log("\nHistórico (football-data.org):");
  let linhasFD = new Map();
  if (!FD.chave) {
    avisos.push("Sem chave do football-data.org: histórico só com os resultados guardados pelo próprio sistema.");
  } else {
    try {
      linhasFD = await historicoFootballData(jogos, dias);
    } catch (e) {
      avisos.push(`football-data.org: ${e.message}`);
      console.warn("  AVISO:", e.message);
    }
  }

  const indice = indexarHistorico(base);
  const temHistorico = (t, antesDe) => ultimosJogos(t.id, antesDe, linhasFD, indice).length >= Math.min(N, 3);

  // Prioridade das consultas de odds jogo a jogo: ligas da lista, depois jogos com histórico.
  console.log("\nOdds:");
  const favoritas = new Set(config.ligas.map((l) => l.id));
  const prioridade = (fx) =>
    (favoritas.has(fx.league.id) ? 4 : 0) +
    (temHistorico(fx.teams.home, fx.fixture.date) && temHistorico(fx.teams.away, fx.fixture.date) ? 2 : 0) +
    (config.football_data_competicoes?.[fx.league.id] ? 1 : 0);
  const odds = await buscarOdds(jogos, dias, prioridade, avisos);

  const lado = (t, antesDe) => ({ id: t.id, nome: t.name, logo: t.logo, historico: ultimosJogos(t.id, antesDe, linhasFD, indice) });
  const saida = jogos
    .map((fx) => ({
      id: fx.fixture.id,
      data: fx.fixture.date,
      status: fx.fixture.status.short,
      liga: { id: fx.league.id, nome: fx.league.name, pais: fx.league.country, bandeira: fx.league.flag, logo: fx.league.logo },
      casa: lado(fx.teams.home, fx.fixture.date),
      fora: lado(fx.teams.away, fx.fixture.date),
      odds: odds[fx.fixture.id] ?? {},
    }))
    .sort((a, b) => a.data.localeCompare(b.data));

  fs.writeFileSync(path.join(RAIZ, "data", "jogos.json"), JSON.stringify({
    gerado_em: new Date().toISOString(),
    fuso_horario: TZ,
    jogos_no_historico: N,
    historico_proprio_jogos: Object.keys(base).length,
    requisicoes_api_sports: AS.feitas,
    requisicoes_restantes_hoje: AS.restantes,
    avisos,
    jogos: saida,
  }));

  const comOdd = saida.filter((j) => Object.keys(j.odds).length).length;
  const comHist = saida.filter((j) => j.casa.historico.length && j.fora.historico.length).length;
  console.log(`\nPronto: ${saida.length} jogos (${comOdd} com odds, ${comHist} com histórico) gravados em data/jogos.json.`);
  console.log(`Requisições API-Sports agora: ${AS.feitas} (restantes hoje: ${AS.restantes ?? "?"}). football-data: ${FD.feitas}.`);
  if (avisos.length) console.log(`${avisos.length} aviso(s):\n - ${avisos.join("\n - ")}`);
}

if (!AS.chave) {
  console.error("Chave da API-Sports não encontrada. Cole a sua chave no arquivo chave.txt.");
  process.exit(1);
}
const tarefa = process.argv.includes("--listar-ligas") ? listarLigas : process.argv.includes("--so-resultados") ? soResultados : atualizar;
tarefa().catch((e) => {
  console.error("\nERRO:", e.message);
  process.exit(1);
});
