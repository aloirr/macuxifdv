# Menu Parâmetros no BKO (simulação para aprovação)

Pedido do Alexandre (15/11/2026, 10h40, horário de Manaus): um menu **PARÂMETROS** no BKO que reúne tudo o que é parâmetro e configuração, com um submenu por funcionalidade (ex.: Parâmetros › Clientes).
Acréscimo (15/11/2026, R-20261115-113500): Pesquisa, Trade e Treinamento viram grupos próprios do menu, sempre visíveis e desativados sem licença; os parâmetros deles vão para Parâmetros › <módulo>. Regras de alerta: R-20261115-112500.
**Só simulação.** Nada muda no código até a aprovação. Padrão visual: `docs/design/telas/bko-revisao.md` §M2–§M7 (grupos e itens em ordem alfabética, sanfona, título 30 px, item 32 px, menu de 240 px, título do grupo em Sol claro `#F59A52` sobre o Grafite).

## 1. Inventário (o que hoje é parâmetro ou configuração)

Fonte: `modules/*/web/index.ts`, `modules/*/manifest.ts` e `TRANSICAO_GRUPO` em `packages/platform-sdk/src/shell.ts`.

| # | Rota hoje | Menu hoje | Módulo | O que configura | Ação / regra |
|---|---|---|---|---|---|
| 1 | `/clientes` (painel) | Cadastros › Clientes | core | Farol: dias do cliente verde e amarelo; positivação do vendedor verde e amarelo | `parametro.farol`, RN-CORE-28 |
| 2 | `/clientes` (painel) | Cadastros › Clientes | core | Curvas ABC: A e B por faturamento, volume e frequência | `parametro.curva_abc`, RN-CORE-49 |
| 3 | `/metas` (painel) | Análise › Metas | core | Dias úteis da semana; minutos para "parado" | `parametro.inicio`, RN-CORE-26 |
| 4 | `/metas` (mesmo painel) | Análise › Metas | core | Prazo para avisar etapa pendente do checkout (horas) | `parametro.checkout_pendencia` |
| 5 | sem rota | nenhum | core | Frases do dia (30 padrão + as da empresa) | `parametro.inicio`, RN-CORE-41 |
| 6 | sem rota | nenhum | core | Calendário: feriados do ano; janela do almoço da Produtividade | `parametro.inicio` |
| 7 | `/produtos` (aba) | Produtos › Preço e custo | core | Desconto máximo padrão da empresa | `produto.parametros` |
| 8 | `/produtos` (aba) | Produtos › Preço e custo | core | Medidas | `medida.gerenciar`, RN-CORE-19 |
| 9 | `/motivos` | Cadastros › Motivos | core | Motivos de não venda | `motivo.editar` |
| 10 | `/fotos-pdv` | Cadastros › Fotos do PDV | core | Tipos de foto exigidos no PDV | `foto_tipo.editar` |
| 11 | `/plano-rv` | Comercial › Plano de RV | core | RV por indicador e faixa, com vigência | `plano_rv.ver` |
| 12 | `/perfis` | Acesso › Perfis de acesso | core | Permissões por perfil | `perfil.gerir` |
| 13 | `/usuarios-e-modulos` | fora do menu (só URL, §M7) | core | Licenças de módulo por empresa, perfil e usuário | `modulo.gerir_licencas`, RN-CORE-01/03 |
| 14 | `/usuarios-e-modulos` (painel) | fora do menu | core | Promotor vê pedidos | `parametro.promotor_ve_pedidos`, RN-PRO-01 |
| 15 | `/alcadas` | Comercial › Alçadas | vendedor | Limites de desconto por nível de aprovação | (perfis do manifesto) |
| 16 | `/formas-pagamento` | Comercial › Formas de pagamento e prazos | vendedor | Formas e prazos | `forma_pagamento.ver`, RN-VEN-24 |
| 17 | `/regras-alerta` | Comunicação › Regras de alerta | gestor | Regras que geram alertas da equipe | `alerta_regra.gerenciar` |
| 18 | `/trade-cadastros` (gaveta, só leitura) | Conteúdo de campo › Trade | promotor | Validade crítica [7] e em atenção [30]; peso do parcial na conformidade [0] | RN-PRO-08, RN-PRO-11; `GET /v1/promotor/cadastros/parametros` |
| 18a | sem tela | nenhum | promotor | Variação de preço sem confirmar [50%]; permanência mínima da visita [10 min] | RN-PRO-04, RN-PRO-07 (`modules/promotor/domain/parametros.ts`) |
| 19 | sem tela | nenhum | catalogo | Limite de caracteres da aplicação (`aplicacao_max_cadastro`, padrão 2.000) | RN-CAT-11 |
| 20 | sem tela | nenhum | pesquisa | Tolerância da vigência [24 h]; construtor: perguntas [50], opções por pergunta [20], fotos por pergunta [10], texto [2.000], amplitude da escala [10]; foto: maior lado [1.600 px], JPEG [80] | RN-PES-04/06/07, premissa T-0012 (`ParametrosPesquisaSchema`) |
| 21 | sem tela | nenhum | treinamento | Quiz: nota mínima [70%], tentativas por dia [3], intervalo [0 min], nota que vale [melhor]; lição: tempo mínimo [30 s], % da duração [50]; XP: lição [10], acerto [5], trilha [50], sequência por dia [2] e teto [20], teto diário [200], por desafio [500]; níveis (10 faixas), medalha de sequência [7 dias], perfis do ranking [vendedor, promotor] | RN-TRE-01/02/04, decisões de 31/10 (`ParametrosTreinamentoSchema`) |

