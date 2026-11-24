# Revisão geral das telas: marca, cor e padrão executivo (24/11/2026)

> design-de-marca · 24/11/2026, 18h (Manaus) · pedido do Alexandre em R-20261124-091113 e R-20261124-094002, item 3.
> Base: `docs/marca/manual.md` (v1 e decisões até 22/11/2026). Só auditoria: nenhum código foi alterado.
> Material: prints do BKO e do portal `config.` em 1366 px (seed de demonstração, tenant fictício "Distribuidora Exemplo"),
> copiados em [`2026-11-24-revisao-geral/`](2026-11-24-revisao-geral/); app Campo e Gestão pelo código e pelos prints de
> `docs/design/`; PDF e e-mail pelo código (`modules/vendedor/domain/pdf-pedido.ts`, `packages/platform-sdk/src/email/modelos.ts`)
> e por `docs/design/emails/redefinir-senha/`.

## Leitura rápida

- **Paleta no código está limpa na web:** nenhum hex solto fora da paleta em `modules/*/web`, `apps/web` e `apps/mobile/src`;
  os tokens de `apps/web/app/globals.css` batem com o manual. As cores fora da paleta estão nos tokens do app
  (`packages/ui/src/mobile/tokens.ts`) e no cabeçalho verde do PDF (aprovado em T-0159).
- **O excesso de cor vem dos selos (chips), não dos hex.** Toda situação "normal" ganha cor: Aprovado e Faturado em verde,
  Publicada em verde, Ativa em verde, Em dia em verde, Atingiu em verde, Aberto em âmbar ou vermelho, Sem check-in em âmbar.
  Numa lista de 30 linhas, a tela fica verde (Frases da carga) ou âmbar (Alertas). É o mesmo problema que o Alexandre viu no
  farol de Clientes (já na fila).
- **O menu lateral do BKO é uma coluna laranja:** com os grupos fechados, 12 títulos em Sol claro, e 3 deles são links
  (Pesquisa, Treinamento, Parâmetros), o que o manual não permite.
- Achados de **regra do manual** (o dono corrige sem nova aprovação) estão separados das **propostas do padrão executivo**
  (mudam o manual e dependem do "aprovo" do Alexandre).

Gravidade: **alta** = marca errada visível ao cliente em toda tela; **média** = fere o manual numa tela; **baixa** = detalhe.

---

## 1. BKO · menu lateral (todas as telas)

**MA-01 · média · Sol claro em link do menu.** Pesquisa, Treinamento e Parâmetros são grupos de um item só e viram link
direto, mas continuam em caixa alta e Sol claro `#F59A52` ([bko-menu-aberto.png](2026-11-24-revisao-geral/bko-menu-aberto.png),
[bko-pesquisas.png](2026-11-24-revisao-geral/bko-pesquisas.png), [bko-trilhas.png](2026-11-24-revisao-geral/bko-trilhas.png)).
O manual §3 permite o Sol claro só no título de grupo, "nunca em item, link ou botão" (MC-0054). Também a tela atual desses
três sai em caixa alta e sem o filete, diferente das outras telas.
Dono: engenheiro-apps · `apps/web/components/app-shell.tsx:157-160` (`TITULO_TEXTO` + `text-nav-grupo`).
Correção: link de um item só no padrão de item (`text-nav-text` `#C9CED5`, 15 px/500, sem caixa alta; ativo
`bg-nav-active` `#2B3743` + branco), ou dentro do grupo do assunto.

**MA-02 · baixa · filete laranja na tela atual.** O item ativo leva um filete de 3 px em `bg-nav-grupo` (Sol claro)
(todas as telas, ex. [bko-alertas.png](2026-11-24-revisao-geral/bko-alertas.png)). A tela atual aprovada é só o fundo `#2B3743`
(MC-0055); o Sol claro em item é proibido (§3).
Dono: engenheiro-apps · `apps/web/components/app-shell.tsx:107-109`.
Correção: tirar o `before:` ou pintar o filete de branco `#FFFFFF` (12,14:1 no `#2B3743`).

