# Matriz da demo — fluxo × app × estado (T-0028)

Pedido do Alexandre: R-20261101-020623, item 1. Orienta a T-0029 (fatia do pedido).
**Atualizada na onda 3 da T-0029 (2026-11-01):** o pedido funciona no Campo, no Gestão e no BKO (linhas 12 a 20); ponta a
ponta em `tests/integracao/demo/pedido-fatia.test.ts` e no navegador em `tests/e2e/bko/pedidos-bko.spec.ts`.
Rodada de 2026-11-01, agente `testes`. Demo local `subir-demo.ps1 -SemTunel` (API 8100, base `demo` recriada,
"hoje" = 2026-11-01 em America/Manaus) + BKO `pnpm --filter web dev` (porta 3000), e a mesma base num Postgres efêmero
para a suíte automatizada.

**Legenda:** ✅ funciona · ❌ quebrado (existe, mas falha com a API real) · ⛔ não existe (sem tela ou sem rota) ·
🚧 "em construção" (página provisória que explica e aponta a alternativa, sem travar) · ➖ não se aplica ao app. Os IDs (D-Cnn Campo, D-Gnn Gestão, D-Bnn BKO) são os nomes dos casos automatizados.

## Resumo
- **Campo:** login, rota do dia, carteira/Cliente 360 offline, check-in/checkout online e offline, metas,
  notificações, o bloqueio do promotor e, desde a T-0029, **Pedidos** (lista, detalhe, novo pedido com o preço da tabela
  do cliente, envio online e offline, PDF) **funcionam**. As telas do Vendedor leem o pull; as rotas REST da Fase M só
  rodam no modo demonstração (mock-api).
- **Gestão:** login, sincronização da equipe e a aba **Pedidos** (T-0029: "Para aprovar", detalhe, aprovar e rejeitar
  com motivo, PDF) funcionam. **Não existem** ainda: Equipe e Aprovações do módulo Gestor (não licenciado na demo).
- **BKO:** login, Visitas, Indicadores, Recados, Carteira → Cliente 360, Motivos, Coordenadas, Aparelhos, Usuários e
  módulos, **Rotas** (T-0030), **Pedidos** e **Alçadas** (T-0029, API nova) **funcionam**. Clientes (farol), Metas e RV
  e Plano de RV mostram **"em construção"** (T-0030; telas reais na Sprint 2).
- **Defeito achado e corrigido na onda 3:** o app não puxava `produto` (o Novo pedido ficaria sem produtos no APK);
  R-20261101-080519-testes → corrigido pelo modulo-core (R-20261101-081147), D-C10 verde.
- **Pendência registrada (não bloqueia a demo):** S0-014 — o Vendedor lê `plataforma.tenant` (fuso, `api/pedidos.ts`) e
  `core.*` no teste de banco; exceções temporárias nomeadas no teste, R-20261101-080407-testes ao modulo-vendedor.

## Matriz

