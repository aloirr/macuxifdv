# Menu Parâmetros no BKO (simulação, versão final)

Pedido do Alexandre (15/11/2026, 10h40, horário de Manaus): um menu **PARÂMETROS** no BKO que reúne tudo o que é parâmetro e configuração, com um submenu por funcionalidade (ex.: Parâmetros › Clientes).
Acréscimo (15/11/2026, R-20261115-113500): Pesquisa, Trade e Treinamento viram menus próprios, sempre visíveis e desativados sem licença; os parâmetros deles vão para Parâmetros › <módulo>. Regras de alerta: R-20261115-112500.
Decisões finais: 15/11/2026, 12h10 (horário de Manaus), R-20261115-121000 (decisões delegadas à sessão coordenadora; seção 4). Correção de 15/11/2026, 12h20, R-20261115-122000: Formas de pagamento e prazos vai para Cadastros (D11).
**Só simulação.** Nada muda no código antes da ADR nova (seção 4, pendências). Padrão visual: `docs/design/telas/bko-revisao.md` §M2–§M7 (sanfona, título 30 px, item 32 px, menu de 240 px, título em Sol claro `#F59A52` sobre o Grafite).

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
| 16 | `/formas-pagamento` | Comercial › Formas de pagamento e prazos | vendedor | Formas e prazos (cadastro; vai para Cadastros, D11) | `forma_pagamento.ver`, RN-VEN-24 |
| 17 | `/regras-alerta` | Comunicação › Regras de alerta | gestor | Regras que geram alertas da equipe | `alerta_regra.gerenciar` |
| 18 | `/trade-cadastros` (gaveta, só leitura) | Conteúdo de campo › Trade | promotor | Validade crítica [7] e em atenção [30]; peso do parcial na conformidade [0] | RN-PRO-08, RN-PRO-11; `GET /v1/promotor/cadastros/parametros` |
| 18a | sem tela | nenhum | promotor | Variação de preço sem confirmar [50%]; permanência mínima da visita [10 min] | RN-PRO-04, RN-PRO-07 (`modules/promotor/domain/parametros.ts`) |
| 19 | sem tela | nenhum | catalogo | Limite de caracteres da aplicação (`aplicacao_max_cadastro`, padrão 2.000) | RN-CAT-11 |
| 20 | sem tela | nenhum | pesquisa | Tolerância da vigência [24 h]; construtor: perguntas [50], opções por pergunta [20], fotos por pergunta [10], texto [2.000], amplitude da escala [10]; foto: maior lado [1.600 px], JPEG [80] | RN-PES-04/06/07, premissa T-0012 (`ParametrosPesquisaSchema`) |
| 21 | sem tela | nenhum | treinamento | Quiz: nota mínima [70%], tentativas por dia [3], intervalo [0 min], nota que vale [melhor]; lição: tempo mínimo [30 s], % da duração [50]; XP: lição [10], acerto [5], trilha [50], sequência por dia [2] e teto [20], teto diário [200], por desafio [500]; níveis (10 faixas), medalha de sequência [7 dias], perfis do ranking [vendedor, promotor] | RN-TRE-01/02/04, decisões de 31/10 (`ParametrosTreinamentoSchema`) |

Pesquisa e Treinamento **têm parâmetros** (no contrato, com padrão), mas **nenhuma tela** hoje; o fuso vem do tenant e não entra. Nenhum dos três módulos tem rota de gravação dos parâmetros (o Promotor só lê; Pesquisa e Treinamento leem os parâmetros do módulo do tenant).

Ficam fora (cadastro ou operação): Usuários, Aparelhos, Carteira, Clientes (o cadastro), Coordenadas sugeridas, Filiais, Formas de pagamento e prazos (D11), Transportadoras, Catálogo, Tabelas de preço, Marcas concorrentes, Preço e custo (a lista), Pesquisas, Trilhas, Trade (os cadastros), Recados, Alertas, Aprovações, Pedidos, Rotas, Visitas, Metas, Painel, Ranking, Indicadores, Integração ERP, Carga por arquivo e Auditoria.
**Portal de configuração** (`config.<host>`: Empresas, com Bases, Integração e Empresa; Diagnósticos): outro site e outro público (time Macuxi e admin do cliente). Fica como está, fora do menu do BKO.

## 2. Árvore final

### Menu lateral (primeiro nível)