**MA-03 · proposta (depende do Alexandre) · título de grupo em Sol claro.** Com tudo fechado, o menu é uma coluna de 12 palavras
laranja em caixa alta ([bko-menu-aberto.png](2026-11-24-revisao-geral/bko-menu-aberto.png)). Isso cumpre o MC-0054 aprovado,
mas é o ponto de mais cor do BKO e briga com o farol e os selos. Opções:
- A) manter Sol claro `#F59A52` (como hoje);
- **B) Azul claro `#9AA3B0`** (6,47:1 no grafite), 12/600 em caixa alta; o laranja fica só no sol do logo. **Recomendado**:
  o menu passa a ser "estrutura" e não "destaque", que é o padrão executivo pedido;
- C) `#C9CED5` 12/600 (7,67:1): mais claro, se aproxima demais dos itens.
Token: `--color-nav-grupo` (`apps/web/app/globals.css:40`, engenheiro-apps). Se aprovado, muda o manual §3 (linha do Sol claro).

**Já na fila:** a barra superior Azul noite que o manual §4 prevê no BKO não existe hoje (o BKO só tem o menu grafite); entra junto
com o "menu do usuário no canto superior direito".

## 2. BKO · Início

Sem achado de marca: só a barra de positivação em Sol laranja (gráfico, correto), pontos de situação com texto ao lado.

## 3. BKO · Alertas da equipe

**MA-04 · média · mesma palavra, duas cores.** A coluna Situação mostra "Aberto" em âmbar e "Aberto" em vermelho
([bko-alertas.png](2026-11-24-revisao-geral/bko-alertas.png)). A cor carrega a severidade sem texto, o que o manual §3 proíbe
("só para situação, sempre com texto"), e a coluna inteira fica colorida.
Dono: modulo-gestor · `modules/gestor/web/pages/alertas-page.tsx:17,22`.
Correção: "Aberto" em `neutral` (`#34404D` na Névoa `#ECEEF1`); severidade crítica com texto próprio ("Urgente") em `danger`
`#A8261B`/`#FDE8E6`; atenção sem selo de cor.

## 4. BKO · Pedidos (e o mesmo status no app Campo)

**MA-05 · proposta (depende do Alexandre) · selos de fluxo normal em verde.** Aprovado, Faturado e Faturado parcialmente em verde;
Cancelado e Rejeitado em vermelho ([bko-pedidos.png](2026-11-24-revisao-geral/bko-pedidos.png)). A lista de 11 pedidos tem 6 selos
verdes e 2 vermelhos. Proposta executiva: Aprovado, Enviado, Faturado e Faturado parcialmente em `neutral`; Aguardando aprovação em
`pending` (Azul noite no Azul suave, 9,83:1); só **Rejeitado** em `danger`; Cancelado em `neutral` (cancelar é decisão, não erro).
Dono: modulo-vendedor · `modules/vendedor/web/components/orders/status.tsx:6-11`.

**MA-06 · média · o mesmo status com cores diferentes no BKO e no app.** "Aguardando aprovação" é Azul suave no BKO
(`pending`) e âmbar no app (`TONS_ESTADO.aviso`); "Na fila" é âmbar no app. A marca muda de cor entre superfícies para a mesma
situação (manual §5.2/§4, "telas equivalentes, mesmo papel"). Faturado parcial também tem rótulo diferente
("Faturado parcialmente" × "Faturado parcial", `packages/ui/src/comum/historico.ts:56`).
Dono: modulo-vendedor · `modules/vendedor/app/lib/order-status.ts:15-26` e `web/components/orders/status.tsx:6-11`.
Correção: uma tabela só de status → tom em `packages/ui/src/comum/historico.ts` (designer-ux), usada pelos dois.

## 5. BKO · Painel da equipe

**MA-07 · baixa · "Sem check-in" em âmbar em todas as linhas.** No começo do dia toda a equipe aparece em âmbar
([bko-equipe.png](2026-11-24-revisao-geral/bko-equipe.png)); "Em visita" fica verde. Estado esperado não é aviso.
Dono: modulo-gestor · `modules/gestor/web/pages/painel-page.tsx:20`.
Correção: `sem_checkin` e `em_rota` em `neutral`; `em_visita` em `pending` (Azul suave); âmbar só depois do horário limite do
check-in, se a regra existir.

## 6. BKO · Aprovações da equipe

