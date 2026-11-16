# v1.0.14 — Menu Parâmetros do BKO (ADR 0060): matriz de cenários

Origem: R-20261115-113500, -121000 (D1 a D10), -122000 (D11); notas N8 do corretor sobre o #457. Desenho: `docs/desenho/menu-parametros.md` (#421). PRs conferidos (heads, 16/11): #421 e #457 já no `main` (`3e1beb48`, squash; o #457 final `84542c4c`), #412 `93721007` (Alçadas), #414 `81d307d6` (Pesquisa), #415 `afdf5677` (Trade), #416 `9d21e395` (Treinamento). Shell web (`apps/web`: menu, `/parametros/[secao]`, redirecionamento): **sem PR v1.0.14 aberto** (ver "Dependências").

Arquivos: e2e `tests/e2e/bko/menu-parametros.spec.ts` (API simulada), `tests/e2e/bko/demo-bko.spec.ts` e `pedidos-bko.spec.ts` (demo real); valor × regra `tests/modulos/parametros-valor-regra-v1014.test.ts`; painéis do Core (visão do shell e contrato) `tests/modulos/parametros-core-n8-v1014.test.ts`; API com banco `tests/integracao/api/parametros-core-v1014.test.ts`; acesso `tests/modulos/acesso-perfil-modulos-rncore01.test.ts`. Unitários do SDK (`shell-parametros.test.ts`, `shell-grupos.test.ts`) e da API (`apps/api/test/app.test.ts`) são do engenheiro-software (#421).

## Menu (ordem, forma, perfil, licença)

| # | Cenário | Esperado | Teste |
|---|---|---|---|
| M1 | Ordem do 1º nível (D1) | Alfabética pelo rótulo; Parâmetros e Sistema por último, nesta ordem | e2e "ordem e forma" |
| M2 | Item direto (D9) | Pesquisa, Treinamento e Parâmetros sem sanfona, rótulo do grupo; nenhum grupo com 1 item | e2e "ordem e forma" |
| M3 | Grupos que saíram | Sem Comercial e Conteúdo de campo | e2e "ordem e forma" |
| M4 | Cadastros e Trade (D4, D7, D8, D11) | Cadastros tem Formas de pagamento e Transportadoras; Trade = Cadastros + Indicadores (rótulo × página) | e2e "Cadastros tem…" |
| M5 | Itens que viraram painel | Do Vendedor só Pedidos, Formas de pagamento e Transportadoras (Alçadas sai, #412); sem Perfis, Motivos, Fotos do PDV, Plano de RV, Regras de alerta | e2e "Cadastros tem…", demo D-B00 |
| M6 | Sem licença da empresa: Pesquisa/Treinamento | Cadeado, `aria-disabled="true"`, `tabindex="0"`, sem `href`, balão "Contrate o módulo para usar"; clique não navega | e2e "sem licença da empresa" |
| M7 | Sem licença: Trade (grupo inteiro) | Entrada do grupo com cadeado; sem itens; não abre | e2e "Trade sem licença" |
| M8 | Empresa contratou, perfil sem o módulo (P3) | Entrada e seção somem (permissão, não contratação) | e2e "P3" |
| M9 | API sem `modulos_contratados` | Nada desativado (compatível) | e2e "API sem modulos_contratados" |
| M10 | Endereço digitado sem licença | Página não abre (vitrine é só exibição) | e2e "endereço digitado" |
| M11 | API sem licença | 403 `MODULO_INATIVO` (RN-CORE-01) | integração da API (CI), `apps/api/test/app.test.ts` (#421) |
| M12 | Tenant errado | `modulos_contratados` só do tenant da sessão | `apps/api/test/app.test.ts` (#421); RLS no CI |

## Página Parâmetros

| # | Cenário | Esperado | Teste |
|---|---|---|---|
| P1 | `/parametros` | Abre a 1ª seção não bloqueada (Acesso, admin); item Parâmetros com `aria-current` | e2e "item Parâmetros" |
| P2 | Seção sem licença | Cadeado na lista; escolhida, só "Contrate o módulo para usar", sem painéis | e2e "sem licença", "Trade sem licença" |
| P3 | Seção sem painel visível (gerente em Clientes) | Some | e2e "gerente não vê a seção Clientes" |
| P4 | Painel por ação (analista) | Sem Fotos do PDV, Etapa pendente, Módulos, Promotor vê pedidos | e2e "permissão: perfil sem a ação" |
| P5 | Transição sem duplicar | Painel e âncora uma vez só | e2e "transição sem duplicar" |
| P6 | Links antigos | `/perfis`, `/usuarios-e-modulos`, `/motivos`, `/fotos-pdv`, `/plano-rv`, `/alcadas`, `/regras-alerta` → `/parametros/<secao>#<modulo>-<id>`; `/formas-pagamento` fica | e2e "links antigos", demo D-B09 |
| P7 | Query do link antigo | `?nivel=perfil&perfil=promotor` chega a Módulos sem abrir a edição em Perfis | e2e "link antigo …", D-PAR-01 |
| P8 | Salvar só com alteração | Botões desabilitados sem mudança, rótulo diz o que salva (farol, curvas, dias úteis, desconto, prazo, almoço) | e2e "Salvar só com alteração"; Almoço: D-PAR-05 (`test.fail`) |
| P9 | Só leitura (P4) | Trade, Pesquisa, Treinamento sem campo editável nem Salvar | e2e "Parâmetros › Trade", "com licença" |

## Valor × regra e rótulo × valor

| # | Painel | Regra | Esperado | Teste |
|---|---|---|---|---|
| V1 | Alçadas (Pedidos) | RN-VEN-10 | 5/10/15% → "Até 5,0%" Vendedor, "Até 10,0%" Supervisor, "Até 15,0%" Gerente, "Acima de 15,0%" bloqueado; só limites; decisões recentes em Operação › Pedidos (D5) | e2e "item Parâmetros", pedidos D-B28 |
| V2 | Trade | RN-PRO-04/07/08/11 | Valor que `parametrosDosBrutos` aplica; "Padrão: X" só no que difere; unidade no valor; conjunto inválido → padrão | unit Trade; e2e Trade |
| V3 | Pesquisa | RN-PES-04/06/07 | Mesmo valor de `parametrosDaRota`; milhar pt-BR; inválido → padrão junto com a API | unit Pesquisa; e2e "com licença" (padrão) e D-PAR-04 (`test.fail`) |
| V4 | Treinamento | RN-TRE | Mesmo valor de `parametrosDoTenant` | unit Treinamento; e2e "com licença" (padrão) e D-PAR-04 (`test.fail`) |
| V5 | Fuso do tenant | RN-CORE-11 | O fuso não muda os limites exibidos | unit D-PAR-03 (`it.fails`) |

| V6 | Frases do dia (título) | RN-CORE-41 | "Frases do dia · N", N = frases da lista de `GET /v1/core/frases` (ativas e desativadas, só do tenant) | API: contagem × banco e tenant B; título "Frases do dia" sem número (N8-PAR-1 corrigido: o #457 final tirou o contador) |
| V7 | Parado entre visitas | RN-CORE-26 | Um valor, um lugar: `inicio.parado_min` gravado só por Parâmetros › Alertas; o GET do Início (lido pelo Gestão) mostra o mesmo valor | API "GET/PUT do parado" |

Dia útil, dia não útil, virada de mês: não se aplicam (painéis de configuração, sem número calculado por data).

## Core (#457): perfil, licença e só consulta

| # | Cenário | Esperado | Teste |
|---|---|---|---|
| C1 | Frases do dia por perfil | Analista e admin (`frase_dia.editar`) veem o painel em Início; gerente não (a API nega o GET: 403) | unit "analista e admin…"; API "gerente recebe 403"; e2e "Frases do dia: gerente…" |
| C2 | Título das Frases | "Frases do dia", sem contador e uma vez só (rótulo × valor: nenhum número que possa divergir) | N8-PAR-1 corrigido (unit e e2e) |
| C3 | Perfil só consulta (P4) | Vê o painel em modo leitura, sem salvar (Medidas: gerente, `GET /v1/core/medidas` com `produto.editar_preco`) | N8-PAR-2 corrigido (unit e e2e); analista e admin veem: unit |
| C4 | Perfil só consulta não ganha edição | Gerente sem `medida.gerenciar`, `frase_dia.editar`, `parametro.inicio`, `parametro.alertas_produtividade` | unit "gerente não ganha ação de edição" |
| C5 | Perfil sem o módulo | Sem Vendedor: sem painel do Vendedor em Pedidos; sem Promotor: sem a seção Trade | unit "perfil sem o Vendedor…" |
| C6 | Empresa sem licença | Seção da vitrine bloqueada e sem painéis; API 403 `MODULO_INATIVO` (Vendedor desligado: `GET /v1/vendedor/alcadas`); o Core segue respondendo (RN-CORE-03) | unit "empresa sem Pesquisa"; API "Vendedor desligado no tenant" |
| C7 | Painéis do Core sem duplicar | Cada painel do Core uma vez, só com o Core ativo | unit "os painéis do Core não dependem de licença" |

## Início × Alertas (#456 dentro do #457, RN-CORE-26)

| # | Cenário | Esperado | Teste |
|---|---|---|---|
| A1 | PUT do Início com `parado_min` | 400 `VALIDACAO` (campo não reconhecido `parado_min`); nada muda | API "PUT do Início com parado_min"; contrato (strict) |
| A2 | PUT do Início só com dias úteis | 200; devolve o parado em vigor sem gravá-lo; sem `almoco_corte`/janela | API "PUT do Início só com dias úteis" |
| A3 | Contrato do Início | Corpo só `dias_uteis_semana`; sem `almoco_corte`/janela (almoço = `jornada.almoco_padrao`, Parâmetros › Calendário) | unit "contrato do Início…" |
| A4 | GET/PUT do parado (`/v1/core/parametros/parado-min`) | Padrão 60; grava 45 e o GET do Início mostra 45; reenvio igual não grava nem audita de novo | API "GET/PUT do parado…" |
| A5 | Limites do parado | 15 e 480 aceitos; 14, 481 e 30,5 = 422 `RN-CORE-26`; corpo com outro campo = 400 | API "faixa 15..480"; unit `paradoMinDasLinhas` |
| A6 | Perfil e tenant | Gerente 403 no GET/PUT do parado e dos alertas; tenant B segue com 60 | API "o parâmetro dos alertas…" |
| A7 | Parâmetro dos alertas | Não guarda o parado (`alertas.produtividade` sem `parado_min`) | unit "o parâmetro dos alertas não guarda o parado"; API |
| A8 | Tela do Início | Dias úteis sem campo do parado nem do almoço | e2e "Início: Dias úteis sem o campo do parado" |

## Defeitos abertos (casos `it.fails` / `test.fail`)
- **D-PAR-05** (baixa, modulo-core, `modules/core/web/components/calendario/almoco-padrao-panel.tsx`): o botão do Almoço diz só "Salvar" (P8: "Salvar almoço", como "Salvar dias úteis" e "Salvar prazo"). Reproduzir: admin em `/parametros/calendario`.
- **D-PAR-04** (alta, engenheiro-apps, `apps/web/lib/ambiente.ts`): o ambiente do BKO não tem `parametros`; o `useParametros` dos painéis de Pesquisa e Treinamento devolve `{}` e a tela mostra sempre o padrão (50 perguntas, nota mínima 70%) mesmo com o tenant em 30 e 80%, que é o que a API aplica. Reproduzir: e2e `D-PAR-04` (tenant com `max_perguntas: 30` em `/v1/me/modulos`; `/parametros/pesquisa` mostra 50). Pronto quando o shell passar ao `ShellProvider` os `modulos[].parametros` de `/v1/me/modulos`.
- **D-PAR-02** (média, modulo-treinamento, `modules/treinamento/web/lib/parametros-valor.ts`): com um valor inválido no cadastro (ex.: `xp_licao: -1`), a API e o app aplicam o padrão em todos os parâmetros; o painel valida chave a chave e mostra "Nota mínima 80%" quando a regra usa 70%. Também `nota_minima_pct: 150` aparece como valor em uso.
- **D-PAR-03** (baixa, modulo-pesquisa, `modules/pesquisa/web/lib/parametros-valor.ts`): fuso inválido no cadastro faz o painel mostrar o padrão de todos os limites; a API troca o fuso pelo do tenant e aplica os limites do cadastro.

## Corrigidos no #457 final (no `main`)
- **N8-PAR-1**: o contador saiu com a `Moldura`; o título é o `titulo` do painel ("Frases do dia"). Casos viraram `it`/`test`.
- **N8-PAR-2**: o painel `medidas` usa `produto.editar_preco`; o gerente consulta ("Você pode consultar", "Nova medida" desligado). Casos viraram `it`/`test`.

## Dependências para rodar o e2e
Shell web do ADR 0060 (`apps/web`, engenheiro-apps: `nav-plataforma-parametros`, `pagina-parametros`, `parametros-secao-*`, `parametros-sem-licenca`, `parametros-conteudo-*`, cadeado) não tem PR v1.0.14; o e2e só passa com ele, com o #457 (painéis `parametros-core-*`) e com `modulos_contratados` no contrato do Core. Os casos unitários dos painéis do Core montam a visão com `menuParametros: true` (o shell web do `main` ainda não liga o menu novo); os de Trade, Pesquisa e Treinamento pulam sozinhos sem o #415, #414 e #416.

## Teste manual
Leitor de tela (NVDA) na entrada com cadeado: anuncia "indisponível" e o balão; teclado (Tab até a entrada, Enter não navega).
