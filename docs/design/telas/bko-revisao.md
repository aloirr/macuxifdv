# Revisão do BKO — especificação visual (designer-ux)

Origem: pedidos do Alexandre de 14/11/2026 (R-20261114-142000, R-20261114-143000, R-20261114-143500).
Situação: **§M (menu da esquerda) especificada**, aguardando a decisão sobre a cor do título do grupo (MC-0054, ver M4) e a implementação.
As seções §P1 a §P10 (kit já no branch `nuvem/bko-revisao-designer-ux`) ganham o texto completo no próximo lote; a lista no fim deste doc diz onde cada uma está no kit.

---

## §M — Menu da esquerda (R-20261114-143000, prioridade)

Pedido do Alexandre (literal): "quero o menor numero de cliques possiveis, e barras de rolagem. organize os menus da esquerda por ordem alfabetica. Todos os menus tem sub menus, os menus como CADASTRO por exemplo tem que ter uma cor diferente. esses dos prints em anexo estao sem um menu, encaixe eles ou crie um novo menu para o que nao couber nos menus existentes".

### M1. Problema hoje (`apps/web/components/app-shell.tsx`)
- O primeiro grupo (`operacao`) é desenhado **sem título**: Clientes, Rotas, Visitas, Recados (Core), Aprovações, Alertas (Gestor) e Pedidos (Vendedor) ficam soltos no topo.
- Ordem por `ordem` numérica e por módulo, não alfabética.
- 36 telas abertas de uma vez (perfil Administrador com os 8 módulos: 35 páginas de módulo e a Auditoria da plataforma): não cabem em 768 px de altura e o menu ganha barra de rolagem (`overflow-y-auto`).
- Título do grupo em `#9AA3B0`, quase a mesma cor dos itens (`#C9CED5`).

### M2. Grupos e itens (inventário completo, `modules/*/web/index.ts` + plataforma)
São **36 telas**: 35 no menu, em 9 grupos, e "Usuários e módulos" (`/usuarios-e-modulos`), que sai do menu e fica só por URL (decisão do dono do produto, R-20261114-144500: os módulos do usuário ficam na gaveta de Novo usuário). Das 35 do menu, 34 são páginas de módulo e 1 é a Auditoria da plataforma. Grupos e itens em **ordem alfabética** (pt-BR, sem diferenciar acento e caixa: `localeCompare('pt-BR', { sensitivity: 'base' })`). Nenhum item fora de grupo. A coluna "grupo hoje" mostra de onde o item sai.

| Grupo | Item (rótulo do menu) | Módulo | Rota | Grupo hoje |
|---|---|---|---|---|
| **Acesso** | Aparelhos | core | `/aparelhos` | Administração |
| | Perfis de acesso | core | `/perfis` | Administração |
| | Usuários | core | `/usuarios` | Administração |
| **Análise** | Indicadores | core | `/indicadores` | Análise |
| | Metas | core | `/metas` | Análise |
| | Painel da equipe | gestor | `/equipe` | Análise |
| | Ranking | gestor | `/ranking` | Análise |
| | Trade marketing | promotor | `/trade` | Análise |
| **Cadastros** | Carteira | core | `/carteira` | Cadastros |
| | Clientes | core | `/clientes` | solto (Operação) |
| | Coordenadas sugeridas | core | `/coordenadas-sugeridas` | Cadastros |
| | Filiais | core | `/filiais` | Cadastros |
| | Fotos do PDV | core | `/fotos-pdv` | Cadastros |
| | Motivos | core | `/motivos` | Cadastros |
| **Comercial** | Alçadas | vendedor | `/alcadas` | Cadastros |
| | Formas de pagamento e prazos | vendedor | `/formas-pagamento` | Administração |
| | Plano de RV | core | `/plano-rv` | Cadastros |
| | Transportadoras | vendedor | `/transportadoras` | Cadastros |
| **Comunicação** | Alertas | gestor | `/alertas` | solto (Operação) |
| | Recados | core | `/recados` | solto (Operação) |
| | Regras de alerta | gestor | `/regras-alerta` | Administração |
| **Conteúdo de campo** | Pesquisas | pesquisa | `/pesquisas` | Cadastros |
| | Trade | promotor | `/trade-cadastros` | Cadastros |
| | Trilhas | treinamento | `/treinamento` | Cadastros |
| **Operação** | Aprovações | gestor | `/aprovacoes` | solto (Operação) |
| | Pedidos | vendedor | `/pedidos` | solto (Operação) |
| | Rotas | core | `/rotas` | solto (Operação) |
| | Visitas | core | `/visitas` | solto (Operação) |
| **Produtos** | Catálogo | catalogo | `/catalogo` | Cadastros |
| | Marcas concorrentes | catalogo | `/catalogo/marcas` | Cadastros |
| | Preço e custo | core | `/produtos` | Cadastros |
| | Tabelas de preço | catalogo | `/tabelas-preco` | Cadastros |
| **Sistema** | Auditoria | plataforma | `/auditoria` | Plataforma |
| | Carga por arquivo | integracao | `/integracao/carga-arquivo` | Administração |
| | Integração ERP | integracao | `/integracao` | Administração |
| *(fora do menu)* | Usuários e módulos | core | `/usuarios-e-modulos` (só por URL) | Administração |