Pesquisa e Treinamento **têm parâmetros** (no contrato, com padrão), mas **nenhuma tela** hoje; o fuso vem do tenant e não entra. Nenhum dos três módulos tem rota de gravação dos parâmetros (o Promotor só lê; Pesquisa e Treinamento leem os parâmetros do módulo do tenant).

Ficam fora (cadastro ou operação): Usuários, Aparelhos, Carteira, Clientes (o farol), Coordenadas sugeridas, Filiais, Transportadoras, Catálogo, Tabelas de preço, Marcas concorrentes, Preço e custo (a lista), Pesquisas, Trilhas, Trade (os cadastros), Recados, Alertas, Aprovações, Pedidos, Rotas, Visitas, Metas, Painel, Ranking, Indicadores, Trade marketing, Integração ERP, Carga por arquivo e Auditoria.
**Portal de configuração** (`config.<host>`: Empresas, com Bases, Integração e Empresa; Diagnósticos): outro site e outro público (time Macuxi e admin do cliente). Fica como está, fora do menu do BKO.

## 2. Árvore proposta

Grupo **PARÂMETROS** na barra lateral. Cada submenu é um item que abre `/parametros/<submenu>` com as seções daquela funcionalidade, uma embaixo da outra. Submenus em ordem alfabética (ADR 0050). 🔒 = depende da licença do módulo (desativado sem ela, §3).

| Submenu | Rota | Seções (na ordem da página) | Dono |
|---|---|---|---|
| Acesso | `/parametros/acesso` | Perfis de acesso · Módulos · Promotor vê pedidos | core |
| Alertas | `/parametros/alertas` | Regras de alerta: todos os campos com o valor padrão, liga/desliga visível e uma frase por regra (R-20261115-112500; o desenho da página vem da spec da sessão `nuvem/alertas-designer-ux`) | gestor |
| Calendário | `/parametros/calendario` | Feriados · Janela do almoço | core |
| Clientes | `/parametros/clientes` | Farol · Curvas ABC | core |
| Início | `/parametros/inicio` | Dias úteis e equipe parada · Frases do dia | core |
| Metas e RV | `/parametros/metas-e-rv` | Plano de RV | core |
| Pedidos | `/parametros/pedidos` | Alçadas · Formas de pagamento e prazos | vendedor |
| Pesquisa 🔒 | `/parametros/pesquisa` | Vigência · Construtor · Fotos | pesquisa |
| Produtos | `/parametros/produtos` | Desconto máximo padrão · Medidas | core (+ catalogo, D6) |
| Trade 🔒 | `/parametros/trade` | Validade · Visita e coleta · Gôndola (os 5 parâmetros do Promotor) | promotor |
| Treinamento 🔒 | `/parametros/treinamento` | Quiz e lição · XP · Níveis e ranking | treinamento |
| Visitas | `/parametros/visitas` | Motivos de não venda · Fotos do PDV · Etapa pendente | core |