| # | Fluxo | Campo | Gestão | BKO | Causa do quebrado / observação | Dono |
|---|---|---|---|---|---|---|
| 1 | Login (código `demo` + senha) dos 7 perfis, cada um no app certo | ✅ vendedor, vendedor2, promotor (D-C01) | ✅ supervisor e gerente (D-G01 login) | ✅ analista, admin, supervisor, gerente; vendedor e promotor recusados com aviso (D-B01) | — | — |
| 2 | Módulos efetivos (`/v1/me/modulos`) | ✅ vendedor sem Promotor, promotor sem Vendedor | ✅ 4 módulos | ✅ menu só com Core + Vendedor (D-B00) | — | — |
| 3 | Rota do dia (6 / 4 / 4 paradas, com coordenadas) | ✅ D-C02 | ➖ (sem aba Rota na variante) | ✅ Rotas (D-B10, T-0030) | T-0030: `useMe()` de `modules/core/web/lib/queries.ts` lê o fuso da sessão do login (sem `GET /v1/me`); a página chama só `/v1/core/rotas`, `/v1/core/equipe/hierarquia` e `/v1/core/usuarios/:id/clientes` | — |
| 4 | Carteira / lista de clientes | ✅ 18/12/7 offline (D-C03) | ✅ 30 clientes da equipe (D-G02) | ✅ Carteira por usuário (D-B05) | — | — |
| 5 | Cliente 360 (contato, ligar/WhatsApp, títulos, histórico) | ✅ offline (D-C03) | ✅ mesma ficha (página `cliente` em `apps: ['campo','gestao']`) | ✅ `/cliente?id=` pela Carteira (D-B12) | Ligar/WhatsApp no aparelho: M-D05 | — |
| 6 | Farol de clientes | ➖ | ➖ | 🚧 Clientes "em construção" (D-B21, T-0030) | sem rota v1 equivalente: a página mostra `EmBrevePage` ("Esta tela está em construção…", aponta Carteira e Cliente 360), sem travar e sem chamar rota da Fase M. A tela real fica para a Sprint 2 (decisão do gerente) | modulo-core (Sprint 2) |
| 7 | Check-in / checkout **online** | ✅ D-C04 (UUID do aparelho, dentro do raio, sem pedido com motivo) | ➖ | ✅ aparece em Visitas (D-B02) | GPS real e foto da fachada: M-D03 | — |
| 8 | Check-in / checkout **offline** → reconexão | ✅ D-C05 (fila com 2 itens, uma visita no banco, reenvio idempotente) | ➖ | ✅ | modo avião real: M-D04 | — |
| 9 | Metas do mês | ✅ painel offline com as 4 metas (D-C06) | ➖ (sem aba Metas na variante) | ✅ Indicadores (D-B03) · 🚧 Metas e RV "em construção" (D-B23, T-0030) | Metas e RV: `EmBrevePage` (aponta Indicadores), sem rota da Fase M; tela real na Sprint 2. **O-2:** no dia 1º do mês o realizado é 0 para todos (os pedidos da base são dos dias úteis anteriores; documentado pelo banco-dados em `docs/banco/README.md`) | modulo-core (Sprint 2) · banco-dados (O-2) |
| 10 | Plano de RV | ➖ | ➖ | 🚧 "em construção" (D-B25, T-0030) | `EmBrevePage` ("os parâmetros em vigor seguem valendo"), sem rota da Fase M; tela real na Sprint 2 | modulo-core (Sprint 2) |
| 11 | Notificações (caixa, não lida, marcar lida) | ✅ D-C07 (recado do supervisor; leitura sobe pela fila) | ✅ chega ao supervisor (D-G02) | ✅ Recados: enviar e ver enviados (D-B04, D-B13) | push real (FCM) e toque na notificação: M-D07 | — |
| 12 | Pedidos — dados no aparelho (pull) | ✅ 7 pedidos + itens chegam (D-C08a); condições, tabela do cliente e `produto` também | ✅ todos os pedidos da equipe, os 3 pendentes da base inclusive (D-G02) | ➖ | T-0029: o app registra `pedido`, `pedido_item`, `pedido_evento`, `condicao_pagamento`, `cliente_condicao`, o preço do Catálogo e (onda 3) o `produto` do Core | — |
| 13 | Pedidos — **lista** | ✅ D-C08 (pull, offline) | ✅ aba Pedidos com "Para aprovar" (D-G01, D-G02) | ✅ D-B26 (API e navegador: lista, filtros na URL, busca, painel "Aguardando aprovação") | T-0029: telas sobre o pull (`modules/vendedor/app/lib/pull.ts`); BKO só em `/v1/vendedor/pedidos` | — |
| 14 | Pedidos — **detalhe** com itens e total | ✅ D-C09 (aparelho e API) | ✅ mesmo detalhe (D-G03) | ✅ D-B27 (gaveta com itens e PDF) | — | — |
| 15 | Pedidos — **novo** | ✅ D-C10 (carteira 18, 24 produtos, preço da tabela do cliente offline; Atacado sem açaí/suco/creme dental = "Sem preço", RN-CAT-06) | ➖ (pedido em nome fora da fatia) | ➖ | **Defeito da onda 3, corrigido:** o app não puxava `produto` (R-20261101-080519-testes → modulo-core) | — |
| 16 | Pedidos — **envio** (push) | ✅ D-C11 (aceito; dentro da alçada já aprovado, P-1) · ✅ D-C11a (offline → reconexão: sobe uma vez; reenvio não duplica) | ➖ | ➖ | ponta a ponta: `pedido-fatia.test.ts` casos 1, 7 e 10 | — |
| 17 | Pedidos — **aprovação / rejeição** | ➖ | ✅ D-G03 (aprovar, 1 toque), D-G04 (rejeitar exige motivo, RN-GES-08) | ✅ aprovar pelo painel no navegador (supervisora; o analista só decide o nível analista, P-3) | alçada por nível (RN-VEN-10), P-3 (gerente decide supervisor com `acima_do_nivel`), RN-VEN-30: `pedido-fatia.test.ts` casos 8 e 9 | — |
| 18 | Pedidos — **PDF** | ✅ D-C12 (versão do cliente sem `%`; interna com desconto) · ✅ D-C12a | ✅ mesmo gerador (`pdfDoPedido`) | ✅ botões PDF do cliente e interno na gaveta (diálogo de impressão do navegador, P-5) | compartilhar pelo aparelho e salvar no navegador: M-D08 e M-D12 (manual) | — |
| 19 | Promotor não faz pedido (RN-PRO-01) | ✅ D-C13 (push `MODULO_INATIVO`, `GET /v1/vendedor/pedidos` 403; sem aba Pedidos: D-C00); com o Vendedor licenciado ao promotor: push `RN-PRO-01`, aprovar 403 (`pedido-fatia` 11b) | ➖ | ➖ | — | — |
| 20 | Alçadas de desconto | ➖ | ➖ | ✅ D-B28 (leitura: `/v1/vendedor/alcadas`, 5/10/15%, acima do gerente = analista; edição fora da fatia) | — | — |
| 21 | Licenças (Usuários e módulos) | ➖ | ➖ | ✅ admin (D-B09); analista não vê (correto) | — | — |
| 22 | Aparelhos (bloqueio) | ➖ | ➖ | ✅ D-B08 (lista vazia até um aparelho entrar) | bloquear e ver o app apagar os dados: M-D11 | — |
| 23 | Visitas da equipe | ➖ | ➖ | ✅ D-B02 | — | — |
| 24 | Motivos / Coordenadas sugeridas | ➖ | ➖ | ✅ D-B06, D-B07 | — | — |
| 25 | Auditoria | ➖ | ➖ | ✅ D-B29 (T-0030) | a página usa `GET /v1/auditoria` (rota nova de plataforma, `apps/api/src/auditoria.ts`); 200 para analista e admin; nenhuma chamada a `/v1/audit-log` | — |
| 26 | Abrir página do Vendedor pela URL (F5, link) | ➖ | ➖ | ✅ D-B30 (T-0030, com a rede lenta) | o shell só monta a página de módulo depois de `/v1/me/modulos` (`apps/web/lib/estado-shell.ts`, `shell-carregando-modulos`) | — |
| 27 | Abas da variante | ✅ Campo do vendedor com Rota, Clientes, Metas e Pedidos (D-C00) · ⛔ Loja do promotor (D-C00b) · ✅ Catálogo (D-C00c, T-0052) | ✅ Início + Clientes + Catálogo + Pedidos (D-G00, D-G01) · ⛔ Equipe/Aprovações/Alertas na demo (D-G05: telas do Gestor no main desde a T-0055 — D-G05a e `gestor-e2e.test.ts` verdes com o módulo ligado —, mas o Gestor não está licenciado na base demo) | — | `modules/promotor/app` exporta `{}`; Gestor fora de `MODULOS_DEMO` e com a projeção em memória (API e worker separados = abas vazias na demo; R-20261102-173043-testes) | banco-dados + modulo-gestor |