Contagem por grupo: Acesso 3, Análise 5, Cadastros 6, Comercial 4, Comunicação 3, Conteúdo de campo 3, Operação 4, Produtos 4, Sistema 3 = **35 no menu** + 1 só por URL = **36 telas**.

Por que assim:
- Os 7 itens soltos foram para **Operação** (Aprovações, Pedidos, Rotas, Visitas), **Comunicação** (Alertas, Recados) e **Cadastros** (Clientes), como sugere o recado.
- "Cadastros" tinha 16 itens: sozinho já passaria da altura da tela. Foi dividido pelo que o usuário procura: **Cadastros** (clientes e campo), **Comercial** (regras de venda), **Produtos** e **Conteúdo de campo** (o que o vendedor e o promotor respondem ou estudam).
- "Administração" deixa de existir: **Acesso** (quem entra e o que vê) e **Sistema** (auditoria e integração). "Plataforma" (só Auditoria) entra em Sistema.
- Itens do slot `menu.itens` do Core (`ItemMenu`) continuam no grupo **Mais**, na posição alfabética dele; hoje nenhum módulo usa o slot.
- Rótulos curtos, sem repetir o grupo: "Preço e custo" (o grupo já diz Produtos), "Trade" (o grupo já diz Conteúdo de campo). O título da página não muda.
- "Perfis de acesso": **manter (decisão do dono do produto, R-20261114-144500)**, no lugar do renome para "Perfis" sugerido pelo corretor. É o texto literal do pedido ("UM MENU PERFIL DE ACESSO") e da simulação de Usuários e Perfis já aprovada.
- "Usuários e módulos": **sai do menu** (R-20261114-144500), sem renome. A rota segue por URL e os módulos do usuário ficam na gaveta de Novo usuário.
- O item `Tarefas` do `manifest.ts` do Core não tem página web: não aparece (nada muda).

### M3. Comportamento (menor número de cliques, sem barra de rolagem)
1. **Tudo cabe aberto → tudo aberto.** O shell mede a lista: se todos os grupos abertos cabem na altura da janela (entre a marca e o rodapé com o usuário), todos ficam abertos e o título do grupo não tem seta nem clique. Caso típico: perfil com poucos módulos. Toda tela fica a **1 clique**.
2. **Não cabe → sanfona.** Só o grupo da tela atual fica aberto; os outros mostram só o título com a seta `›`.
   - **Passar o ponteiro** (ou dar foco pelo teclado) num grupo fechado abre a lista dele **ao lado do menu** (painel flutuante, mesmas cores do menu). A tela fica a **1 clique**. O painel fecha ao sair do grupo e do painel, com `Esc` ou ao clicar fora.
   - **Clicar no título** de um grupo fechado abre esse grupo na sanfona e fecha o anterior (para quem prefere clicar, ou em tela de toque).
   - Ao abrir uma tela de outro grupo, a sanfona passa para o grupo dela.
3. **Sem barra de rolagem em 1366×768.** Medido na simulação: com o maior grupo aberto (Cadastros, 6 itens), a lista termina em 550 px e o rodapé começa em 681 px. Sobra espaço até para o grupo Mais. Abaixo de 640 px de altura (raro no desktop), o menu pode rolar; é a única exceção.
4. **Tela aberta destacada:** fundo `#2B3743` (`nav-active`), texto branco semibold e barra vertical de 3 px em Sol claro à esquerda. O título do grupo dela fica aberto.
5. **Tela estreita (`md:hidden`)**: a barra de cima continua com a rolagem lateral que já existe, mas só com os itens do grupo da tela atual, depois de um seletor com o nome do grupo. Detalhe na implementação, sem simulação neste lote.
6. **Licença e perfil (sem mudança):** o item só aparece se o módulo estiver licenciado e o perfil puder ver a tela (`criarShell`/`montar`, RN-CORE-01/03, ADR 0004). Grupo sem nenhum item visível não aparece.