### Sai de → vai para

| Menu hoje | O que sai | Vai para | O menu de origem |
|---|---|---|---|
| Acesso › Perfis de acesso | a página inteira | Parâmetros › Acesso | perde o item (fica Aparelhos, Usuários) |
| `/usuarios-e-modulos` (só URL) | licenças e "Promotor vê pedidos" | Parâmetros › Acesso | já estava fora do menu |
| Análise › Metas | painel "Parâmetros do Início" | Parâmetros › Início (dias úteis, parado) e Parâmetros › Visitas (etapa pendente) | o item fica (a página de metas continua) |
| Cadastros › Clientes | painéis do farol e das Curvas ABC | Parâmetros › Clientes | o item fica (o farol continua) |
| Cadastros › Fotos do PDV | a página inteira | Parâmetros › Visitas | perde o item |
| Cadastros › Motivos | a página inteira | Parâmetros › Visitas | perde o item (fica Carteira, Clientes, Coordenadas sugeridas, Filiais) |
| Comercial › Alçadas | os limites | Parâmetros › Pedidos | perde o item |
| Comercial › Formas de pagamento e prazos | a página inteira | Parâmetros › Pedidos | perde o item |
| Comercial › Plano de RV | a página inteira | Parâmetros › Metas e RV | perde o item (fica só Transportadoras, D4) |
| Comunicação › Regras de alerta | a página inteira | Parâmetros › Alertas | perde o item (fica Alertas, Recados) |
| Conteúdo de campo › Trade | gaveta "Parâmetros de trade" | Parâmetros › Trade | o item vai para Trade › Cadastros |
| Produtos › Preço e custo | abas "Parâmetros" e "Medidas" | Parâmetros › Produtos | o item fica (a lista de preço e custo) |
| nenhum | Frases do dia; Calendário | Parâmetros › Início; Parâmetros › Calendário | ganham lugar no menu |
| nenhum | parâmetros da Pesquisa; do Treinamento; 2 do Promotor | Parâmetros › Pesquisa; › Treinamento; › Trade | ganham tela |

### Grupos dos módulos (R-20261115-113500)

| Menu hoje | Vai para | Módulo |
|---|---|---|
| Conteúdo de campo › Pesquisas | **Pesquisa** › Pesquisas | pesquisa |
| Conteúdo de campo › Trilhas | **Treinamento** › Trilhas | treinamento |
| Conteúdo de campo › Trade | **Trade** › Cadastros | promotor |
| Análise › Trade marketing | **Trade** › Indicadores | promotor |
| Conteúdo de campo (grupo) | some: fica sem item | — |

Análise fica com Indicadores, Metas, Painel da equipe e Ranking. Os itens do Trade mudam de nome para não repetir o grupo (D8).
Menu final (alfabético): Acesso · Análise · Cadastros · Comercial · Comunicação · Operação · Parâmetros · Pesquisa 🔒 · Produtos · Sistema · Trade 🔒 · Treinamento 🔒.

## 3. Comportamento