Ordem alfabética (ADR 0050), com duas exceções decididas: **Parâmetros fica fixo no fim, logo acima de Sistema** (D1) e **entrada com uma página só é item direto**, sem sanfona (D9). 🔒 = depende da licença do módulo (seção 3).

| Entrada | Tipo | Itens |
|---|---|---|
| Acesso | grupo | Aparelhos · Usuários |
| Análise | grupo | Indicadores · Metas · Painel da equipe · Ranking |
| Cadastros | grupo | Carteira · Clientes · Coordenadas sugeridas · Filiais · Formas de pagamento e prazos (D11) · Transportadoras (D4) |
| Comunicação | grupo | Alertas · Recados |
| Operação | grupo | Aprovações · Pedidos (com as decisões recentes das alçadas, D5) · Rotas · Visitas |
| Pesquisa 🔒 | item direto (D9) | abre `/pesquisas` |
| Produtos | grupo | Catálogo · Marcas concorrentes · Preço e custo · Tabelas de preço |
| Trade 🔒 | grupo (D7) | Cadastros · Indicadores (D8) |
| Treinamento 🔒 | item direto (D9) | abre a página de Trilhas |
| Parâmetros | item direto (D3/D10) | abre `/parametros/<secao>` |
| Sistema | grupo | Auditoria · Carga por arquivo · Integração ERP |

Conferência da D9 (nenhum grupo com 1 item): Acesso 2, Análise 4, Cadastros 6, Comunicação 2, Operação 4, Produtos 4, Sistema 3, Trade 2. Saem os grupos Comercial (D4) e Conteúdo de campo (ficou sem item).
**Altura** (medida pelo `gerar.mjs`, que abre cada grupo e falha se passar ou se um item for cortado): 11 linhas fechadas ocupam 350 px; o pior caso, Cadastros aberto com 6 itens, ocupa 562 px dos 571 px livres em 1366×768, na fonte do sistema (item de menu 15 px). "Formas de pagamento e prazos" quebra em duas linhas nos 240 px, sem reticências. **O menu não rola mais** (D3/D10 resolvidas pela opção c).
Sem grupo Financeiro (D11): no BKO não há tela financeira de menu; crédito e títulos só aparecem no Cliente 360 (sem item de menu) e em Operação › Aprovações.

### Página Parâmetros

Item único no menu; a página tem a lista de seções à esquerda (200 px, ordem alfabética) e o conteúdo da seção à direita, um `Panel` por assunto, cada um com o próprio Salvar. Endereço `/parametros/<secao>`; `/parametros` abre a primeira seção disponível.

| Seção | Endereço | Painéis (na ordem) | Dono |
|---|---|---|---|
| Acesso | `/parametros/acesso` | Perfis de acesso · Módulos (D2) · Promotor vê pedidos | core |
| Alertas | `/parametros/alertas` | Regras de alerta (desenho na spec da sessão `nuvem/alertas-designer-ux`, R-20261115-112500) | gestor |
| Calendário | `/parametros/calendario` | Feriados · Janela do almoço | core |
| Clientes | `/parametros/clientes` | Farol · Curvas ABC | core |
| Início | `/parametros/inicio` | Dias úteis e equipe parada · Frases do dia | core |
| Metas e RV | `/parametros/metas-e-rv` | Plano de RV | core |
| Pedidos | `/parametros/pedidos` | Alçadas (só os limites, D5) | vendedor |
| Pesquisa 🔒 | `/parametros/pesquisa` | Vigência · Construtor · Fotos | pesquisa |
| Produtos | `/parametros/produtos` | Desconto máximo padrão · Medidas · Catálogo (limite da aplicação, D6) | core + catalogo |
| Trade 🔒 | `/parametros/trade` | Validade · Visita e coleta · Gôndola | promotor |
| Treinamento 🔒 | `/parametros/treinamento` | Quiz e lição · XP · Níveis e ranking | treinamento |
| Visitas | `/parametros/visitas` | Motivos de não venda · Fotos do PDV · Etapa pendente | core |

### Sai de → vai para