### Observações (não bloqueiam a demo)
- **O-1 (resolvida na T-0029, §7):** o admin vê os pedidos do tenant (lista 200, como o pull) e não decide (aprovar 403
  `PERFIL_SEM_ACESSO`) — D-B14.
- **O-2:** com o "hoje" no dia 1º do mês, Metas e Indicadores mostram 0% para todos (realizado 0, positivação nula). A
  demo fica com cara de vazia. Sugestão ao banco-dados: na base de demo, faturar no mês corrente uma parte dos pedidos
  (ou carregar com `--hoje` num dia útil do meio do mês).
- **O-3:** as cargas Fase M do Core (`etapasCore`: `GET /goals/me` e `GET /orders` em `modules/core/app/lib/cargas.ts`) dão 404
  na API real. São toleradas (viram vazio) e não derrubam o Sincronizar, mas a "ligação do pedido com a visita" no app fica
  vazia até a T-0029.
- **O-4:** o `next dev` reescreve `apps/web/next-env.d.ts` (`./.next/types` → `./.next/dev/types`). Aconteceu nesta rodada,
  ao subir o BKO para o Playwright. Fica como aviso ao engenheiro: não restaurei o arquivo.

## Automação
| Onde | O que | Estado |
|---|---|---|
| `tests/integracao/demo/pedido-fatia.test.ts` | **T-0029, ponta a ponta do pedido** (desenho §12, casos 1 a 12): Campo pelo motor de sync real e as funções da tela de novo pedido (preço pela consulta `catalogo.precos_cliente@1` no aparelho) → push → Gestão (pull da equipe, "Para aprovar") → aprovar → BKO (`GET pedidos/:id` com o histórico) → PDF (`pdfDoPedido` + `buildOrderPdfHtml`: cliente sem `%`, interno com desconto e aprovador) → outbox (criado, status_alterado ×3, aprovacao_solicitada, aprovado, vocabulário RN-VEN-30, sem dado pessoal); idempotência e conflito; alçada 3% / 7% / 12% / 20% e `acima_gerente = bloquear`; RN-GES-08, RN-VEN-30, RN-VEN-02 (total adulterado), RN-CAT-06, FORA_DA_CARTEIRA, RN-VEN-14; promotor (sem e com o Vendedor), vendedor, vendedora 2, admin; licença desligada para o supervisor; **isolamento** com a base demo e os tenants A e B no mesmo banco | verde: 20 `it` (createApp real, consultas reais, Postgres) |
| `tests/integracao/demo/demo-matriz.test.ts` | 46 casos: login (7 perfis), módulos, Campo (motor de sync real + funções das telas), Gestão (sync da supervisora, aprovar e rejeitar), BKO (rotas que cada página chama) com a base demo e o `createApp` real | verde: 46 `it` (T-0029: D-C08..D-C12, D-G03, D-G04, D-B14, D-B20/D-B26..D-B28 viraram `it`; D-C11a passou a ser offline → reconexão) |
| `tests/integracao/demo/smoke-demo.test.ts` | **Smoke da demo de 03/11** (S0..S7 = M-D13..M-D19): Sincronizar com todas as entidades do APK; Boto Rosa com cadastro incompleto (vendedor2@); busca "óleo para moto 150 cilindradas" → OLE-4T-1L online (API) e offline (aparelho); pedido 8% → aprovação; push "pedido aprovado" pelo **despachante real** (notificação + mensagem ao Expo com `data.link`/`data.entidades`); `GET /v1/sync/novidades` só com pedido/notificação; 000010 no BKO com itens, histórico e CNPJ; promotor sem pedido | ver "Rodada 02/11" abaixo |
| `tests/modulos/demo-abas.test.ts` | abas do Campo e do Gestão no `criarShell` real (páginas lidas do fonte) | verde: 7 (D-C00c Catálogo e D-G00 com Catálogo viraram sozinhos com a aba do T-0052; D-G05a: Gestor ligado = Equipe, Aprovações, Alertas; D-C00b Loja e D-G05 Gestor na base demo seguem `it.fails`, este lendo as licenças do seed) |
| `tests/integracao/demo/gestor-e2e.test.ts` | **T-0055, Gestor ponta a ponta** (G1..G7): sem licença 403 MODULO_INATIVO; admin liga; pedido 8% → despachante → fila de Aprovações da supervisora; painel/ficha/ranking; vendedor/promotor 403, analista só lê (dispensar 403); aprovar pelo Vendedor tira da fila; tenant A não vê a demo | ver "Rodada 02/11" |
| `tests/integracao/apoio/demo.ts` · `apoio/campo.ts` | `subirApiDemo({ comDoisTenants })`; aparelho com as entidades que os módulos registram no app (Core com `produto`, Vendedor, preço do Catálogo), a consulta de preço no aparelho, os parâmetros do tenant no sync e `semFuso` (modo demonstração) | — |
| `tests/e2e/bko/pedidos-bko.spec.ts` | **T-0029, Pedidos no navegador**: o vendedor envia um pedido de 8% pela API → analista: lista, filtro de status e busca na URL, limpar, gaveta com itens e PDF; supervisora: aprovar pelo painel "Aguardando aprovação" → "Aprovado" na lista e na API; Alçadas em leitura; nenhuma rota da Fase M. O pedido do teste é cancelado no fim | 5/5 (ver "Rodada" abaixo) |
| `tests/e2e/bko/demo-bko.spec.ts` + `playwright.config.ts` | BKO no navegador (Chrome instalado), analista e admin, cada página pelo menu, F5 com rede lenta; Rotas, "em construção", Auditoria, Pedidos e Alçadas conferem que nenhuma rota da Fase M é chamada | T-0029: D-B26 e D-B28 viraram `test` (34 `test`) |