- **Dois níveis**, como hoje: grupo → item. Sem terceiro nível no menu; as seções ficam dentro da página.
- **Página**: título com "Parâmetros" acima (o `eyebrow` do `PageHeader`) e o nome do submenu; seções em `Panel`, cada uma com o próprio Salvar. O botão principal só fica ativo na seção alterada; nas outras, desabilitado (um só principal por tela). Lista com criação (formas de pagamento, frases, motivos) mantém o botão de criar como principal e as ações da linha no "⋯".
- **Licença e perfil** (RN-CORE-01/03, ADR 0004), módulos core, vendedor e gestor, como hoje: a seção aparece só com o módulo e a ação dela; submenu sem seção visível some; grupo sem item some. A API continua revalidando.
- **Sem licença (Pesquisa, Trade, Treinamento)**: o grupo do menu e o submenu de Parâmetros com o mesmo nome **sempre aparecem**; sem a licença da empresa ficam desativados:
  - cinza `#8B96A3` no Grafite (5,5:1, legível) e cadeado (`IconLock` de `@macuxi/ui/web`, 14 px) no lugar da seta;
  - não abre nem navega; `aria-disabled="true"`, focável pelo teclado (`tabindex="0"`), `aria-describedby` apontando para a dica;
  - dica **"Contrate o módulo para usar"** em balão à direita, no passar do mouse, no foco e no clique. Balão, e não linha abaixo do título, porque a lista já passa da altura (D3) e o cadeado sozinho já diz "bloqueado"; o texto aparece quando a pessoa tenta usar;
  - empresa com a licença e perfil sem o módulo: o grupo some, como hoje (é permissão, não contratação; "contrate" estaria errado);
  - endereço digitado sem licença: a API recusa e o shell mostra o estado de sem acesso que já existe.
- **Links antigos**: `/perfis`, `/motivos`, `/fotos-pdv`, `/plano-rv`, `/alcadas`, `/formas-pagamento`, `/regras-alerta` e `/usuarios-e-modulos` redirecionam para o novo endereço (com a âncora da seção).
- **Altura**: com o grupo Parâmetros aberto (12 títulos + 12 itens) a lista mede 766 px. Em 1440×900 sobram 703 px: passa 63 px e a lista rola (borda esmaecida do lado cortado; ao abrir um grupo, o menu rola até o item). Em 1366×768 passa cerca de 200 px (D3, D10). Com Parâmetros fechado (05) cabe.
- **Quem implementaria**:
  - engenheiro-software (`packages/platform-sdk/src/shell.ts`, ADR 0050): grupo `parametros` no tipo `GrupoMenu` e no `ROTULO_GRUPO_MENU`; página com seções de módulos diferentes (extensão `parametros.secoes` ou páginas por módulo na mesma rota; decidir na ADR).
  - engenheiro-apps (`apps/web`): rotas `/parametros/*`, redirecionamentos dos endereços antigos, teste do menu.
  - modulo-core, modulo-vendedor, modulo-gestor, modulo-promotor (e modulo-catalogo, se D6): mover os painéis para as seções, ajustar `navegacao` e `apps.web.menus` no mesmo PR.
  - engenheiro-software: grupos `pesquisa`, `trade` e `treinamento` no `GRUPOS_MENU` (sai `conteudo_campo`); estado "sem licença" do item de menu no shell; **ADR nova** (altera a ADR 0050 e o "some sem licença").
  - designer-ux: estado desativado do item de menu e a dica em `packages/ui` (depois da aprovação).
  - modulo-promotor, modulo-pesquisa, modulo-treinamento: página de parâmetros de cada um e rota de gravação (hoje só leitura).
  - testes: e2e do menu (rolagem na altura aprovada; grupo e submenu com cadeado sem licença, sem navegar; grupo some sem o módulo no perfil).

## 4. Premissas e decisões para o Alexandre

Premissas:
- P1. Posição do grupo pela regra alfabética: entre Operação e Produtos.
- P2. O portal de configuração não entra (outro site e outro público).
- P3. Medidas é parâmetro do produto: vai para Parâmetros › Produtos.
- P4. O prazo da etapa pendente do checkout é assunto de visita: vai para Parâmetros › Visitas, separado dos dias úteis.
- P5. **Muda regra vigente**: hoje o menu esconde o que não tem licença (RN-CORE-01/03, ADR 0050). O "sempre aparece, desativado" vale só para os grupos e submenus de Pesquisa, Trade e Treinamento e **exige ADR do engenheiro-software e ajuste da RN-CORE-03** (doc 03) antes de implementar.
- P6. "Sem licença" = a empresa não contratou. Perfil sem o módulo, com a empresa licenciada, continua escondendo (RN-CORE-01).
- P7. Os parâmetros dos três módulos aparecem com o valor atual e o padrão; até existir a rota de gravação, a página é só leitura (como a gaveta de hoje).
- P8. Regras de alerta: aqui só a posição na árvore (Parâmetros › Alertas); o desenho da página vem da sessão `nuvem/alertas-designer-ux` (R-20261115-112500).

