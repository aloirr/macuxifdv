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

## Parecer v1.0.32 (sessão G)

- **Data:** 24/11/2026 (horário de Manaus). Pedido do gerente-projetos (decisão "3 A", R-20261123-190212-alexandre e R-20261123-222635-alexandre).
- **Bases:** `origin/main` 0865039 para os 6 primeiros branches e d2f2438 para os branches de CSV dos módulos. Diffs com `git diff <base>..<sha>`. Grep final das células de CSV no `main` 0865039, comparado com cada branch.
- **Critério:** nenhum achado aberto, de qualquer gravidade (R-20261110-062506). A exceção (R-20261111-190159) vale só para comentário ou título de teste de gravidade baixa. Corpo de teste repetido também segura. O veredito é de cada branch. O resíduo achado fora dos branches ganha número e segura o lote do dono.
- **Graphify:** 2 consultas (`query` das células de CSV e `affected "protegerFormula"`).

### Veredito por branch

| Branch | SHA | Veredito | Achados do §4 | Achados novos ou reabertos |
|---|---|---|---|---|
| `nuvem/v1032-portal-engenheiro-apps` | 72c92bf | **NÃO LIBERADO** | RD-0274, RD-0281, RD-0299 e RD-2648 corrigidos. RD-0284 corrigido no Conferir | RD-0284 (resta o resultado gravado), RD-2742 |
| `nuvem/v1032-core-modulo-core` | e372cf8 | **NÃO LIBERADO** | RD-0042, RD-0268, RD-1278, RD-2739 e a parte do Core no RD-0051 corrigidos. O `codigo_fdv` no `CustomerSummary` e na busca do editor de rota está sem repetição | RD-2744 |
| `nuvem/v1032-comentarios-testes` | e67a0bb | **LIBERADO** | RD-0317, RD-1266, RD-1275 e RD-2738 corrigidos. O motivo do horizonte fica só no JSDoc de `esperarHorizonte` (`tests/integracao/apoio/campo.ts:261`) | nenhum |
| `nuvem/v1032-comentarios-modulo-vendedor` | 26e05c1 | **LIBERADO** | RD-0321 corrigido. Não sobra "RD-0263" em `modules/vendedor` | nenhum no diff (o RD-2741 e o RD-2747 do vendedor vão num branch novo do lote de CSV) |
| `nuvem/v1032-ux-designer-ux` | 509ec65 | **LIBERADO** | RD-2572b e RD-2740 corrigidos. A spec não cita mais `cliente_campos_obrigatorios` | nenhum no diff (o RD-2743 é novo e vai num commit novo) |
| `nuvem/v1032-csv-engenheiro-software` | d2f2438 | **NÃO LIBERADO** | `celulaCsvCompacta` criada | RD-2741 (o comum não aceita número nem nulo), RD-2745 |
| `nuvem/v1032-csv-modulo-catalogo` | c5d88a9 | **NÃO LIBERADO** | células locais saíram de `marcas.ts`, `tabelas-preco.ts` e `formularios.ts` | RD-2741 |
| `nuvem/v1032-csv-modulo-gestor` | 5420e21 | **NÃO LIBERADO** | célula local saiu | RD-2741 |
| `nuvem/v1032-csv-modulo-promotor` | 41e16fa | **NÃO LIBERADO** | célula local saiu | RD-2741, RD-2747 (o `CSV_BOM` ficou) |
| `nuvem/v1032-csv-modulo-integracao` | 6bc880a | **NÃO LIBERADO** | `csvCell` saiu | RD-2741, RD-2747, RD-2748 |
| `nuvem/v1032-csv-modulo-treinamento` | f19fe03 | **NÃO LIBERADO** | `csvCell` local saiu, e a fórmula passou a ser protegida | RD-2741 |
| `nuvem/v1032-csv-modulo-pesquisa` | 3ebfd15 (99e2d6b + 3ebfd15) | **LIBERADO** | a célula local e o apelido `celulaCsv` saíram. Só entra texto, com `map(celulaCsvCompacta)` direto. O teste passa pela exportação (`exportacao.test.ts:68`) | nenhum |
| `nuvem/v1032-csv-testes` | e62cea1 | **NÃO LIBERADO** | o t0140 importa do comum | RD-2746 |