### M4. Cores e medidas (sobre o Grafite `#16202A`, cor do menu lateral do BKO pelo manual §3)
O brief cita "Azul noite", mas o menu lateral do BKO é Grafite no manual da marca; mantive o Grafite. O Sol claro passa por Grafite e Azul noite com folga (abaixo).

| Elemento | Cor | Contraste | Tipo |
|---|---|---|---|
| Título do grupo | **Sol claro `#F59A52`** | 7,56:1 no Grafite (5,56:1 no `#2B3743` do hover; 5,85:1 no Azul noite) | IBM Plex Sans 600, 11,5 px, caixa alta, espaço 0,07em |
| Item | `#C9CED5` (`nav-text`) | 10,42:1 | IBM Plex Sans 400, 14 px |
| Item da tela atual | branco no `#2B3743` + barra Sol claro | 12,14:1 | IBM Plex Sans 600, 14 px |
| Seta do grupo | igual ao título | — | 14 px |

- Medidas: menu com **240 px** de largura (hoje 220; "Formas de pagamento e prazos" cabe sem cortar), título do grupo 30 px de altura, item 32 px, recuo do item 20 px.
- **Cor do título do grupo: depende da decisão do Alexandre (MC-0054, design-de-marca).** O Sol claro hoje é só "o sol e os gráficos sobre fundo escuro" (manual §3); usá-lo como texto é uso novo. Opções: **A** = Sol claro `#F59A52` (como está nesta spec e nas simulações); **B** = branco 600, com os itens em `#C9CED5` (atende o pedido com menos diferença entre título e item). Fica A até a decisão; se for B, mudam só a linha "Título do grupo" e a "Seta do grupo" da tabela acima e os PNG do M5.
- **Logo:** o símbolo vem do ativo da marca (`docs/marca/ativos/2026-11-12-v1/macuxi-simbolo-negativo.svg`, 32 × 25 px), nunca redesenhado (MC-0053).

### M5. Simulações (1366×768, escala 2, Archivo/IBM Plex de `apps/web/app/fonts/`)
| Arquivo | O que mostra |
|---|---|
| `bko-revisao/menu-completo-1366x768.png` | Administrador com os 8 módulos, sanfona, grupo Operação aberto, Pedidos destacado, sem barra de rolagem |
| `bko-revisao/menu-tela-atual-e-outro-grupo.png` | Coordenadas sugeridas destacada (Cadastros aberto) e o painel ao lado do grupo Comercial sob o ponteiro (1 clique) |
| `bko-revisao/menu-perfil-poucos-modulos.png` | Assistente com Core + Vendedor (Catálogo e Integração são nativos): 12 itens em 6 grupos, tudo cabe aberto (a lista termina em 646 px, o rodapé começa em 681 px), sem setas |

Os `.html` ao lado de cada PNG são a fonte da simulação.

Por que o Assistente na terceira simulação: a lista é a real, filtrada pelo perfil e pela ação de cada página (`modules/*/web/index.ts` e `acoes` dos `manifest.ts`). O Supervisor não serve: no perfil de fábrica ele não tem `acesso.bko` (`packages/platform-sdk/src/permissoes-perfil.ts`, RN-CORE-33) e, mesmo com o acesso liberado, com Core + Vendedor veria 16 itens em 7 grupos (Filiais, Alçadas, Plano de RV e Transportadoras a mais), que não cabem abertos e caem na sanfona. O Assistente com Core + Vendedor vê: Análise (Indicadores, Metas), Cadastros (Carteira, Clientes, Filiais), Comercial (Alçadas, Transportadoras), Operação (Pedidos, Rotas, Visitas), Produtos (Catálogo) e Sistema (Auditoria).

### M6. Quem implementa (proposta ao gerente; nada disso é caminho do designer-ux)
- **engenheiro-software** (`packages/platform-sdk/src/shell.ts`): trocar o tipo `grupo` (`operacao | cadastros | analise | administracao`) pelos 9 grupos do M2 (`acesso | analise | cadastros | comercial | comunicacao | conteudo_campo | operacao | produtos | sistema`) e ordenar a `navegacao` por rótulo do grupo e depois pelo rótulo do item (pt-BR), ignorando `ordem` no BKO. A troca do tipo é incompatível: falar com o engenheiro sobre a migração dos módulos no mesmo lote.
- **Cada modulo-*** (`modules/<m>/web/index.ts`): ajustar o `grupo` das páginas conforme a tabela do M2.
- **engenheiro-apps** (`apps/web/components/app-shell.tsx`): título em todos os grupos (inclusive o primeiro), Auditoria dentro de Sistema, sanfona e painel ao lado (M3), medição de altura, cores e medidas (M4), largura de 240 px, `aria-expanded` no título do grupo e `aria-current="page"` no item (este já existe). Atualizar o teste do menu e os `data-testid` (`nav-<modulo>-<id>` continuam iguais).
- **testes**: e2e em 1366×768 sem rolagem no `menu-bko` (Administrador com os 8 módulos) e item invisível sem licença ou sem perfil.

