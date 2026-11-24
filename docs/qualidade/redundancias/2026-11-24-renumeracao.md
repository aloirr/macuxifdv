# Corretor-redundancias · renumeração dos RD de 22/11 a 24/11 e lote v1.0.32

- **Data:** 24/11/2026 (horário de Manaus, UTC−4). Pedido do gerente-projetos (sessão F; plano "3 A" do Alexandre, R-20261123 à noite).
- **Base conferida:** `origin/main` a0818b5a5 (#681). Código lido no main; números tirados das mensagens de commit dos branches `nuvem/v1027-*` a `nuvem/v1031-*`, `alexandre/v1027` a `alexandre/v1031`, `alexandre/limpar-cadastros-am2808`, `alexandre/graphify-lembretes` e `alexandre/verificar-retroativa`, e das descrições dos PRs #669 a #681.
- **Releitura (2º commit, 24/11):** `origin/main` 08650397e (#683). Os RD-2693 a RD-2696 já eram do gerente-projetos (lote de documentos: doc 03 e T-0195, cb3e36f3f, corrigidos no #683), e todos os números novos deste relatório andaram +4: RD-2693…2734 → RD-2697…2738. As sobras RD-2739 e RD-2740 entram no lote v1.0.32.
- **Caixa:** `coord caixa corretor-redundancias` respondeu 403 (o repositório de recados não está liberado nesta sessão). Nenhum recado foi lido nem enviado.
- **Resultado:**
  - 36 achados renumerados (RD-2697 a RD-2732) e 6 achados sem número receberam número (RD-2733 a RD-2738);
  - os 4 números do #674 que o gerente já tinha renumerado ficam confirmados, e os RD-2693 a RD-2696 ficam com o gerente-projetos (#683, corrigidos);
  - **17 achados seguem abertos** no main (lote v1.0.32, §4);
  - dos 38 que se esperava encontrar abertos (36 de 22/11, RD-2648 e RD-2659), **24 já estão corrigidos** no código (§3). Os 13 dos 36 que ficaram, o RD-2648 e o RD-2738 (novo, cabeçalho de teste) somam 15; com as sobras RD-2739 e RD-2740, 17.

## 1. Regra da renumeração

1. **O número fica com o primeiro achado que entrou no `main`.** É o mesmo critério do sufixo `a` de 21/11, e o gerente já o usou no #674. Assim, nenhum número citado em código muda. Os números citados em código continuam certos: RD-2639 em `cartao-plano.tsx:170`, RD-2654 e RD-2655 no pré-cadastro, e RD-2678 a RD-2687 no Zerar dados.
2. **O achado repetido ganha um número novo a partir do RD-2697**, o primeiro livre depois do #683 (RD-2693 a RD-2696 são do gerente-projetos). A ordem segue a primeira citação de cada bloco no git. Dentro do bloco, vale a ordem do número antigo.
3. Um número citado em dois commits para o **mesmo** achado continua sendo um achado só. É o caso do RD-2639 da sessão A, no shell (2fa10dadb) e no Core (a03ed95a8).
4. **Número sem citação nenhuma não é inventado.** Os RD-2647 a RD-2649 da sessão A da v1.0.28 não aparecem em commit, então não entram.
5. Quando um commit corrige vários itens sob uma faixa de números sem dizer qual é qual, a linha diz "um dos itens do commit" e lista os itens.

## 2. Tabela antes → depois

Horários de Manaus. "Main" é o PR em que o achado entrou.

| # | Origem (PR, sessão) | Primeira citação | Nº antigo | Nº novo | Gravidade | Status | Dono | Arquivo ou assunto |
|---|---|---|---|---|---|---|---|---|
| 1 | v1.0.27 S19 (#669) | 23/11 08h00 | RD-2639 a RD-2651 | **iguais** | não registrada (RD-2648 baixa) | corrigidos, menos o RD-2648 (aberto) | ver catálogo | diálogos de plano, planos-portal, teste de desempenho, auditoria do retorno do ERP, aspa em comentário |
| 2 | v1.0.28 (#672) | 23/11 12h52 | RD-2652 a RD-2659 | **iguais** | não registrada (RD-2659 baixa) | corrigidos (o RD-2659 fechou no #677, §3) | designer-ux, modulo-core, banco-dados, testes | specs e kit do pré-cadastro, testes do sentinela |
| 3 | Graphify (#674) | 23/11 15h19 | RD-2639 a RD-2642 (corretor) | RD-2660 a RD-2663 (gerente, confirmado) | não registrada | corrigidos (d30b1192f, 52287c38a, b7ed5a3c9) | alexandre (`.claude/hooks/`) | `graphify-mapa.mjs` e o teste |
| 4 | Limpeza (#675) | 23/11 16h17 | RD-2664 a RD-2677 | **iguais** | não registrada | corrigidos (d54d49738, e058523bb, c44baac93, 7cd64434c, dbeb4b657) | engenheiro-software (caminho; commits do alexandre, governança) | `producao-limpar-cadastros.yml`, `scripts/producao/` |
| 5 | v1.0.31 sessão E (#679) | 23/11 20h27 | RD-2678 a RD-2688 | **iguais** | 5 médias, 6 baixas | corrigidos | engenheiro-apps, engenheiro-software, banco-dados, designer-ux | Zerar dados |
| 6 | Governança (#681) | 23/11 21h49 | RD-2689 a RD-2692 | **iguais** | não registrada | corrigidos (eca5c81b3, ae2af5efe) | alexandre (`scripts/coord*`) | `retroativasNoTopo` |
| 6a | Doc 03 e T-0195, gerente-projetos (`agente/v1031-backlog-gerente-projetos`, #683) | 24/11 | RD-2693 a RD-2696 | **iguais** | não registrada | corrigidos (cb3e36f3f; squash 08650397) | gerente-projetos | doc 03 (RN-CORE-16, RN-CORE-59, RN-CORE-78, RN-CORE-79, RN-INT-22) e T-0195 |
| 7 | ERP assistente e painel, designer-ux (`nuvem/v1027-erp-designer-ux`, **fora do main**) | 22/11 07h53 | RD-2639 | **RD-2697** | não registrada | corrigido no branch (7b37892cc) | designer-ux | `docs/design/telas/erp-assistente.md`, cartão 3 da API |
| 8 | idem | 22/11 07h53 | RD-2640 | **RD-2698** | não registrada | corrigido no branch | designer-ux | Teste OK com "Conexão OK." |
| 9 | idem | 22/11 07h53 | RD-2641 | **RD-2699** | não registrada | corrigido no branch | designer-ux | área "Alertas" fora do topo da aba Integração |
| 10 | idem | 22/11 07h53 | RD-2642 | **RD-2700** | não registrada | corrigido no branch | designer-ux | painel em andamento |
| 11 | idem | 22/11 07h53 | RD-2643 | **RD-2701** | não registrada | corrigido no branch | designer-ux | painel concluído |
| 12 | idem | 22/11 07h53 | RD-2644 | **RD-2702** | não registrada | corrigido no branch | designer-ux | ERP pelo Conector |
| 13 | v1.0.28 sessão A (Campo; no main pelo #672) | 23/11 11h30 | RD-2639 | **RD-2703** | não registrada | corrigido (2fa10dadb, a03ed95a8) | engenheiro-apps · modulo-core | rota do pré-cadastro no shell × `moduloApp` do Core |
| 14 | idem | 23/11 11h40 | RD-2640 | **RD-2704** | não registrada | corrigido (a03ed95a8) | modulo-core | 4ª rodada do pré-cadastro (um dos itens) |
| 15 | idem | 23/11 11h40 | RD-2641 | **RD-2705** | não registrada | corrigido (a03ed95a8) | modulo-core | idem |
| 16 | idem | 23/11 11h40 | RD-2642 | **RD-2706** | não registrada | corrigido (a03ed95a8) | modulo-core | idem |
| 17 | idem | 23/11 11h40 | RD-2643 | **RD-2707** | não registrada | corrigido (a03ed95a8) | modulo-core | idem |
| 18 | idem | 23/11 11h40 | RD-2644 | **RD-2708** | não registrada | corrigido (a03ed95a8) | modulo-core | idem |
| 19 | idem | 23/11 11h30 | RD-2645 | **RD-2709** | não registrada | corrigido (6f2efab07) | designer-ux | spec do pré-cadastro do Campo, 2ª rodada |
| 20 | idem | 23/11 11h40 | RD-2646 | **RD-2710** | não registrada | corrigido (a03ed95a8) | modulo-core | 4ª rodada (um dos itens) |
| 21 | idem | 23/11 11h56 | RD-2650 | **RD-2711** | não registrada | corrigido (1eab1983e) | designer-ux | selo "Não enviado" |
| 22 | idem | 23/11 11h56 | RD-2651 | **RD-2712** | não registrada | corrigido (1eab1983e) | designer-ux | frase do motivo na spec §5 |
| 23 | v1.0.30 sessão D (telas; no main pelo #677) | 23/11 17h34 | RD-2660 | **RD-2713** | não registrada | corrigido (273478272, 272d1d536) | designer-ux · modulo-core | Código FDV no corpo e no cabeçalho da correção |
| 24 | idem | 23/11 17h34 | RD-2661 | **RD-2714** | não registrada | corrigido (273478272) | designer-ux | specs do pré-cadastro (um dos itens) |
| 25 | idem | 23/11 17h34 | RD-2662 | **RD-2715** | não registrada | corrigido (273478272) | designer-ux | idem |
| 26 | idem | 23/11 17h45 | RD-2663 | **RD-2716** | não registrada | corrigido (272d1d536) | modulo-core | formulário do pré-cadastro copiado no app e no BKO (um dos itens) |
| 27 | idem | 23/11 17h45 | RD-2664 | **RD-2717** | não registrada | corrigido (272d1d536) | modulo-core | idem |
| 28 | idem | 23/11 17h45 | RD-2665 | **RD-2718** | não registrada | corrigido (272d1d536) | modulo-core | idem |
| 29 | idem | 23/11 17h57 | RD-2666 | **RD-2719** | não registrada | corrigido (55e8411ec, 764d3de9d) | designer-ux · modulo-core | rótulo da busca dos recusados |
| 30 | idem | 23/11 17h57 | RD-2667 | **RD-2720** | não registrada | corrigido (55e8411ec) | designer-ux | reexports do `@macuxi/ui/web` (máscara) |
| 31 | v1.0.30 sessão C (contratos, API, Hub, fila; no main pelo #677) | 23/11 18h16 | RD-2660 | **RD-2721** | não registrada | corrigido (5b122e9d1) | modulo-core | fixos do cadastro em 3 lugares |
| 32 | idem | 23/11 18h16 | RD-2661 | **RD-2722** | não registrada | corrigido (5b122e9d1) | modulo-core | exports sem uso; `CODIGO_FDV_SOMENTE_LEITURA` repetido |
| 33 | idem | 23/11 18h16 | RD-2662 | **RD-2723** | não registrada | corrigido (5b122e9d1) | modulo-core | colunas e SELECT do pré-cadastro copiados |
| 34 | idem | 23/11 18h16 | RD-2663 | **RD-2724** | não registrada | corrigido (5b122e9d1) | modulo-core | respostas do push copiadas nos receptores |
| 35 | idem | 23/11 17h51 | RD-2664 | **RD-2725** | não registrada | corrigido (c7f374102) | modulo-integracao | Hub: limites, Código FDV, máscara dos erros, guia (um dos itens) |
| 36 | idem | 23/11 17h51 | RD-2665 | **RD-2726** | não registrada | corrigido (c7f374102) | modulo-integracao | idem |
| 37 | idem | 23/11 17h51 | RD-2666 | **RD-2727** | não registrada | corrigido (f41c891ff) | engenheiro-software | filtro da outbox aberta 4× |
| 38 | idem | 23/11 18h28 | RD-2667 | **RD-2728** | não registrada | corrigido (03d17b235, 86b00b77e) | modulo-integracao · modulo-core | limites do erro por campo copiados do contrato do core |
| 39 | idem | 23/11 18h29 | RD-2668 | **RD-2729** | não registrada | corrigido (86b00b77e) | modulo-core | "cliente não encontrado" no push 2× |
| 40 | idem | 23/11 18h41 | RD-2669 | **RD-2730** | não registrada | corrigido (8d1c50ef9) | testes | coletor de log e dígitos do CNPJ/CPF copiados nos testes |
| 41 | idem | 23/11 18h41 | RD-2670 | **RD-2731** | baixa (comentário e título) | corrigido (já estava em dia no 8d1c50ef9) | testes | caso de carteira |
| 42 | idem | 23/11 18h49 | RD-2671 | **RD-2732** | baixa (comentário) | corrigido (e9b497f31) | modulo-core | comentário repetido na substituição do pré-cadastro |
| 43 | v1.0.30 sessão D, achados baixos só de teste | 23/11 18h42 | sem número | **RD-2733** | baixa | corrigido (a3fdace30) | testes | `pre-cadastro-bko-v1030.test.ts`: contador e filtros da URL |
| 44 | idem | 23/11 18h42 | sem número | **RD-2734** | baixa | corrigido (a3fdace30) | testes | idem: perfis das ações no manifesto |
| 45 | idem | 23/11 18h42 | sem número | **RD-2735** | baixa | corrigido (a3fdace30) | testes | idem: painel com 7 linhas e travados |
| 46 | idem | 23/11 18h42 | sem número | **RD-2736** | baixa | corrigido (a3fdace30) | testes | idem: licença `MODULO_INATIVO` no caso de perfil errado |
| 47 | Junção do #677 (C × D) | 23/11 19h17 | sem número | **RD-2737** | baixa | corrigido (a7d8e364a) | testes | casos repetidos entre o teste de revisão (C) e o do BKO (D) |
| 48 | Cabeçalho do teste do BKO (#677) | 24/11 (este reteste) | sem número | **RD-2738** | baixa (comentário de teste) | **aberto** | testes | `tests/integracao/api/pre-cadastro-bko-v1030.test.ts:9` |
| 49 | Sobra do pré-cadastro (main 08650397) | 24/11 (2º commit) | sem número | **RD-2739** | baixa (comentário em código de produção) | **aberto** | modulo-core | `modules/core/domain/cadastro.ts:57` |
| 50 | Sobra do pré-cadastro (main 08650397) | 24/11 (2º commit) | sem número | **RD-2740** | baixa (doc) | **aberto** | designer-ux | `docs/design/telas/pre-cadastro-campos.md:10` |

**Contagem:** 36 renumerados (linhas 7 a 42), 6 numerados pela primeira vez (linhas 43 a 48), 2 sobras numeradas no 2º commit (linhas 49 e 50), 4 confirmados da renumeração do gerente (linha 3) e 4 do gerente-projetos no #683 (linha 6a).

### 2.1 Achados sem RD, corrigidos e só registrados pelo commit

Nestes casos, o commit diz "achado do corretor" ou dá um número provisório, mas não diz quantos achados eram. Por isso não ganham número. Todos estão corrigidos no main.
- v1.0.28, sessão B:
  - `RD-p02`: designer-ux, 2224152c1, rótulos e mensagens apontam para os mapas do contrato;
  - `RD-p10`: banco-dados, 8cd80af20, o teste da 0095 confere só a 0095;
  - `N1` a `N4`: engenheiro-software, ab43c9a8c, ADR 0067;
  - ainda: bdff76581 e ec1d8e793 (designer-ux), d34839632, 7d3655992 e 00013c5f0 (modulo-core) e 1de86a76c (engenheiro-software).
- #674: além dos 4 itens do RD-2660 ao RD-2663, o 52287c38a e o b7ed5a3c9 citam correções do engenheiro e do corretor juntas.

## 3. Dos 38 esperados abertos, 24 estão corrigidos no main a0818b5a

| RD | Evidência no main |
|---|---|
| RD-0039 | `SheetButton` e `PdfOption` não existem mais em `modules/vendedor/app`: a busca não acha nenhum dos dois, e as folhas usam o `Folha` do kit. |
| RD-0044 | `core/web/lib/farol.ts:5,160` e `plano-rv.ts:6,278` usam `celulaCsv` do `@macuxi/comum/csv`, que protege a fórmula. |
| RD-0263 | `BOTAO_EDITAR` (`packages/ui/src/mobile/botao-editar.ts:12-20`) tem só `linha`, `tabela` e `tons`. Os campos da raiz saíram. |
| RD-0266 | `CHAVES` saiu. `core/api/parametros-curvas-abc.ts:15,22,49,54` usa `CHAVE_DA_DIMENSAO`. |
| RD-0269 | Não há mais `pesquisaDisponivelNoCliente` nem `disponivel` em `modules/pesquisa/app`. |
| RD-0300 | Na empresa existente fica só o cartão "Módulos licenciados", com as caixas que faltam (`passo-empresa-legado.tsx:272-288`, RD-2613). "Módulos e licenças" aparece só na empresa nova (`:334`). |
| RD-0301 | Na empresa existente saíram os painéis Empresa e Administrador (`passo-empresa-legado.tsx:272-288`). |
| RD-0302 | `apps/web/lib/portal-admins.ts:18-24`: a ajuda saiu, o diálogo diz só o destino e o efeito, e a validade fica só no selo (`:76`). |
| RD-0303 | `apps/web/lib/equipe-csv.ts` saiu com o fim do CSV na v1.0.24. Fica só o `semEmail` de `portal-admins.ts:29`. |
| RD-0304 | `tela-empresa.tsx:105` diz "Empresa não encontrada." e `portal-admins.ts:32` diz "Empresa não encontrada ou inativa.", sem o "Volte à lista". |
| RD-0305 | `tela-diagnosticos.tsx:109-115`: a contagem só aparece com 1 ou mais. |
| RD-0306 | `portal-diagnosticos.ts` não tem mais "Enviados pelos aparelhos.". |
| RD-0315 | Não reproduz: "Perfil base" aparece uma vez, na Identificação (`modules/core/web/components/perfis/perfis-page.tsx:464`), sem frase de seção repetida. O detalhe original estava só no recado do #250. |
| RD-0316 | `docs/modulos/core/prints/checkin/gerar.mjs:1` diz só "uso e cenários no README.md". |
| RD-0318 | O 481cf8f36 (14/11) tirou `.btn.d` e `.uso td.lim` de `docs/design/telas/portal-config-enxuto/portal.css`. |
| RD-0319 | `tela-inicio-campo.tsx:50` tem um só `Pressionavel` acessível ("Abrir perfil"). Os de `:57` e `:64` estão com `accessible={false}`. |
| RD-0320 | `catalogo/manifest.ts:20` e `contracts/extensoes.ts:4-5` dizem "Adicionar ao orçamento". |
| RD-0322 | `core/domain/performance-cliente.ts:55-58` não tem mais a frase. |
| RD-1218 | `camposDeFilial` de `tests/integracao/apoio/filial-usuario` nos dois testes (`ciclo-senha-t0094.test.ts:55`, `portal-email-senha-t0093.test.ts:34`). |
| RD-1988 | `modules/gestor/web/index.ts:29-30`: `paineisParametros` com `RegrasEquipePanel`, sem `PageHeader` próprio. |
| RD-1989a | `core/web/components/plano-rv/plano-rv-page.tsx:503-504`: o `PageHeader` só tem o título "Plano de RV", sem subtítulo. |
| RD-1989b | Não há rota `/regras-alerta`. "regras-alerta" é só o id do painel (`gestor/web/index.ts:30`). |
| RD-2485 | `docs/modulos/catalogo/regras.md:179` aponta a RN-CAT-17 sem copiar o texto, e não diz mais "casa-tudo" para o código exato. |
| RD-2659 | No #677 (7eaf9ab37 e 2037c4a7b): `core/domain/pre-cadastro-campos.test.ts` não tem mais o caso do sentinela, que fica só em `app/lib/pre-cadastro-local.test.ts:87`. O par de reenvio do c460e92c (`:112` × `:141`) foi refeito no comportamento da revisão (`:116`, `:146`). |

## 4. Lote v1.0.32: 17 abertos, por dono

O critério de "segura" é o de sempre (R-20261111-190159): achado de gravidade baixa que esteja **só em comentário ou título de teste** não segura o lote.

### engenheiro-apps (5)
| RD | Grav. | Onde (main a0818b5a) | Proposta (antes → depois) | Segura |
|---|---|---|---|---|
| RD-0274 | baixa | `apps/web/components/portal/base.tsx:216` e `baixar-conector.tsx:18`: `const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', …)` 2× | Tirar as duas e usar `formatTime(iso, fuso)` de `@macuxi/ui/web` (`packages/ui/src/web/format.ts:67`) em `base.tsx:273` e `baixar-conector.tsx:64` | sim |
| RD-0281 | média | `passo-empresa-legado.tsx:327`: "Datas e horários do app e do BKO aparecem neste fuso." (empresa nova, servidor sem planos) | A linha sai. O rótulo "Fuso" basta. Com designer-ux | sim |
| RD-0284 | média | `passo-empresa-legado.tsx:371-374`: "Conferido, nada gravado: … ao gravar." + "Módulos que entram: …" + "Parâmetros que serão gravados: N." + administrador | Uma linha só: `Conferido: a empresa será criada.` · `Conferido: entram Vendedor, Promotor.` · `Conferido: nada muda.`, mais os `avisos`. Saem a linha dos parâmetros e a do administrador. Com designer-ux | sim |
| RD-0299 | média | `apps/web/lib/conector-download.ts:71` "o pacote será publicado aqui em breve." × `:82` "em breve." para o mesmo estado | Um texto só, numa constante como `GERANDO` e `ESPERA` (`:63-64`): `const EM_BREVE = 'em breve.'`, usado no Conector e nos apps. Com designer-ux | sim |
| RD-2648 | baixa | `passo-empresa-legado.tsx:13` (comentário): `"Módulos licenciados (o cabeçalho …` abre a aspa e não fecha | `"Módulos licenciados" (o cabeçalho já mostra a empresa …` | não (só comentário) |

### modulo-core (4, e a parte do Core no RD-0051)
| RD | Grav. | Onde | Proposta | Segura |
|---|---|---|---|---|
| RD-2739 | baixa | `modules/core/domain/cadastro.ts:57` (comentário): "lista efetiva do tenant a partir do parâmetro `cliente_campos_obrigatorios`", nome antigo | Trocar pelo nome atual: "a partir do parâmetro `cliente.campos_obrigatorios`" | sim (comentário em código de produção) |
| RD-0042 | baixa | `modules/core/api/hoje-fuso.db.test.ts:26` e `visita.db.test.ts:28`: `const somarDias = …` local 2× | Importar `somarDiasCivis` de `@macuxi/comum/relogio` (`packages/comum/src/relogio.ts:107`) e apagar as duas cópias | sim (corpo de teste) |
| RD-0268 | baixa | `modules/core/domain/curvas-abc.ts:51-55` (`DIMENSOES[].nome`) × `:112` `ROTULOS_DIMENSAO_CURVA`: "Faturamento", "Volume" e "Frequência" 2× | Tirar o `nome` de `DIMENSOES` e montar o rótulo em `:89` com `` `${ROTULOS_DIMENSAO_CURVA[d.dimensao]} ${curva}` `` | sim |
| RD-1278 | baixa | `modules/core/domain/erp-mapeamento.ts:23`: `` `erp-${hex}@sem-email.invalid` `` à mão | `` `erp-${hex}${SUFIXO_EMAIL_PROVISORIO}` ``, com o import de `./vinculo-erp` (`:12`) | sim (código de produção) |

### testes (4)
| RD | Grav. | Onde | Proposta | Segura |
|---|---|---|---|---|
| RD-0317 | baixa | `tests/modulos/desvios-spec-v106.test.ts:141`: `expect(CARTAO_GRADE.startsWith('export function CartaoGrade')).toBe(true)` vale pelo próprio recorte | Tirar a linha `:141` | não (só teste, veredito de 14/11) |
| RD-1266 | baixa | `tests/integracao/api/filial-usuario-t0176.test.ts:252` e `:418`: "o pull só entrega o que é anterior ao horizonte" 2× em comentário | O motivo fica só no JSDoc de `esperarHorizonte` (`tests/integracao/apoio/campo.ts:261`). As linhas ficam `// o destravar do caso anterior tocou o updated_at` e `// o deixarSemFilial tocou o updated_at` | não (comentário de teste) |
| RD-1275 | baixa | `tests/modulos/meta-de-hoje-rd0001-t0124.test.ts:41` e `t0140-faixa-pdf.test.ts:28`: o mesmo comentário "fonte do sistema v1.0.13: …" 2× | O comentário fica uma vez, no mock comum se houver. Senão, um dos dois remete ao outro: `// fontes: ver meta-de-hoje-rd0001-t0124.test.ts` | não (comentário de teste) |
| RD-2738 | baixa | `tests/integracao/api/pre-cadastro-bko-v1030.test.ts:9`: "Perfil errado (403) e outro tenant (RLS: não vê, 404)." O caso do outro tenant saiu do arquivo no a7d8e364a (RD-2737) e ficou no `pre-cadastro-revisao-v1030.test.ts` | ` * Perfil errado nos Parâmetros (403); perfil e outro tenant das rotas do pré-cadastro: pre-cadastro-revisao-v1030.test.ts.` | não (comentário de teste) |

### modulo-vendedor (1)
| RD | Grav. | Onde | Proposta | Segura |
|---|---|---|---|---|
| RD-0321 | baixa | `modules/vendedor/app/lib/cards-pedidos.ts:20`, `screens/orders-screen.tsx:183` e `lib/cards-pedidos.test.ts:33` citam "RD-0263", que no catálogo é outro achado | Trocar por `RD-0307` nos 3 lugares | não (comentário e título de teste) |

### designer-ux (2)
| RD | Grav. | Onde | Proposta | Segura |
|---|---|---|---|---|
| RD-2740 | baixa | `docs/design/telas/pre-cadastro-campos.md:10` (e o cabeçalho `:5`): cita a chave própria `cliente.pre_cadastro.obrigatorios`, que hoje é só o espelho legado da lista única (`modules/core/domain/pre-cadastro-campos.ts:88`), e o nome antigo `cliente_campos_obrigatorios` | Citar a chave atual: "lista `cliente.campos_obrigatorios` (RN-CORE-16), da qual sai o pré-cadastro (RN-CORE-79); `cliente.pre_cadastro.obrigatorios` é só o espelho para o APK v1.0.28". Ou retirar a chave antiga do texto | sim (doc) |
| RD-2572b | baixa | `packages/ui/src/comum/contraste.test.ts:61`: o laço `toBeGreaterThanOrEqual(MINIMO_CONTRASTE.grafico)` repete o `toEqual(['3,75:1', '3,47:1', '3,22:1'])` de `:60` | Tirar a linha `:61` | não (só teste) |

### Vários donos: RD-0051 (célula de CSV, média)
- **O que já foi corrigido:** o BOM. Todos os CSVs usam `BOM_CSV` do `@macuxi/comum/csv`, e não sobrou nenhum `﻿` fora de teste.
- **O que falta:** a célula. Ela está reescrita em 13 arquivos:
  - **modulo-core:** `const aspas = (v) => …` 6× (`core/web/lib/aparelhos.ts:7`, `carteira.ts:8`, `indicadores.ts:9`, `licencas.ts:59`, `metas.ts:13`, `visitas.ts:8`). Proposta: trocar por `celulaCsv` do comum, que também põe aspas sempre e ainda protege a fórmula.
  - **engenheiro-software:** criar `celulaCsvCompacta(v)` em `packages/comum/src/csv.ts`: aspas só com `;`, `"` ou quebra, e com `protegerFormula`.
  - **Donos das células "compactas"**, que passam a usar a função nova: modulo-catalogo (`web/lib/marcas.ts:37`, `tabelas-preco.ts:129`, `formularios.ts:160`), modulo-gestor (`web/lib/csv.ts:8`), modulo-promotor (`web/lib/csv.ts:7`), modulo-integracao (`web/lib/csv.ts:18`), modulo-treinamento (`web/lib/csv.ts:13`, hoje sem proteger fórmula "de propósito") e modulo-pesquisa (`domain/exportacao.ts:18`).
- **Segura:** sim.

### Resumo por dono
| Dono | Abertos | Seguram |
|---|---|---|
| engenheiro-apps | RD-0274, RD-0281, RD-0284, RD-0299, RD-2648 | 4 |
| modulo-core | RD-0042, RD-0268, RD-1278, RD-2739 (e a parte do Core no RD-0051) | 4 |
| testes | RD-0317, RD-1266, RD-1275, RD-2738 | 0 |
| modulo-vendedor | RD-0321 | 0 |
| designer-ux | RD-2572b, RD-2740 (e é coautor do RD-0281, do RD-0284 e do RD-0299) | 1 |
| vários (RD-0051) | engenheiro-software, modulo-core, modulo-catalogo, modulo-gestor, modulo-promotor, modulo-integracao, modulo-treinamento, modulo-pesquisa | 1 |
| **Total** | **17** | **10** |

## 5. Encaminhar ao testes (defeito funcional, sem RD)
- Os 6 CSVs do Core com `aspas` local (§4, RD-0051) **não protegem fórmula** (CWE-1236): aparelhos, carteira, indicadores, licenças, metas e visitas. O assunto já foi encaminhado em 09/11 (R-20261109-125233) e segue no main 08650397 (`const aspas` em `aparelhos.ts:7`, `carteira.ts:8`, `indicadores.ts:9`, `licencas.ts:59`, `metas.ts:13` e `visitas.ts:8`, todos em `modules/core/web/lib/`). O recado fica para a próxima ronda, porque esta tarefa não envia recado.

## 6. Observação sem número (para a próxima rodada, com print)
- `core/web/components/plano-rv/plano-rv-page.tsx:437`: "Plano salvo. A RV já usa os novos parâmetros." A 2ª frase conta o que o sistema faz por trás (R-20261110-192153). Candidato a `Plano salvo.`

## 7. Premissas
- O que não está em relatório foi tirado das mensagens de commit. Não houve relatório do corretor para a v1.0.27, a v1.0.28 nem a v1.0.30.
- **Ordem dos itens:** quando o commit lista os itens sem número, sigo a ordem do commit.
  - RD-2660 a RD-2663 do #674, nos commits d30b1192f, 52287c38a e b7ed5a3c9.
  - RD-2664 a RD-2669 do #675, na lista "Corretor:" do d54d49738. São 5 itens para 6 números, e "saída e resumo" conta como 2.
- **Sessão D:** o pedido citava só os 4 achados baixos de teste. Os commits mostram que ela também usou RD-2660 a RD-2667 (designer-ux e Core nas telas), e esses números entram como repetidos.
- **RD-2733 a RD-2736:** reconstruídos pelos 4 blocos que o a3fdace30 tirou do teste.
- **RD-2648:** a única aspa aberta em comentário que a v1.0.27 trouxe, e o 98c9ef55b é o commit do S19 que a pôs. É o achado.
- **Bloco do designer-ux de 22/11 (RD-2697 a RD-2702):** está num branch sem PR. Recebe número porque foi o primeiro uso do RD-2639, mas a correção vale só quando a spec entrar no main.