**RD-0051:** segue **aberto** até o RD-2741, o RD-2747 e o RD-2748 fecharem. Hoje há dois formatos de célula, cada um por um motivo: `celulaCsv` (aspas sempre: os 6 do Core, `farol.ts`, `plano-rv.ts`, `catalogo/domain/fotos-lote.ts`, `catalogo/web/exportacao/excel.ts` e o vendedor) e `celulaCsvCompacta` (os demais). Isso não é repetição: são dois formatos de saída que já existiam, e cada um tem uma função só no comum.

### Achados novos e reabertos

| RD | Grav. | Tipo | Onde (SHA) | O que se repete | Proposta (antes → depois) | Dono | Segura |
|---|---|---|---|---|---|---|---|
| RD-0284 (reaberto em parte) | média | texto | `apps/web/components/portal/passo-empresa-legado.tsx:394-395` (72c92bf), no resultado gravado | Depois de gravar ficam `Parâmetros gravados: N.` e `Administrador criado: <e-mail>.` / `Administrador mantido: a senha não mudou.`. O "N" não serve para decidir, e o e-mail é o que está digitado logo acima (proposta original de 14/11, `2026-11-14-portal-config.md`, RD-0284) | Gravado: `Empresa criada.` + `Módulos que entraram: Vendedor, Promotor.` (só com 1 ou mais) + `avisos`. Saem a linha dos parâmetros e a do administrador, e com ela o `textoDoAdminNoResultado` e o teste dele (`apps/web/lib/portal-telas.test.ts:74-78`) | engenheiro-apps · designer-ux | sim |
| RD-2742 | baixa | código | `passo-empresa-legado.tsx:138` × `:387` (72c92bf) | `r.modulos_adicionados.filter((m) => !ehModuloSempre(m))` 2× no mesmo arquivo. A moldura `<div data-testid="empresa.resultado"><Notice><span …>` + `r.avisos.map(…)` 2× (`:372-384` × `:389-401`) | Um `ResultadoEmpresa` só: `const entram = modulosNaLista(r.modulos_adicionados)` (uma função, usada também em `textoDaConferencia`), `tone={r.simulado ? 'info' : 'success'}`, `<strong>{r.simulado ? textoDaConferencia(r) : ROTULO_RESULTADO[r.resultado] + '.'}</strong>`, a linha dos módulos só quando `!r.simulado`, e os `avisos` uma vez | engenheiro-apps | sim (código de produção) |
| RD-2743 | baixa | doc | `docs/design/portal-entrar.md:139-140` (72c92bf e main) | A spec ainda manda mostrar no Conferir **"Administrador que será criado: <e-mail>."** e **"Administrador mantido: a senha não muda."**. O código saiu delas pelo RD-0284 | `No Conferir: uma linha só ("Conferido: a empresa será criada." · "Conferido: entram <módulos>." · "Conferido: nada muda.") e os avisos, sem o administrador (RD-0284).` Se o RD-0284 do gravado fechar, a linha do "Resultado" também sai | designer-ux | sim (doc) |
| RD-2744 | baixa | teste | `modules/core/web/lib/csv-saida.test.ts:99-120` (e372cf8) | O caso novo "CWE-1236 … nos 6 CSVs" confere `"'=SOMA(A1)"` nos 6 CSVs, e as fotos byte a byte logo acima (`:22-97`) já mostram a mesma célula protegida em cada um | Tirar o caso `:99-120`. A intenção fica no título do `describe` (`:21`): `'RD-0044/RD-0051: saída dos CSVs do core pelo comum (fórmula protegida, CWE-1236)'` | modulo-core | sim (corpo de teste) |
| RD-2741 | média | código | adaptador da célula (nulo → `''`, número sem proteção, texto pelo comum) reescrito 8×: `modules/gestor/web/lib/csv.ts:9-12` (5420e21), `modules/promotor/web/lib/csv.ts:8-11` (41e16fa), `modules/integracao/web/lib/csv.ts:19` (6bc880a), `modules/treinamento/web/lib/csv.ts:11-12` (f19fe03), `modules/catalogo/web/lib/marcas.ts:40`, `tabelas-preco.ts:129` e `formularios.ts:164` (c5d88a9, `String(v ?? '')`), e `modules/vendedor/web/lib/csv.ts:13` (main, com `celulaCsv`) | A mesma regra ("número negativo não é fórmula") está escrita em 4 comentários diferentes (gestor `:8`, promotor `:7`, integração `:14-16`, treinamento `:9`). O catálogo diverge: com `String(v ?? '')`, o número passa pela proteção | **engenheiro-software:** `celulaCsvCompacta(v: string \| number \| null \| undefined)` e `celulaCsv` com a mesma assinatura: nulo → `''` (e `""` no `celulaCsv`); número → `String(v).replace('.', ',')`, sem proteção; texto como hoje. Uma linha no JSDoc do comum: "número não passa pela proteção: `-5` continua número". **Donos dos módulos:** `r.map(celulaCsvCompacta)` direto, e saem os adaptadores e os comentários. O gestor mantém só o arredondamento (`Math.round(v * 100) / 100` antes da célula) | engenheiro-software · modulo-catalogo · modulo-gestor · modulo-promotor · modulo-integracao · modulo-treinamento · modulo-vendedor | sim |
| RD-2745 | baixa | teste | `packages/comum/src/csv.test.ts:42-44` (d2f2438) | `it.each(['=SOMA(A1)', '+1', '-2', '@x', '\tA'])` da `celulaCsvCompacta` repete 5 dos 6 valores do `protegerFormula` (`:5-7`). Que a compacta chama a proteção já se vê em `:50-53` (`'=A;B'` e `'=HYPERLINK("x")'`) | Tirar o `it.each` de `:42-44`. Ficam o caso do CR (`:46-48`) e o "apóstrofo antes das aspas" | engenheiro-software | sim (corpo de teste) |
| RD-2746 | baixa | teste | `tests/modulos/t0140-csv-pesquisa-formula.test.ts:19-32` (e62cea1) | O arquivo não toca mais a Pesquisa. O P1 (`=1+1`, `+1+1`, `@SOMA(A1)`, `-A1`, tabulação) e o P3 (texto comum fica igual) repetem o `packages/comum/src/csv.test.ts`. O título diz "CSV da Pesquisa", e quem testa a Pesquisa é o `modules/pesquisa/domain/exportacao.test.ts:68` (3ebfd15) | O P1, o P2 e o P3 passam a chamar `exportarRespostasCsv` com uma resposta de texto (o valor do lote 03), que é o que o T-0140 quer garantir. Ou: o P2 (`-1+1`, `-1-1`, `- 1+1`, `-.5+1`, `-,5+1`) vai para o `it.each` do `protegerFormula` no comum, e o arquivo sai, com a nota na matriz `docs/testes/T-0140.md` | testes (com o engenheiro-software, se o P2 for para o comum) | sim (corpo de teste) |
| RD-2747 | baixa | código | `export const CSV_BOM = BOM_CSV;` 3×: `modules/promotor/web/lib/csv.ts:5` (41e16fa), `modules/integracao/web/lib/csv.ts:10` (6bc880a) e `modules/vendedor/web/lib/csv.ts:9` (main) | Dois nomes para a mesma constante do comum. Fora do próprio arquivo, só os testes usam (`promotor/web/lib/web.test.ts:4,45`, `integracao/web/lib/csv.test.ts:3,5,13`, `vendedor/web/lib/csv.test.ts:3,36,42,52`) | `CSV_BOM` sai. O código e os testes importam `BOM_CSV` de `@macuxi/comum/csv`. O `expect(CSV_BOM).toBe('﻿')` do vendedor (`:36`) sai, porque já está no comum (`csv.test.ts:24`) | modulo-promotor · modulo-integracao · modulo-vendedor | sim |
| RD-2748 | baixa | código | `modules/integracao/kit-thathyany/lib/modelos-csv.ts:401-403` (`function celulaCsv`) e `kit-thathyany/scripts/migrar-csv-1.0.5.ts:35` (`const celula`), no main 0865039 | A mesma célula 2× no kit. A da lib tem o nome da `celulaCsv` do comum, que tem outro comportamento (aspas sempre e fórmula protegida) | Uma célula só no kit, exportada de `lib/modelos-csv.ts` como `celulaDoModelo` e importada pelo `migrar-csv-1.0.5.ts`, sem proteger fórmula, porque o arquivo vai para o importador e o apóstrofo viraria dado. JSDoc: `/** Sem protegerFormula: o arquivo vai para o importador, não para o Excel. */` | modulo-integracao | sim (código do kit) |
| RD-2749 | baixa | código | `apps/mock-api/src/services/goals.ts:325-326` (main 0865039) | `const esc = …replace(/"/g, '""')…` e o BOM literal. É a última célula de CSV à mão fora do kit, e o pacote já depende de `@macuxi/comum` | `import { BOM_CSV, celulaCsvCompacta } from '@macuxi/comum/csv';` e `return BOM_CSV + [head, ...lines].map((r) => r.map(celulaCsvCompacta).join(';')).join('\r\n') + '\r\n';` | engenheiro-software | sim |