**MA-08 · baixa · vermelho repetido.** O cartão "Vencidos 3" em vermelho e os três selos "Vencido há…" em vermelho
([bko-aprovacoes.png](2026-11-24-revisao-geral/bko-aprovacoes.png)): a mesma informação duas vezes em cor de erro.
Dono: modulo-gestor · `modules/gestor/web/pages/aprovacoes-page.tsx:41`.
Correção: número do cartão em `text-ink` `#16202A`; o vermelho fica só no selo da linha.

## 7. BKO · Trade marketing → Indicadores

**MA-09 · média · cartão grafite no conteúdo.** "Atingimento 97,3%" num cartão cheio grafite `#16202A`
([bko-trade.png](2026-11-24-revisao-geral/bko-trade.png)). O grafite é texto, botão Sincronizar e menu (§3); no conteúdo vira
o elemento mais escuro da tela e parece botão. Nenhuma outra tela do BKO usa.
Dono: modulo-promotor · `modules/promotor/web/pages/trade-page.tsx:118` (`dark`).
Correção: tirar o `dark` (cartão branco igual aos vizinhos).

**MA-10 · proposta (depende do Alexandre) · Atingiu verde × Abaixo da meta vermelho.** Cada linha leva cor
([bko-trade.png](2026-11-24-revisao-geral/bko-trade.png)). Ficar abaixo da meta não é erro. Proposta: "Atingiu" em `neutral`,
"Abaixo da meta" em `warning` (`#7A4F00` no `#FFF1D6`).
Dono: modulo-promotor · `modules/promotor/web/pages/trade-page.tsx:84`.

## 8. BKO · Metas e RV

**MA-11 · baixa · aviso âmbar para informação.** "Parcial até 02/12/2026" num selo âmbar
([bko-metas.png](2026-11-24-revisao-geral/bko-metas.png)). Mês aberto é o estado normal, não aviso. "Mês fechado" em verde também
é enfeite.
Dono: modulo-core · `modules/core/web/components/metas/metas-page.tsx:176`.
Correção: os dois em `neutral`.

## 9. BKO · Produtos → Preço e custo

**MA-12 · média · verde de sucesso como enfeite.** A unidade padrão sai num selo verde ("UN · padrão", "FD · padrão") em todas
as 40 linhas ([bko-produtos.png](2026-11-24-revisao-geral/bko-produtos.png)). "Padrão" não é situação; o manual §3 proíbe
"verde de sucesso como enfeite".
Dono: modulo-core · `modules/core/web/components/produtos/produtos-page.tsx:139`.
Correção: `tone={u.padrao ? 'pending' : 'neutral'}` (Azul noite no Azul suave) ou todos `neutral`, com "· padrão" no texto.

## 10. BKO · Rotas

**MA-13 · média · laranja como situação.** "Em atendimento" usa Sol laranja `#C2540A` no ponto do mapa e na legenda, e a rota da
2ª pessoa (Joana) também é Sol laranja ([bko-rotas.png](2026-11-24-revisao-geral/bko-rotas.png)): o mesmo laranja quer dizer
"pessoa 2" e "em atendimento". O laranja é série de gráfico (§3, MC-0014), não situação.
Dono: modulo-core · `modules/core/web/lib/routes.ts:200` (`STATUS_FILL.in_progress`).
Correção: em atendimento com preenchimento Azul noite `#1E3350` e miolo branco (ou anel duplo), sem cor de série.

**MA-14 · baixa · número verde.** "Visitadas 0" com o número em verde ([bko-rotas.png](2026-11-24-revisao-geral/bko-rotas.png));
os vizinhos estão em grafite.
Dono: modulo-core · `modules/core/web/components/routes/routes-page.tsx:419`.
Correção: tirar `valueClass="text-success"`.

## 11. BKO · Pesquisas e Treinamento

**MA-15 · proposta (depende do Alexandre) · "Publicada" em verde.** ([bko-pesquisas.png](2026-11-24-revisao-geral/bko-pesquisas.png),
[bko-trilhas.png](2026-11-24-revisao-geral/bko-trilhas.png)). É o estado normal da lista. Proposta: `neutral`; Rascunho fica
`pending` (pede ação).
Donos: modulo-pesquisa · `modules/pesquisa/web/pages/questionarios-page.tsx:36`; modulo-treinamento ·
`modules/treinamento/web/pages/trilhas-page.tsx:44`.