### M7. Para os módulos e o engenheiro-apps (renomes do menu)
O rótulo do menu (`navegacao` em `modules/<m>/web/index.ts`) tem de estar na lista `apps.web.menus` do `manifest.ts` do mesmo módulo (o `criarShell` acusa a diferença): os dois mudam juntos, no mesmo PR do dono. O `titulo` da página não muda.

| Dono | Arquivo | Rótulo antigo → novo |
|---|---|---|
| modulo-core | `modules/core/web/index.ts` (página `usuarios-e-modulos`) | **tirar do menu, sem renome**: remover o campo `navegacao` (a página, o `caminho` e a `acao` `modulo.gerir_licencas` ficam; o `criarShell` só põe no menu a página que tem `navegacao`) |
| modulo-core | `modules/core/web/index.ts` (página `perfis`) | **não muda**: "Perfis de acesso" fica (R-20261114-144500) |
| modulo-core | `modules/core/web/index.ts` (página `produtos`, campo `navegacao`) | "Produtos" → "Preço e custo" |
| modulo-core | `modules/core/manifest.ts` (`apps.web.menus`) | tirar "Usuários e módulos" da lista; "Produtos" → "Preço e custo"; "Perfis de acesso" fica |
| modulo-promotor | `modules/promotor/web/index.ts` (página `cadastros`, campo `navegacao`) | "Cadastros de trade" → "Trade" |
| modulo-promotor | `modules/promotor/manifest.ts` (`apps.web.menus`) | "Cadastros de trade" → "Trade" |
| engenheiro-software | `packages/platform-sdk/src/shell.ts` (tipo `grupo`) | grupo `produtos_precos` (rótulo "Produtos e preços", das versões anteriores desta spec) → `produtos` (rótulo "Produtos"), com os demais grupos do M6 |
| engenheiro-apps | `apps/web/components/app-shell.tsx` e o teste do menu | rótulos dos grupos conforme o M2 (inclusive "Produtos"); conferir textos fixos de teste que citem os rótulos antigos "Produtos" (item do Core) e "Cadastros de trade" |
| testes | `tests/modulos/acesso-perfil-modulos-rncore01.test.ts` (linhas 147–163) e `tests/e2e/bko/demo-bko.spec.ts` (linhas 105–108) | **nada a mudar nesses dois pontos**: o teste já espera, no estado novo, "Usuários e módulos" fora do `navegacao` e fora de `apps.web.menus`, com a página registrada por URL, e exige "Usuários" e "Perfis de acesso" no manifesto; o e2e já procura `nav-core-usuarios` e `nav-core-perfis`. Conferir só os testes que citem os rótulos antigos "Produtos" (item do Core) e "Cadastros de trade" |

Os `data-testid` (`nav-<modulo>-<id>`) e as rotas não mudam.

---

## §P1–§P10 — kit da revisão (no branch, texto completo no próximo lote)
| Seção | Assunto | Onde está no kit (`packages/ui/src/web/`) |
|---|---|---|
| §P1 | Cabeçalho da página: título e ações na mesma linha, sem frase sob o título | `ui.tsx` (`PageHeader`, `subtitle` obsoleto) |
| §P2 | Tabela sem rolagem lateral (colunas por prioridade) | `tabela-dados.ts`, `tabela-dados-componente.tsx` |
| §P3 | Menu "⋯" de ações da linha | `menu-acoes.tsx` |
| §P4 | Busca da lista com lupa e campo de texto dos filtros | `ui.tsx` (`CampoBusca`, `TextField`), `icons.tsx` (`IconBusca`) |
| §P5 | Situação com um selo só | `ui.tsx` (`SeloSituacao`) |
| §P7 | Lista vazia: frase do que falta e ação que resolve | `ui.tsx` (`EstadoVazio`) |
| §P10 | Mapa único dos módulos (id → nome → ícone); nativos fora das listas | `modulos.tsx` |
