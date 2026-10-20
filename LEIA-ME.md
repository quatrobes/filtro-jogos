# Filtro de Jogos

Site que lista os jogos do dia e filtra por odd de Over (ex.: Over 0.5 ≤ 1,05) e por histórico
(ex.: nenhum 0x0 nos últimos X jogos de cada time). Funciona com os planos **grátis** de duas APIs.

## De onde vêm os dados

| Dado | Fonte | Observação |
|---|---|---|
| Jogos do dia | API-Sports (API-Football) | Todos os jogos do mundo |
| Odds Over/Under | API-Sports | Grátis: ~30 jogos pela busca por data + até 25 jogo a jogo por execução |
| Histórico dos times | football-data.org | Grátis, imediato, só 13 competições (Brasileirão, Libertadores, top europeias, Champions) |
| Histórico dos times | Próprio sistema | A cada execução guarda os resultados do dia em `data/historico.json`. Cobre todas as ligas, mas leva algumas semanas para acumular X jogos por time |

Regras do plano grátis da API-Sports (descobertas em teste): 100 requisições/dia (zera às 21h de Brasília),
10 por minuto, só datas de hoje até +2 dias, no máximo 3 páginas por busca, sem consulta de temporada atual por liga.

## Chaves

- `chave.txt` → chave da API-Sports (painel em https://dashboard.api-football.com, menu My Access)
- `chave-football-data.txt` → token do football-data.org (veio por e-mail)

Os dois arquivos não vão para o GitHub (estão no `.gitignore`).

## Rodar no seu PC

```
node atualizar.js     (busca os dados — leva alguns minutos por causa dos limites por minuto)
node servidor.js      (depois abra http://localhost:8080)
```

Outros comandos:

- `node atualizar.js --so-resultados` → só guarda os resultados do dia no histórico próprio (gasta pouco)
- `node atualizar.js --listar-ligas` → gera `ligas-disponiveis.csv` com o id de todas as ligas
- `node demo.js` → gera dados inventados, só para ver a interface

## config.json

| Opção | O que faz |
|---|---|
| `ligas` | Suas ligas favoritas. Elas têm prioridade na busca de odds jogo a jogo |
| `somente_ligas_da_lista` | `true` = mostra só as ligas da lista; `false` = mostra o mundo todo |
| `dias_a_frente` | 0 = só hoje; 1 = hoje e amanhã (gasta mais requisições) |
| `max_consultas_odds_por_jogo` | Quantos jogos buscar odds um a um, além da busca por data |
| `requisicoes_reservadas` | Para de gastar quando sobrarem só essas requisições no dia |
| `jogos_no_historico` | Quantos jogos passados guardar por time (máximo do filtro "últimos X") |

## Colocar online de graça (GitHub Pages + GitHub Actions)

1. Crie uma conta em https://github.com e um repositório **público** novo (ex.: `filtro-jogos`).
2. Envie todos os arquivos desta pasta para o repositório (menos os dois arquivos de chave).
   Pelo site: "Add file" → "Upload files" e arraste os arquivos e as pastas `.github` e `data`.
3. **Settings → Secrets and variables → Actions → New repository secret**, crie dois:
   - `API_FOOTBALL_KEY` = chave da API-Sports
   - `FOOTBALL_DATA_KEY` = token do football-data.org
4. **Settings → Pages** → Source: "Deploy from a branch" → Branch `main`, pasta `/ (root)`.
5. Aba **Actions** → "Atualizar jogos" → **Run workflow** para a primeira atualização.

Depois disso ele atualiza sozinho às 08h e 14h (completo) e às 20h45 (só resultados), horário de Brasília.
O site fica em `https://SEU-USUARIO.github.io/filtro-jogos/`.

> Os dados ficam visíveis para quem tiver o link do site. As chaves ficam guardadas em segredo no GitHub.