**Grep final** (`replace(/"/g, '""')` e afins, sem `.md`), no `main` 0865039 menos o que os branches tiram. Sobram:
- `packages/comum/src/csv.ts`, com as duas funções do comum;
- o kit da integração (RD-2748);
- o `apps/mock-api` (RD-2749);
- `packages/platform-sdk/src/busca.ts:81`, que põe aspas no termo da busca textual (não é CSV);
- `packages/platform-sdk/src/sqlite/armazenamento.ts:705`, um identificador SQL (não é CSV).

O §4 dizia que não sobrava nenhum BOM literal fora de teste. O `goals.ts:326` desmente isso, e o RD-2749 corrige.

### Encaminhar ao testes (defeito funcional ou mudança de comportamento, sem RD)
- `apps/web/components/portal/base.tsx:270` (72c92bf): "Sessão até" passou a usar o `formatTime` com o padrão America/Manaus. Antes era o fuso do navegador do operador, e o comentário retirado dizia que "o portal não é de um tenant". É preciso confirmar se o operador fora de Manaus deve ver a hora de Manaus.
- CSVs que passaram a proteger fórmula (Core 6×, treinamento, catálogo): o valor negativo em texto ganha apóstrofo (`'-R$ 5` e `'-0,20%` no `csvDeMetas`, `csv-saida.test.ts`). É o efeito esperado da CWE-1236, mas muda o arquivo que o usuário abre no Excel. O testes confere valor × regra.