Rodar: `MACUXI_PG_EXIGIR=1 pnpm test:tests` (vitest). BKO: demo no ar + `pnpm --filter web dev` + `pnpm test:e2e`.

**Rodada T-0029 (onda 3, 2026-11-01):** `pnpm test:e2e` contra a demo que já estava no ar (API 8100, base `demo`; não subi
nem derrubei a demo de outra janela) + `pnpm --filter web dev`: 39 casos (34 de `demo-bko` + 5 de `pedidos-bko`), 36 verdes na
primeira passada; os 3 vermelhos (D-B05/D-B12 analista, D-B23 analista, D-B21 admin) eram o formulário de login limpo pelo HMR do
`next dev` entre o preencher e o clicar (outro agente editando `apps/web`): o `entrar` dos dois specs passou a repetir
preencher + clicar até o menu aparecer, e os 3 passaram na nova passada. Efeito na base da demo: cada passada de `pedidos-bko`
deixa 1 pedido do vendedor com a observação "e2e testes" **aprovado e depois cancelado** (números 000011 em diante).
Quando uma correção chega, o `it.fails` ou `test.fail` correspondente fica vermelho: troque por `it` ou `test`.

**Rodada 02/11 (véspera da demo, agente `testes`):** `smoke-demo.test.ts` 9/9 verde (createApp real, base demo com a 0013,
despachante real): S0 Sincronizar com todas as entidades do APK sem erro · S1 Boto Rosa com "Cadastro incompleto" (falta
CEP) na carteira da **vendedor2@** — o Lucas não tem esse cliente · S2 "óleo para moto 150 cilindradas" → OLE-4T-1L em 1º
(API, interpretado por regras, sem IA) e offline (busca local) · S3 pedido 8% → "para aprovar" (prioridade alta) para a
supervisora → aprovado · S4 notificação "Pedido aprovado" do Lucas com `link=/m/pedido?id=…`, mensagem ao Expo com
`data.entidades = [pedido, pedido_evento, notificacao]` (o título ainda sai **sem o número**: R-20261102-162937-testes) ·
S5 novidades em dia = `[]`; depois da aprovação, só pedido/pedido_evento/notificacao · S6 000010 com itens, histórico e
CNPJ · S7 promotor sem pedido. `demo-matriz` 46/46 e `pedido-fatia` 20/20 verdes (D-C04 e 10c estouraram 60 s na primeira
passada com a máquina carregada por outros agentes; sozinhos, verdes — D-C04 levou 72 s). `demo-abas` 7/7 (D-C00c e D-G00
viraram com a aba do Catálogo; D-G05 lê as licenças do seed e vira sozinho quando o Gestor entrar na demo; D-G05a novo).
Gestor (T-0055) ponta a ponta: `gestor-e2e.test.ts` (G1..G7).