| Menu hoje | O que sai | Vai para | O menu de origem |
|---|---|---|---|
| Acesso › Perfis de acesso | a página inteira | Parâmetros › Acesso | fica Aparelhos, Usuários |
| `/usuarios-e-modulos` (só URL) | licenças e "Promotor vê pedidos" | Parâmetros › Acesso (D2) | já estava fora do menu |
| Análise › Metas | painel "Parâmetros do Início" | Parâmetros › Início (dias úteis, parado) e › Visitas (etapa pendente) | o item fica |
| Cadastros › Clientes | painéis do farol e das Curvas ABC | Parâmetros › Clientes | o item fica |
| Cadastros › Fotos do PDV; › Motivos | as páginas inteiras | Parâmetros › Visitas | perdem o item |
| Comercial › Alçadas | os limites | Parâmetros › Pedidos | o grupo Comercial sai (D4) |
| Comercial › Alçadas | decisões recentes (histórico) | Operação › Pedidos (D5) | idem |
| Comercial › Formas de pagamento e prazos | a página inteira (tabela única com as abas Prazos e Formas, aprovada em R-20261115-121500) | Cadastros › Formas de pagamento e prazos (D11) | idem |
| Comercial › Plano de RV | a página inteira | Parâmetros › Metas e RV | idem |
| Comercial › Transportadoras | o item | Cadastros › Transportadoras (D4) | idem |
| Comunicação › Regras de alerta | a página inteira | Parâmetros › Alertas | fica Alertas, Recados |
| Conteúdo de campo › Pesquisas | o item | Pesquisa (item direto, D9) | o grupo sai |
| Conteúdo de campo › Trilhas | o item | Treinamento (item direto, D9) | idem |
| Conteúdo de campo › Trade | o item; a gaveta "Parâmetros de trade" | Trade › Cadastros; Parâmetros › Trade | idem |
| Análise › Trade marketing | o item | Trade › Indicadores (D8) | fica Indicadores, Metas, Painel da equipe, Ranking |
| Produtos › Preço e custo | abas "Parâmetros" e "Medidas" | Parâmetros › Produtos | o item fica |
| nenhum | Frases do dia; Calendário; limite da aplicação (D6) | Parâmetros › Início; › Calendário; › Produtos | ganham tela |
| nenhum | parâmetros da Pesquisa, do Treinamento e 2 do Promotor | Parâmetros › Pesquisa; › Treinamento; › Trade | ganham tela |

## 3. Comportamento

- **Dois níveis no menu**: grupo → item, ou item direto. As seções de Parâmetros ficam na lista da página, não no menu.
- **Item direto** (Pesquisa, Treinamento, Parâmetros): mesmo título do grupo (Sol claro, maiúsculas, 30 px), sem seta; navega no clique; selecionado com o fundo `#2B3743` e texto branco.
- **Regra de forma** (D9): grupo com uma página só vira item direto; item direto que ganhar a segunda página vira grupo. Vale para qualquer grupo.
- **Página Parâmetros**: título "Parâmetros"; o nome da seção aparece só na lista (selecionada em branco com a barra Azul noite `#1E3350`, token `accent`), sem repetir no conteúdo. O botão principal só fica ativo no painel alterado; nos outros, desabilitado (`disabled:bg-disabled` do `packages/ui`; um só principal por tela). Rótulo sempre "Salvar <coisa>" (Salvar farol, Salvar curvas, Salvar dias úteis, Salvar desconto, Salvar catálogo). "Padrão: X" aparece só quando o valor difere do padrão (ex.: Trade › Em atenção até, 45 dias). Grupo de campos repetidos por dimensão vira grade (Curvas ABC: linhas Curva A e Curva B, rótulo e ajuda uma vez; colunas Faturamento, Volume, Frequência). Painel com lista e criação (frases, medidas, motivos) tem o criar como principal e as ações da linha no "⋯".
- **Licença e perfil** nos módulos core, vendedor e gestor, como hoje (RN-CORE-01/03, ADR 0004): o painel aparece só com o módulo e a ação dele; seção sem painel visível some; grupo sem item some. A API continua revalidando.
- **Sem licença (Pesquisa, Trade, Treinamento)**: a entrada do menu e a seção de Parâmetros com o mesmo nome **sempre aparecem**; sem a licença da empresa:
  - **no menu**: cinza `#8B96A3` no Grafite (5,5:1) e cadeado (`IconLock`, 14 px) no lugar da seta; não abre nem navega; `aria-disabled="true"`, `tabindex="0"`, `aria-describedby` na dica; balão **"Contrate o módulo para usar"** à direita no passar do mouse, no foco e no clique. O balão é passageiro e some ao sair; na simulação (01) fica sobre área livre;
  - **na lista de Parâmetros**: cinza Texto de apoio `#5B6673` no fundo Pérola `#F8F6F1` (5,41:1) e cadeado; a seção pode ser escolhida e o lado direito mostra só o cadeado e "Contrate o módulo para usar" (07), sem balão, para não cobrir o conteúdo;
  - empresa com a licença e perfil sem o módulo: a entrada some, como hoje (é permissão, não contratação);
  - endereço digitado sem licença: a API recusa e o shell mostra o estado de sem acesso que já existe.