**MA-16 · baixa · "Arquivada" em âmbar.** Arquivar é decisão, não aviso.
Dono: modulo-treinamento · `modules/treinamento/web/pages/trilhas-page.tsx:44`. Correção: `arquivada: 'neutral'`.

## 12. BKO · Integração ERP

**MA-17 · proposta (depende do Alexandre) · "Em dia" em verde.** ([bko-integracao.png](2026-11-24-revisao-geral/bko-integracao.png)).
Proposta: "Em dia" em `neutral`; "Com falha" segue `danger`. Assim o vermelho se destaca.
Dono: modulo-integracao · `modules/integracao/web/components/entidades-panel.tsx:66` (o portal usa a mesma regra em
`apps/web/lib/portal-monitor.ts:75`, engenheiro-apps).

**MA-18 · baixa · "Atualizar" como link.** Aqui "Atualizar" é texto Azul noite; em Indicadores, Visitas, Rotas e Auditoria é botão
de contorno ([bko-indicadores.png](2026-11-24-revisao-geral/bko-indicadores.png)). Mesmo papel, mesma forma.
Dono: modulo-integracao · `modules/integracao/web/components/monitor-page.tsx:40`. Correção: `<Button variant="secondary">`.

## 13. BKO · Catálogo

**MA-19 · baixa · abas como botões.** Produtos, Sinônimos e Buscas sem resultado são botões (o ativo cheio de Azul noite,
[bko-catalogo.png](2026-11-24-revisao-geral/bko-catalogo.png)); Clientes, Treinamento e Cadastros de trade usam aba com filete.
Azul noite cheio é do botão principal; a aba ativa tem outro desenho (§3).
Dono: modulo-catalogo · `modules/catalogo/web/pages/catalogo-page.tsx:52-57`. Correção: usar `Abas` de `packages/ui/src/web/abas.tsx`.

## 14. BKO e portal · página não encontrada

**MA-20 · média · 404 genérico em inglês, sem marca.** "404 · This page could not be found." em fundo branco, no BKO e no portal
([bko-tarefas.png](2026-11-24-revisao-geral/bko-tarefas.png), [config-planos.png](2026-11-24-revisao-geral/config-planos.png)).
Não há `not-found.tsx` em `apps/web/app`. É a página padrão do Next.js: cara de sistema genérico (§1, "a marca nunca é").
Dono: engenheiro-apps · `apps/web/app/` (criar `not-found.tsx` e `(bko)/not-found.tsx`).
Correção: fundo Pérola, título 24/700 "Página não encontrada", uma linha de apoio `#4A5562` e o botão principal "Voltar ao início";
no portal, com a faixa Azul noite e o logo negativo.

## 15. Portal `config.`

**MA-21 · proposta (depende do Alexandre) · coluna inteira de "Ativa" verde.** Frases da carga: 30 selos verdes
([config-frases-carga.png](2026-11-24-revisao-geral/config-frases-carga.png)); Empresas: "Ativa" verde
([config-empresas.png](2026-11-24-revisao-geral/config-empresas.png)). Proposta: "Ativa" `neutral`, "Inativa"/"Suspensa" com
destaque.
Dono: engenheiro-apps · `apps/web/lib/portal-frases-carga.ts:37`, `apps/web/lib/portal-empresa-acoes.ts:71`.

**MA-22 · baixa · nome de agente no portal.** O diagnóstico enviado mostra "a alexandre e engenheiro-apps"
(`apps/web/lib/portal-diagnosticos.ts:295`): nome interno do time na tela. Dono: engenheiro-apps.
Correção: "Enviado à equipe Macuxi".

**MA-23 · nota (consultar o Alexandre) · frases da tradição.** As frases 17 a 24 contam narrativas de Makunaimã, Enxikirang, Siikë,
Wazacá e Wayaka ([config-frases-carga.png](2026-11-24-revisao-geral/config-frases-carga.png);
`packages/platform-sdk/src/frase-carga.ts:131-135`). O conteúdo foi aprovado (R-20261115-071500 e R-20261115-075500) e é texto,
não grafismo, mas o manual §8 pede origem registrada e crédito para o que vem da cultura macuxi. Recomendação: registrar a fonte
de cada frase (em `docs/design/carga-aviso-frases/frases.md`) e, quando possível, validar com uma organização macuxi. Não segura.
Dono do texto: engenheiro-software.