Nenhum recado foi enviado nesta tarefa, como o pedido mandou. O gerente-projetos repassa aos donos.

### Resumo do parecer
- **Liberados (4):** e67a0bb, 26e05c1, 509ec65 e 3ebfd15.
- **Não liberados (9):** 72c92bf, e372cf8, d2f2438, c5d88a9, 5420e21, 41e16fa, 6bc880a, f19fe03 e e62cea1.
- **Abertos:** 9, todos seguram. São 8 novos (RD-2741 a RD-2749) e o RD-0284 reaberto em parte. O RD-0051 continua aberto, preso ao RD-2741, ao RD-2747 e ao RD-2748.

## Reteste v1.0.32 (sessão G)

- **Data:** 24/11/2026 (horário de Manaus). Pedido do gerente-projetos depois da rodada 2 dos donos sobre o "Parecer v1.0.32 (sessão G)" (e37c7b1). Mesma decisão "3 A" (R-20261123-190212-alexandre e R-20261123-222635-alexandre).
- **Bases:** cada SHA contra o SHA do parecer (`git diff <parecer>..<sha>`). Os branches de CSV dos módulos trazem o merge do 579a785, e o diff deles foi lido contra `origin/nuvem/v1032-csv-engenheiro-software` (579a785). O grep final das células de CSV foi feito à mão no conjunto: em cada branch, só os caminhos do dono; no 579a785, `apps` e `packages`.
- **Critério:** o mesmo do parecer. Nenhum achado aberto, de qualquer gravidade (R-20261110-062506). A exceção (R-20261111-190159) vale só para comentário ou título de teste de gravidade baixa. Corpo de teste repetido segura.
- **Graphify:** 1 consulta (`query` das células de CSV e do BOM fora do comum). O mapa é do `main`, e por isso o conjunto foi conferido com `git grep` nos SHAs.

### Veredito por branch