Decisões:
- D1. **Posição do grupo**: alfabética (simulada) ou fixa no fim, acima de Sistema.
- D2. **Módulos em Acesso**: "Usuários e módulos" saiu do menu em 14/11 (R-20261114-144500). Proposta: volta como seção "Módulos" de Parâmetros › Acesso. Alternativa: só "Promotor vê pedidos" vem; as licenças ficam só por URL e na gaveta de Novo usuário.
- D3. **Altura em 1366×768**: (a) aceitar rolagem da lista só com Parâmetros aberto em janelas abaixo de ~830 px de altura; (b) até 8 submenus, juntando dois pares (ex.: Calendário dentro de Início); (c) um item único "Parâmetros" que abre uma página com a lista dos submenus à esquerda.
- D4. **Comercial com um item só** (Transportadoras): manter o grupo ou levar Transportadoras para Cadastros e tirar o grupo Comercial.
- D5. **Decisões recentes das alçadas** (histórico, não parâmetro): sai de Parâmetros e vai para Operação › Pedidos ou fica abaixo dos limites.
- D6. **Limite da aplicação do catálogo**: hoje sem tela. Criar a seção "Catálogo" em Parâmetros › Produtos (tela nova do modulo-catalogo) ou deixar como está.
- D7. **Nome do grupo do Promotor**: **"Trade"** (recomendado: é o assunto, como os outros grupos, e é o que supervisor e analista procuram) ou "Promotor" (nome do módulo e do perfil). Vale para o grupo e para Parâmetros › Trade.
- D8. **Itens do grupo Trade**: "Cadastros" (hoje "Trade") e "Indicadores" (hoje "Trade marketing"), para não repetir o nome do grupo. Alternativa: manter "Trade marketing".
- D9. **Grupos de um item só** (Pesquisa › Pesquisas, Treinamento › Trilhas): aceitar, como Comercial (D4), em troca de deixar o módulo à vista.
- D10. **Altura com 12 grupos**: a rolagem com Parâmetros aberto agora acontece também em 1440×900 (63 px). Reforça a opção (c) de D3.

## 5. Simulações (1440×900, escala 2)

Gerador: `node docs/design/menu-parametros/gerar.mjs` (escreve os `.html` e os `.png` desta pasta). Dados fictícios.

| Arquivo | O que mostra |
|---|---|
| `01-menu-parametros-aberto.png` | Menu com Parâmetros aberto e os 12 submenus (a lista rola); demais grupos fechados; ao lado, o mapa submenu → seções → onde está hoje |
| `02-parametros-clientes.png` | Parâmetros › Clientes: Farol (com um campo alterado e Salvar ativo) e Curvas ABC (Salvar desabilitado) |
| `03-parametros-pedidos.png` | Parâmetros › Pedidos: Alçadas e Formas de pagamento e prazos |
| `04-parametros-inicio.png` | Parâmetros › Início: Dias úteis e equipe parada; Frases do dia |
| `05-menus-modulos-licenca.png` | Empresa sem Pesquisa e Treinamento: os dois grupos com cadeado (dica visível em Pesquisa); Trade com licença, aberto (Cadastros, Indicadores); ao lado, sai de → vai para e os estados do grupo |
| `06-parametros-modulos-licenca.png` | Parâmetros aberto: Pesquisa e Treinamento com cadeado (dica em Pesquisa); Parâmetros › Trade selecionado com Validade, Visita e coleta e Gôndola (valor e padrão) |

01 a 04: empresa com os 8 módulos e o menu novo (12 grupos, sem Conteúdo de campo).