## 16. App Campo e Gestão (código e prints de `docs/design/`)

**MA-24 · média · cores fora da paleta nos tokens do app.** `packages/ui/src/mobile/tokens.ts`:
- `warningInk: '#5C3B00'` (`:69`), texto de aviso no chip, no contador e na sincronização: "quase igual" ao aviso `#7A4F00` da
  paleta (ex.: "Vence hoje" em `docs/design/pedido-aprovacao/03-gestao-aprovacoes.png`);
- `successLine: '#B9DCCB'` e `successTrack: '#C6E3D5'` (`:62-63`), borda e trilho do cartão de sucesso: verdes que não estão
  no manual;
- `shadowColor: '#0F1419'` (`:145-147`): sombra fora da paleta (baixa).
Dono: designer-ux. Correção: `warningInk` → `#7A4F00` (6,0:1 no `#FFF1D6`, já usado na web); `successLine` → `#DFE2E6` (linha);
`successTrack` → `#ECEEF1` (Névoa); sombra → `#16202A` com a mesma opacidade. Teste de tokens atualizado.

**MA-25 · baixa · códigos internos no texto de diagnóstico do app.** O texto de "Copiar ou compartilhar" leva
"diagnóstico de carga (T-0008)" e "T-0084, critério 5" (`apps/mobile/src/app/diagnostico-carga.tsx:193`,
`apps/mobile/src/lib/diagnostico-carga.ts:839,863,891`). O vendedor envia esse texto para o cliente ou o supervisor.
Dono: engenheiro-apps. Correção: "Diagnóstico de carga" e "busca do Novo pedido", sem número de tarefa.

Prints conferidos sem achado: Performance (`docs/design/filtro-padrao-campo/05-performance.png`, barras em Sol laranja, faixa
Azul noite) e Clientes (`03-clientes.png`, contador do filtro em Sol laranja, permitido como contador).

## 17. Códigos internos em mensagens ao cliente (código)

Nenhum RN-, RF-, T-, ADR ou RD- apareceu nos textos extraídos das telas (`textos-bko.json`, `textos-gavetas.json`,
`textos-config.json`). No código, estas mensagens chegam à pessoa com o código entre parênteses:

**MA-26 · média · erros e avisos com "(RN-…)".**
- modulo-vendedor · `modules/vendedor/api/orcamentos.ts:57`: `${texto} (RN-VEN-18)` (erro do orçamento, app e BKO);
- modulo-gestor · `modules/gestor/domain/pedido-em-nome.ts:30`: "O promotor não faz pedido (RN-PRO-01)…" (Gestão);
- modulo-integracao · avisos do lote no BKO → Integração: `modules/integracao/domain/catalogo-produto.ts:33,41,47,52` (RN-CAT-11,
  RN-CAT-09), `modules/integracao/domain/pagamento.ts:23` (RN-VEN-24), `modules/integracao/api/aplicar-lote.ts:111` (RN-INT-04);
- modulo-catalogo · `modules/catalogo/api/consumidores-erp.ts:23` e modulo-core · `modules/core/api/erp-apoio.ts:13`
  (`referencia_ausente: … (RN-INT-04)`, também com o código técnico no começo);
- modulo-treinamento · `modules/treinamento/api/sync.ts:35` "(RN-TRE-04)" (rejeição na sincronização do app).
Correção: o código da regra fica no campo `code` do erro (para log e teste) e sai do texto mostrado.
**Fora deste relatório:** `packages/ui/src/web/perfis.ts:61-66` (RN-CORE-04/32/35 nas dicas de Perfis) é Parâmetros, que a S3
já corrige; e "perfis sem perfil base" já está na fila.

## 18. PDF do pedido e do orçamento

Conferido em `modules/vendedor/domain/pdf-pedido.ts`: só cores da paleta, "PEDIDO" em Azul noite, pesos 400/600/700,
nada abaixo de 12 px; o total em 26 px é a exceção do §5.3.