- **Links antigos**: `/perfis`, `/motivos`, `/fotos-pdv`, `/plano-rv`, `/alcadas`, `/regras-alerta` e `/usuarios-e-modulos` redirecionam para `/parametros/<secao>` (com a âncora do painel). `/formas-pagamento` fica como está, agora no grupo Cadastros (D11).
- **Quem implementa** (depois da ADR nova):
  - engenheiro-software (`packages/platform-sdk/src/shell.ts`): item direto de primeiro nível e posição fixa de Parâmetros no `GRUPOS_MENU`; saem `comercial` e `conteudo_campo`, entra `trade`; estado "sem licença" da entrada; seções de Parâmetros vindas de módulos diferentes (extensão `parametros.secoes` ou equivalente, a definir na ADR).
  - engenheiro-apps (`apps/web`): rotas `/parametros/*`, lista de seções, redirecionamentos, teste do menu.
  - modulo-core, modulo-vendedor, modulo-gestor, modulo-promotor, modulo-catalogo: mover os painéis para as seções e ajustar `navegacao` e `apps.web.menus` no mesmo PR; modulo-vendedor leva as decisões recentes para Operação › Pedidos e passa Formas de pagamento e prazos para o grupo `cadastros` (D11); modulo-catalogo cria o painel Catálogo.
  - modulo-promotor, modulo-pesquisa, modulo-treinamento: seção de parâmetros de cada um e rota de gravação (hoje só leitura).
  - designer-ux: item direto, estado desativado com cadeado, balão e lista de seções em `packages/ui`.
  - testes: e2e do menu (cadeado sem licença sem navegar; entrada some sem o módulo no perfil; seção bloqueada mostra o aviso; links antigos).

## 4. Decisões, premissas e pendências

Decididas em 15/11/2026, 12h10 (horário de Manaus), R-20261115-121000:
- **D1**. Parâmetros fixo no fim, logo acima de Sistema (exceção à ordem alfabética da ADR 0050).
- **D2**. "Módulos" volta como painel de Parâmetros › Acesso.
- **D3/D10**. Opção (c): item único "Parâmetros" no menu, que abre a página com a lista de seções à esquerda e o conteúdo à direita; endereço `/parametros/<secao>`; seções de módulo sem licença com cadeado na lista.
- **D4**. Transportadoras vai para Cadastros; o grupo Comercial sai.
- **D5**. As decisões recentes das alçadas vão para Operação › Pedidos.
- **D6**. Painel Catálogo em Parâmetros › Produtos, com o limite da aplicação (RN-CAT-11).
- **D7**. Grupo "Trade".
- **D8**. Itens "Cadastros" e "Indicadores" no grupo Trade.
- **D9**. Grupo de um item só não é aceito. Aplicação (designer-ux): Pesquisa e Treinamento viram itens diretos de primeiro nível, como Parâmetros, sempre visíveis e com cadeado sem licença (R-20261115-113500). Conferidos os 8 grupos restantes: nenhum fica com 1 item (seção 2). A D9 vale para grupos do menu, não para seções da página Parâmetros: a seção Pedidos fica só com o painel Alçadas.

Correção de 15/11/2026, 12h20 (horário de Manaus), R-20261115-122000 (vale sobre a anterior):
- **D11**. Formas de pagamento e prazos é item do grupo Cadastros (sai de Parâmetros › Pedidos); não se cria grupo Financeiro. A tela de prazos em tabela única (abas Prazos e Formas) foi aprovada em R-20261115-121500; o detalhe dela não é desta simulação.