| Branch | SHA | Veredito | Achados |
|---|---|---|---|
| `nuvem/v1032-portal-engenheiro-apps` | b9008a7 | **LIBERADO** | RD-0284 corrigido: o gravado mostra o rótulo, "Módulos que entraram" (só com 1 ou mais) e os avisos, sem parâmetros e sem administrador. Saíram `textoDoAdminNoResultado`, o estado `emailEnviado` e o teste deles. RD-2742 corrigido: um `ResultadoEmpresa`, com o tom e o título pelo `simulado`, e `modulosNaLista` usada também em `textoDaConferencia`. Não sobra `empresa.resultado-admin` no código nem nos testes. O resíduo em `docs/producao/sabado.md` é o RD-2750, do gerente-projetos, e não segura este branch |
| `nuvem/v1032-core-modulo-core` | 32fe2e8 | **LIBERADO** | RD-2744 corrigido: o caso repetido saiu, e a CWE-1236 foi para o título do `describe`. Os tipos importados seguem em uso nas fotos |
| `nuvem/v1032-ux-designer-ux` | b530e3d | **LIBERADO** | RD-2743 corrigido: a spec (§6) descreve o Conferir em uma linha e o gravado como o código faz. Não sobra "Administrador que será criado" em `docs/design` |
| `nuvem/v1032-csv-engenheiro-software` | 579a785 | **LIBERADO** | RD-2741 (parte do comum) corrigido: `ValorCsv` e `textoDaCelula` únicos, com uma linha no JSDoc. RD-2745 corrigido. RD-2749 corrigido: `goals.ts` usa `BOM_CSV` e `celulaCsvCompacta`. Os dois casos "nulo e número" de `csv.test.ts` são um por função pública, com saídas diferentes (`""` × vazio), e não se repetem |
| `nuvem/v1032-csv-modulo-catalogo` | 3dc1593 | **LIBERADO** | RD-2741 corrigido nas 3 células (`marcas.ts`, `tabelas-preco.ts` e `formularios.ts`). Os 2 casos novos de fórmula são os únicos que provam que `produtosParaCsv` e `precosParaCsv` passam pelo comum |
| `nuvem/v1032-csv-modulo-gestor` | 8d4e621 | **LIBERADO** | RD-2741 corrigido: o adaptador saiu e o arredondamento vem de `arredondar(v, 2)` do comum. O caso do negativo é o único que prova o arredondamento no CSV (`-2,345` → `-2,35`; o `Math.round` daria `-2,34`) |
| `nuvem/v1032-csv-modulo-promotor` | cd4903b | **LIBERADO** | RD-2741 e RD-2747 corrigidos: `csvCelula` e `CSV_BOM` saíram, e o teste passa pela saída do `paraCsv` |
| `nuvem/v1032-csv-modulo-integracao` | 3309c6c | **LIBERADO** | RD-2741 e RD-2747 corrigidos: `csvCell`, `Celula` e `CSV_BOM` saíram, e o teste vai pelo `toCsv`. RD-2748 corrigido: `celulaDoModelo` única no kit, com o JSDoc proposto, importada pelo `migrar-csv-1.0.5.ts` |
| `nuvem/v1032-csv-modulo-treinamento` | ca4f270 | **NÃO LIBERADO** | RD-2741 corrigido (`map(celulaCsvCompacta)` direto). Novo: RD-2751 |
| `nuvem/v1032-csv-modulo-vendedor` | c01675b | **LIBERADO** | RD-2741 corrigido: `map(celulaCsv)` direto. RD-2747 corrigido: `CSV_BOM` e o `expect(CSV_BOM).toBe('﻿')` saíram. A fórmula é testada pelo `ordersToCsv` |
| `nuvem/v1032-csv-testes` | f922696 | **LIBERADO** | RD-2746 corrigido: P1 a P3 pela `exportarRespostasCsv` com uma resposta de texto, e o `=1+1` não se repete (fica no `exportacao.test.ts` da Pesquisa). O merge do 3ebfd15 não muda a Pesquisa |
| `nuvem/v1032-comentarios-testes` | e67a0bb | **LIBERADO** | sem mudança desde o parecer |
| `nuvem/v1032-comentarios-modulo-vendedor` | 26e05c1 | **LIBERADO** | sem mudança desde o parecer |
| `nuvem/v1032-csv-modulo-pesquisa` | 3ebfd15 | **LIBERADO** | sem mudança desde o parecer |

### Achados novos