## Roteiro manual nos APKs (Alexandre)
Pré-requisito: demo no ar (`scripts/demo/subir-demo.ps1`: API, **worker** e túnel do domínio fixo), base `demo` recarregada
com a 0013, APKs `campo-preview` e `gestao-preview` do build das 22h de 02/11. **Não há mais campo Servidor no login** (o
app usa o endereço do build; se a API cair, aparece só "Servidor indisponível — tente mais tarde"). Código `demo`, senha
`demo-macuxi`. Na base: alçadas 5% (vendedor), 10% (supervisora), 15% (gerente), acima disso o analista; o Supermercado
Bom Preço é do Atacado (açaí sem preço); o **Atacado Boto Rosa é da vendedor2@ (Camila)**, não do Lucas.

### Demo 03/11 — telas novas (M-D13 a M-D19)
Ordem sugerida para a apresentação. Automação de cada passo: `tests/integracao/demo/smoke-demo.test.ts` (S0..S7).

| ID | Passos | Esperado |
|---|---|---|
| M-D13 | Campo (qualquer perfil) › **Início**: olhar o cartão de sincronização; tocar **Sincronizar** | linha "Última sincronização hh:mm · N na fila" (hora de Manaus); durante o toque o botão mostra que está sincronizando; no fim, a hora muda e a fila fica em 0. Tocar de novo em menos de 30 s não repete (mostra "Atualizado há instantes"). O mesmo botão está em **Perfil** |
| M-D13a | **Modo avião** → registrar um check-out ou um pedido → voltar ao Início | "… · 1 na fila" e o aviso "1 item na fila do aparelho"; desligar o modo avião → **Sincronizar** → "0 na fila" |
| M-D14 | Em **Clientes**, **Pedidos**, **Rota**, **Metas**, **Notificações** e **Catálogo**: **puxar a lista para baixo** | aparece o indicador de carregamento e some; o rodapé passa a "Atualizado às hh:mm · puxe para sincronizar" (ou "Atualizado há instantes" se puxar de novo logo em seguida) |
| M-D15 | Campo (**vendedor2@** — Camila) › **Clientes** → procurar "Boto Rosa" | o Atacado Boto Rosa aparece com a etiqueta **Cadastro incompleto**; na ficha, a mesma etiqueta (falta CEP). Nenhum outro cliente tem a etiqueta. Com vendedor@ (Lucas) o Boto Rosa **não aparece** (carteira dela) |
| M-D16 | Campo (vendedor@) › aba **Catálogo** → digitar "óleo para moto 150 cilindradas" | o **Óleo para motor 4T 20W50 1 L (motos 125 a 160 cc)** (OLE-4T-1L) vem no topo, com preço e estoque. Em modo avião a mesma busca acha o produto e mostra o aviso discreto de busca simples (sem sinal). Na ficha de um cliente, **Ver catálogo** abre a aba com o preço da tabela dele |
| M-D16a | Campo (promotor@) › aba **Catálogo** | a vitrine abre **sem preço e sem estoque**; nenhum botão de pedido |
| M-D17 | Campo (vendedor@) › Clientes → um cliente do Varejo → **Novo pedido** com desconto **8%** → **Enviar** | antes de enviar, o aviso de que vai para aprovação; na lista: **Aguardando aprovação** com número novo |
| M-D17a | Gestão (supervisor@) › Pedidos › **Para aprovar** → abrir o pedido do M-D17 → **Aprovar** | o pedido sai de "Para aprovar" e fica **Aprovado** |
| M-D17b | **Push de aprovação** no celular do Lucas (app Campo fechado ou em segundo plano) | chega "Pedido aprovado" (hoje sem o número: pedido R-20261102-162937-testes ao modulo-vendedor); tocar abre o **detalhe do pedido** já Aprovado. **Só funciona com o Firebase configurado no build (google-services) e `MACUXI_PUSH_ATIVO=1` no servidor da demo.** Sem push: no Campo, **Sincronizar** (ou puxar a lista de Pedidos) → o pedido vira Aprovado e a notificação aparece no sino do Início |
| M-D18 | Campo (vendedor@) › Pedidos → abrir o pedido aprovado → **Exportar PDF** → **PDF do cliente** → Compartilhar; depois **PDF interno** | detalhe com itens, total, histórico (Recebido → Aguardando aprovação → Aprovado, com a Renata). PDF do cliente: número, cliente com CNPJ, itens e total, **sem nenhum %**; interno: desconto 8,0% e quem aprovou |
| M-D19 | BKO (analista@) › **Pedidos** → buscar **000010** → abrir | a gaveta abre com o cliente e o campo "Documento do cliente" (**CNPJ**), itens, total e histórico; botões PDF do cliente e PDF interno (diálogo de impressão → "Salvar como PDF") |
| M-D19a | Campo (promotor@): abas e ficha do cliente | sem aba Pedidos, sem "Novo pedido" na ficha (regra 7); aba Catálogo presente (M-D16a) |