Premissas:
- P1. O portal de configuração (`config.<host>`) não entra (outro site e outro público).
- P2. Medidas é parâmetro do produto (Parâmetros › Produtos); a etapa pendente do checkout é assunto de visita (Parâmetros › Visitas).
- P3. "Sem licença" = a empresa não contratou. Perfil sem o módulo, com a empresa licenciada, continua escondendo (RN-CORE-01).
- P4. Os parâmetros de Pesquisa, Trade e Treinamento aparecem só para leitura (valor atual; ver §3), sem campo editável nem Salvar, inclusive Pesquisa e Treinamento quando tiverem licença (decisão do gerente, RD-P07). A rota de gravação de cada módulo é lote futuro.
- P6. Alçadas (03) fica só leitura, como hoje: `modules/vendedor/web/pages/alcadas-page.tsx` só mostra os limites, sem edição.
- P5. Seção bloqueada: ver §3.

Pendências (não são decisões abertas):
- **ADR nova do engenheiro-software**: "sempre aparece, desativado" muda RN-CORE-01/03 e a ADR 0050; a mesma ADR registra o item direto de primeiro nível (D9), a posição fixa de Parâmetros (D1) e a fonte das seções de Parâmetros. Com ela, o ajuste da RN-CORE-03 no doc 03.

## 5. Simulações (1366 de largura, escala 2, fonte do sistema)

Gerador: `node docs/design/menu-parametros/gerar.mjs` (escreve os `.html` e os `.png` desta pasta e falha se um balão ou nota cobrir conteúdo, se o menu passar da altura com qualquer grupo aberto, ou se um item do menu for cortado; a página pode rolar e o PNG mostra a página inteira). Dados fictícios. Cenário único: empresa sem Pesquisa e Treinamento, com Trade; perfil Administrador.

| Arquivo | O que mostra |
|---|---|
| `01-menu-lateral.png` | Menu final: Trade aberto com Indicadores selecionado; Pesquisa e Treinamento com cadeado (balão em Treinamento, sobre área livre); Parâmetros acima de Sistema. Ao lado, o primeiro nível (só para a aprovação) |
| `02-parametros-clientes.png` | Parâmetros › Clientes: Farol com um campo alterado e Salvar ativo; Curvas ABC em grade (Curva A/B × Faturamento, Volume, Frequência) com Salvar desabilitado |
| `03-parametros-pedidos.png` | Parâmetros › Pedidos: só Alçadas (os limites), só leitura como hoje (P6) |
| `04-parametros-inicio.png` | Parâmetros › Início: Dias úteis e equipe parada; Frases do dia · 32 (30 padrão + 2 da empresa; aparecem as primeiras), a do dia com o selo "Hoje" na linha |
| `05-parametros-produtos.png` | Parâmetros › Produtos: Desconto máximo padrão, Medidas e Catálogo (limite da aplicação) |
| `06-parametros-trade.png` | Parâmetros › Trade: Validade, Visita e coleta e Gôndola, só leitura (P4); "Padrão: 30 dias" só em Em atenção até, que difere |
| `07-parametros-pesquisa-sem-licenca.png` | Parâmetros › Pesquisa sem licença: seção com cadeado selecionada; o lado direito mostra só "Contrate o módulo para usar" |

Cada PNG tem o `.html` de mesmo nome. Saíram desta versão: `01-menu-parametros-aberto`, `05-menus-modulos-licenca` e `06-parametros-modulos-licenca` (`.png` e `.html`).

## 6. Pareceres

15/11/2026 (horário de Manaus), todos corrigidos nesta versão:
- **corretor-redundancias**: RD-P01 a RD-P11 corrigidos (grade das Curvas ABC; frase do dia como selo "Hoje" na linha, sem faixa; "Frases do dia · 32"; Desconto sem rótulo repetido; "Padrão: X" só quando difere; rótulos curtos do Trade; Trade só leitura; "Salvar <coisa>"; nota do 02; §1 "Ficam fora"; seção bloqueada só no §3). Para decidir, decisão do gerente: ajuda do Catálogo "De 100 a 2.000."; nomes Cadastros/Indicadores do Trade ficam (D8).
- **design-de-marca**: MC-x1 (`#5B6673` em `.sec.bloq` e `.no.mod`), MC-x2 (barra da seção em Azul noite `#1E3350`) e MC-x3 (borda da nota em `#C9CED5`) corrigidos; botão desabilitado mantido como o do `packages/ui`.

Reconferência 15/11/2026 (horário de Manaus):
- **corretor-redundancias**: RD-P01 a RD-P13 fechados (RD-P12: P4 remete ao §3; RD-P13: nota do 03 remete a P6).
- **design-de-marca**: MC-x1 a MC-x3 fechados e selo "Hoje" aprovado; liberado pela marca, sem achados.