| RD | Grav. | Tipo | Onde (SHA) | O que se repete | Proposta (antes → depois) | Dono | Segura |
|---|---|---|---|---|---|---|---|
| RD-2750 | média | doc | `docs/producao/sabado.md:63`, passo 5, coluna do resultado esperado (`main` 0865039 e todos os branches) | O roteiro espera `"Empresa criada" e "Administrador criado: <e-mail>"`. Com o RD-0284 (b9008a7), a tela gravada não diz mais o administrador. São dois docs com textos diferentes para o mesmo resultado, e a fonte da verdade é `docs/design/portal-entrar.md` §6 (b530e3d) | `"Empresa criada" e "Administrador criado: <e-mail>"` → `"Empresa criada." e "Módulos que entraram: <módulos>."` | gerente-projetos | sim (doc), no lote do gerente. Não segura o b9008a7 |
| RD-2751 | baixa | teste | `modules/treinamento/web/lib/csv.test.ts:57-62` (ca4f270) | O caso "RD-0051: célula que começa com = sai com apóstrofo; número negativo fica como está" repete a foto byte a byte logo acima (`:41-55`), que já mostra `'=1+1` pelo mesmo `toCsv`. O `-1` repete o `celulaCsvCompacta(-5)` do comum (`packages/comum/src/csv.test.ts`). Fazia sentido com o adaptador local do f19fe03 (`typeof v === 'number' ? String(v)`); com o `map(celulaCsvCompacta)` direto, não prova mais nada do módulo | Tirar o caso `:57-62`. A foto `:41-55` continua garantindo a fórmula e os números do CSV do treinamento | modulo-treinamento | sim (corpo de teste) |

**Grep final** (`replace(/"/g, '""')`, `/[;"`, `protegerFormula`, `CSV_BOM`, `﻿` e o BOM literal em `.ts`/`.tsx`, sem testes e sem `.md`), no conjunto. Sobram:
- `packages/comum/src/csv.ts`, com `protegerFormula`, `celulaCsv`, `celulaCsvCompacta` e o `BOM_CSV`, o único BOM literal em código;
- `modules/integracao/kit-thathyany/lib/modelos-csv.ts:403` (`celulaDoModelo`), que fica sem proteção de propósito, porque o arquivo vai ao importador (RD-2748);
- `packages/platform-sdk/src/busca.ts:81` e `packages/platform-sdk/src/sqlite/armazenamento.ts:705`, que não são CSV;
- escapes de HTML (`&quot;`) no PDF do catálogo, no PDF do pedido e no Conector, que não são CSV.

Não sobra adaptador, apelido nem célula de CSV à mão nos módulos.

**RD-0051:** **fecha**. O RD-2741, o RD-2747 e o RD-2748 estão corrigidos nos branches, e a parte do Core está no 32fe2e8. Ficam os dois formatos do comum: `celulaCsv`, com aspas sempre, e `celulaCsvCompacta`, com aspas só quando precisa. O RD-2751 é de teste e não reabre o RD-0051. No catálogo, o status passa a "corrigido", e a confirmação vem no merge.

### Encaminhar ao testes (sem RD, como no parecer)
- Os dois pontos do parecer seguem como estão: o "Sessão até" no horário de Manaus (`apps/web/components/portal/base.tsx:270`) e o apóstrofo no negativo em texto dos CSVs que passaram a proteger fórmula.
- Mudança de comportamento do vendedor (c01675b): o `toCsv` passou a receber o número cru pelo `celulaCsv`. Com isso, o número negativo deixa de ganhar apóstrofo e o decimal sai com vírgula. Hoje o `ordersToCsv` só manda texto (`csvNumber`). O testes confere `formas-pagamento.ts:183,189` e `transportadoras.ts:67`.

### Observação sem número (próxima rodada)
- `modules/gestor/web/lib/csv.test.ts:25-26` (já estava no `main`, fora do diff): o `expect(cab).toBe(BOM_CSV + …)` já garante o `startsWith(BOM_CSV)` da linha seguinte.

Nenhum recado foi enviado nesta tarefa, como o pedido mandou. O gerente-projetos repassa ao modulo-treinamento e cuida do próprio RD-2750.

### Resumo do reteste
- **Liberados (13):** b9008a7, 32fe2e8, b530e3d, 579a785, 3dc1593, 8d4e621, cd4903b, 3309c6c, c01675b e f922696. Sem mudança, seguem liberados o e67a0bb, o 26e05c1 e o 3ebfd15.
- **Não liberado (1):** ca4f270 (RD-2751).
- **Corrigidos nos branches (11):** RD-0051, RD-0284 e RD-2741 a RD-2749 (RD-2741, RD-2742, RD-2743, RD-2744, RD-2745, RD-2746, RD-2747, RD-2748 e RD-2749).
- **Abertos (2):** RD-2750 (gerente-projetos, doc) e RD-2751 (modulo-treinamento, corpo de teste). Os dois seguram.