**MA-27 · proposta (depende do Alexandre) · cabeçalho verde da tabela.** `COR_CABECALHO_TABELA = '#00843D'`
(`pdf-pedido.ts:185`, modulo-vendedor) é o único verde forte fora da paleta que chega ao cliente da distribuidora. Foi aprovado
em T-0159 e o manual §7 o mantém. No padrão executivo, recomendo **Azul noite `#1E3350`** com texto branco (12,77:1), que liga o
cabeçalho ao "PEDIDO" do topo. Opções: A) manter `#00843D`; **B) Azul noite (recomendado)**; C) grafite `#16202A`.

## 19. E-mails

Conferido em `packages/platform-sdk/src/email/modelos.ts` e `docs/design/emails/redefinir-senha/`: corpo branco, logo positivo de
30 px, filete Azul noite acima da assinatura "Equipe Macuxi FDV · Boa Vista, RR · macuxifdv.com.br", botão Azul noite, pilha com
a reserva Arial. Sem cor fora da paleta (o `#3A4D68` do modo escuro é o trilho aprovado no §4).

**MA-28 · baixa · tamanhos fora da escala.** Validade em 14 px (`modelos.ts:182`) e valor em destaque em 22 px (`:177`); a escala
web é 13/15 e 20/24 (§5.3).
Dono: engenheiro-software. Correção: validade 13 px; destaque 20 px (ou 24 px, se a senha precisar de mais peso visual).

## Fora do meu escopo (encaminhar, sem catalogar)

- Portal → Diagnósticos: "Rota não encontrada" na abertura ([config-diagnosticos.png](2026-11-24-revisao-geral/config-diagnosticos.png)), defeito funcional (testes/engenheiro-apps).
- BKO → Pedido (gaveta): "Documento do cliente" com o CNPJ sem máscara (corretor/modulo-vendedor).
- Ranking: período em formato ISO "2026-11-01 a 2026-11-30" (corretor/modulo-gestor).

## Resumo por dono

| Dono | Achados (regra do manual) | Propostas (dependem do Alexandre) |
|---|---|---|
| engenheiro-apps | MA-01, MA-02, MA-20, MA-22, MA-25 | MA-03, MA-21 (e `portal-monitor.ts` da MA-17) |
| designer-ux | MA-24 (e a tabela única de status da MA-06) | — |
| modulo-vendedor | MA-06, MA-26 | MA-05, MA-27 |
| modulo-gestor | MA-04, MA-07, MA-08, MA-26 | — |
| modulo-core | MA-11, MA-12, MA-13, MA-14, MA-26 | — |
| modulo-promotor | MA-09 | MA-10 |
| modulo-pesquisa | — | MA-15 |
| modulo-treinamento | MA-16, MA-26 | MA-15 |
| modulo-integracao | MA-18, MA-26 | MA-17 |
| modulo-catalogo | MA-19, MA-26 | — |
| engenheiro-software | MA-28 | MA-23 (nota) |

Total: 28 itens. 20 de regra do manual (0 alta, 9 média, 11 baixa) e 8 que dependem do Alexandre (MA-03, MA-05, MA-10, MA-15,
MA-17, MA-21, MA-27 e a nota MA-23).

**Pergunta ao Alexandre (padrão executivo, uma decisão só):** "selo colorido só onde a pessoa precisa agir". Situações do fluxo
normal (Aprovado, Faturado, Publicada, Ativa, Em dia, Atingiu, Sem check-in) em cinza neutro (`#34404D` na Névoa `#ECEEF1`);
vermelho só para falha, rejeição e vencido; âmbar só para "abaixo do esperado"; verde só no ✓ e no lápis já aprovados. Com o
"aprovo", isso entra no manual §3 e fecha MA-05, MA-10, MA-15, MA-17 e MA-21 de uma vez, junto com o farol de Clientes da fila.
O menu (MA-03) e o PDF (MA-27) são decisões à parte.

### Parecer
**Liberado com ajustes** para o lote: nenhum achado fere a marca de forma alta. Os 20 itens de regra entram no próximo lote de
cada dono; as propostas aguardam o Alexandre.