| ID | Passos | Esperado |
|---|---|---|
| M-D01 | Campo: entrar como vendedor@, vendedor2@ e promotor@; tentar supervisor@ no Campo e vendedor@ no Gestão | os três entram; os do app errado recebem o aviso do app certo |
| M-D02 | Campo (vendedor@): aba Rota → 6 paradas; abrir uma no mapa / navegação | 6 paradas com endereço; o mapa abre no ponto do cliente |
| M-D03 | No cliente (ou com o GPS longe): Check-in → checkout "sem pedido" com motivo. Repetir longe do cliente e com "cliente fechado" + **foto da fachada** | perto: sem aviso. Longe: pede justificativa de fora do raio. Fechado: pede a foto. As três aparecem no BKO › Visitas |
| M-D04 | **Modo avião**: check-in + checkout noutra parada; desligar o modo avião; Sincronizar | a parada fica "feita" sem sinal; a fila mostra 2 itens; depois do sync a fila zera e a visita aparece uma vez no BKO |
| M-D05 | Clientes → um cliente → ficha: **Ligar** e **WhatsApp** | abrem o discador e o WhatsApp com o telefone fictício |
| M-D06 | Aba Metas | 4 metas do mês; no dia 1º, tudo zerado (O-2) |
| M-D07 | Início: card de notificações → abrir o recado do supervisor → voltar | o contador cai de 1 para 0 e o BKO › Recados mostra "lido" |
| M-D08 | Campo (vendedor@): aba **Pedidos** | os 7 pedidos do Lucas com número, cliente, total e status (1 aguardando aprovação, 1 rejeitado, 1 cancelado) |
| M-D08a | Clientes → um cliente do Varejo → **Novo pedido**: 2 produtos, desconto **3%**, condição permitida → **Enviar** | o app mostra o total; depois do envio o pedido aparece na lista como **Aprovado** (dentro da alçada, P-1) com o próximo número do contador (o contador não volta ao recarregar a base) |
| M-D08b | Novo pedido com desconto **8%** → Enviar | antes de enviar o app avisa que vai para aprovação; na lista: **Aguardando aprovação** (supervisora) |
| M-D08c | Novo pedido com desconto **12%** → Enviar | **Aguardando aprovação** do gerente |
| M-D08d | Supermercado Bom Preço (Atacado) → Novo pedido → procurar o açaí | o açaí aparece "Sem preço para este cliente" e não entra no pedido (RN-CAT-06) |
| M-D08e | **Modo avião** → novo pedido de 3% → Enviar; desligar o modo avião → Sincronizar | sem sinal o pedido fica "Na fila"; com sinal sobe **uma** vez e vira Aprovado |
| M-D08f | Abrir o pedido de 8% → **Exportar PDF → PDF do cliente → Compartilhar → WhatsApp** | o PDF abre com número, cliente, itens e total, **sem nenhum %**; o "PDF interno" mostra o desconto e a alçada |
| M-D09 | Campo (promotor@): abas e ficha do cliente | sem aba Pedidos e sem "Novo pedido" na ficha; sem aba Loja (D-C00b) |
| M-D10 | Gestão (supervisor@): abas, Clientes (30), notificação "pedidos para aprovar" → aba **Pedidos** → chip **Para aprovar** | Início, Clientes e **Pedidos**; em "Para aprovar" os pedidos do nível da supervisora (os 2 da base + o de 8% do M-D08b); o de 12% não aparece para ela |
| M-D10a | Gestão (supervisor@): abrir o pedido de 8% → **Aprovar** (1 toque) | o pedido sai de "Para aprovar" e fica **Aprovado**; no Campo do Lucas, depois do Sincronizar, também |
| M-D10b | Gestão (supervisor@): outro pendente → **Rejeitar** sem motivo; depois com motivo "Desconto acima da política" | sem motivo o botão não confirma; com motivo fica **Rejeitado** e o Lucas vê o motivo no detalhe |
| M-D10c | **Modo avião** no Gestão → abrir um pendente | os botões Aprovar/Rejeitar ficam desabilitados com o aviso "Aprovar exige internet" |
| M-D10d | Gestão (gerente@): aba Pedidos → aprovar o de 12% | **Aprovado**; o histórico mostra o Marcelo |
| M-D10e | Gestão: no detalhe de um pedido → **Exportar PDF → Compartilhar** | mesmo PDF do Campo, com o nome de quem aprovou na versão interna |
| M-D11 | BKO (admin@) › Aparelhos → bloquear o celular do vendedor; no app, Sincronizar | o app avisa que o aparelho foi bloqueado e apaga os dados locais; desbloquear e entrar de novo |
| M-D12 | BKO no navegador do PC: analista@, admin@ e supervisor@ por todas as páginas do menu; F5 em `/pedidos` | todas abrem; em **Pedidos** os pedidos do ensaio aparecem com o status novo (Aprovado/Rejeitado), filtros e busca pelo número funcionam |
| M-D12a | BKO › Pedidos → abrir um pedido → **PDF do cliente** → no diálogo de impressão, "Salvar como PDF" | o PDF salvo tem número, cliente, itens e total, sem `%` (P-5: pelo diálogo de impressão, não download direto) |
| M-D12b | BKO (supervisor@) › Pedidos → painel "Aguardando aprovação" → **Aprovar** um pendente do nível dela | sai do painel e a linha mostra "Aprovado"; o analista não tem botão nos pedidos de nível supervisor/gerente (P-3) |
