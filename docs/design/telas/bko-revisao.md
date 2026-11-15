# Revisão do BKO — especificação visual (designer-ux)

Origem: pedidos do Alexandre de 14/11/2026 (R-20261114-142000, R-20261114-143000, R-20261114-143500).
Situação (14/11/2026, horário de Manaus):
- **§M (menu da esquerda): feito.** SDK com os 9 grupos (#271, ADR 0050) e shell com sanfona, Sol claro e logo A (#280). A §M fica como registro do que foi decidido e entregue.
- **§P1 a §P10 (páginas): especificadas**, com o kit em `packages/ui/src/web/` e as simulações da §P12. **Aguardam a aprovação do Alexandre** (decisões em aberto na §P13); depois, cada dono aplica nas próprias páginas pela lista da §P11.
- 15/11/2026: achados do corretor (RD-0360 a RD-0370), da marca (MC-0057, MC-0058) e a pergunta do testes sobre o total de Pedidos, tratados nesta versão.

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
3. **Sem barra de rolagem em 1366×768.** Medido na simulação: com o maior grupo aberto (Cadastros, 6 itens), a lista termina em 576 px e o rodapé começa em 680 px. Sobra espaço até para o grupo Mais. Abaixo de 640 px de altura (raro no desktop), o menu pode rolar; é a única exceção.
4. **Tela aberta destacada:** fundo `#2B3743` (`nav-active`), texto branco semibold e barra vertical de 3 px em Sol claro (`nav-grupo`) à esquerda. O título do grupo dela fica aberto.
5. **Tela estreita (`md:hidden`)**: a barra de cima continua com a rolagem lateral que já existe, mas só com os itens do grupo da tela atual, depois de um seletor com o nome do grupo. Detalhe na implementação, sem simulação neste lote.
6. **Licença e perfil (sem mudança):** o item só aparece se o módulo estiver licenciado e o perfil puder ver a tela (`criarShell`/`montar`, RN-CORE-01/03, ADR 0004). Grupo sem nenhum item visível não aparece.

### M4. Cores e medidas (sobre o Grafite `#16202A`, cor do menu lateral do BKO pelo manual §3)
O brief cita "Azul noite", mas o menu lateral do BKO é Grafite no manual da marca; mantive o Grafite. O Sol claro passa por Grafite e Azul noite com folga (abaixo).

| Elemento | Cor | Contraste | Tipo |
|---|---|---|---|
| Título do grupo | **Sol claro `#F59A52`** (`--color-nav-grupo`) | 7,56:1 no Grafite (5,56:1 no `#2B3743` do hover; 5,85:1 no Azul noite) | IBM Plex Sans 600, 11,5 px, caixa alta, espaço 0,07em |
| Item | `#C9CED5` (`nav-text`) | 10,42:1 | IBM Plex Sans 400, 14 px |
| Item da tela atual | branco no `#2B3743` + barra Sol claro | 12,14:1 | IBM Plex Sans 600, 14 px |
| Seta do grupo | igual ao título | — | 14 px |

- Medidas: menu com **240 px** de largura (hoje 220; "Formas de pagamento e prazos" cabe sem cortar), título do grupo 30 px de altura, item 32 px, recuo do item 20 px.
- **Cor do título do grupo: DECIDIDO (R-20261114-184400, MC-0054): Sol claro `#F59A52`**, como nas simulações do M5. Token próprio `--color-nav-grupo: #f59a52` no shell web, **sem reaproveitar `--color-accent-light`** (mesmo valor, outro papel: se um mudar, o outro não muda junto). Vale para o título, a seta do grupo e a barra de 3 px da tela atual.
- **`#2B3743` (tela atual, hover e divisória do menu): aprovado para o manual da marca (R-20261114-184400)**, já como `--color-nav-active`.
- Sem token em `packages/ui`: lá não há conjunto de tokens web de navegação (os `nav-*` só existem em `apps/web/app/globals.css`, e `packages/ui/src/web/cores.ts` só traz as classes de destaque, gráfico e faixa); o shell usa a classe `text-nav-grupo` gerada pelo token dele.
- **Logo:** o do manual da marca §2.1 (MC-0056).

### M5. Simulações (1366×768, escala 2, Archivo/IBM Plex de `apps/web/app/fonts/`)
| Arquivo | O que mostra |
|---|---|
| `bko-revisao/menu-completo-1366x768.png` | Administrador com os 8 módulos, sanfona, grupo Operação aberto, Pedidos destacado, sem barra de rolagem |
| `bko-revisao/menu-tela-atual-e-outro-grupo.png` | Coordenadas sugeridas destacada (Cadastros aberto) e o painel ao lado do grupo Comercial sob o ponteiro (1 clique) |
| `bko-revisao/menu-perfil-poucos-modulos.png` | Assistente com Core + Vendedor (Catálogo e Integração são nativos): 12 itens em 6 grupos, tudo cabe aberto (a lista termina em 672 px, o rodapé começa em 680 px), sem setas |

Os `.html` ao lado de cada PNG são a fonte da simulação.

Por que o Assistente na terceira simulação: a lista é a real, filtrada pelo perfil e pela ação de cada página (`modules/*/web/index.ts` e `acoes` dos `manifest.ts`). O Supervisor não serve: no perfil de fábrica ele não tem `acesso.bko` (`packages/platform-sdk/src/permissoes-perfil.ts`, RN-CORE-33) e, mesmo com o acesso liberado, com Core + Vendedor veria 16 itens em 7 grupos (Filiais, Alçadas, Plano de RV e Transportadoras a mais), que não cabem abertos e caem na sanfona. O Assistente com Core + Vendedor vê: Análise (Indicadores, Metas), Cadastros (Carteira, Clientes, Filiais), Comercial (Alçadas, Transportadoras), Operação (Pedidos, Rotas, Visitas), Produtos (Catálogo) e Sistema (Auditoria).

### M6. Quem implementa (proposta ao gerente; nada disso é caminho do designer-ux)
- **engenheiro-software** (`packages/platform-sdk/src/shell.ts`): trocar o tipo `grupo` (`operacao | cadastros | analise | administracao`) pelos 9 grupos do M2 (`acesso | analise | cadastros | comercial | comunicacao | conteudo_campo | operacao | produtos | sistema`) e ordenar a `navegacao` por rótulo do grupo e depois pelo rótulo do item (pt-BR), ignorando `ordem` no BKO. A troca do tipo é incompatível: falar com o engenheiro sobre a migração dos módulos no mesmo lote.
- **Cada modulo-*** (`modules/<m>/web/index.ts`): ajustar o `grupo` das páginas conforme a tabela do M2.
- **engenheiro-apps** (`apps/web/components/app-shell.tsx`): título em todos os grupos (inclusive o primeiro), Auditoria dentro de Sistema, sanfona e painel ao lado (M3), medição de altura, cores e medidas (M4), largura de 240 px, `aria-expanded` no título do grupo e `aria-current="page"` no item (este já existe). Atualizar o teste do menu e os `data-testid` (`nav-<modulo>-<id>` continuam iguais).
- **testes**: e2e em 1366×768 sem rolagem no `menu-bko` (Administrador com os 8 módulos) e item invisível sem licença ou sem perfil.

### M7. Para os módulos e o engenheiro-apps (renomes do menu, token e manual)
O rótulo do menu (`navegacao` em `modules/<m>/web/index.ts`) tem de estar na lista `apps.web.menus` do `manifest.ts` do mesmo módulo (o `criarShell` acusa a diferença): os dois mudam juntos, no mesmo PR do dono. O `titulo` da página não muda.

| Dono | Arquivo | Rótulo antigo → novo |
|---|---|---|
| modulo-core | `modules/core/web/index.ts` (página `usuarios-e-modulos`) | **tirar do menu, sem renome**: remover o campo `navegacao` (a página, o `caminho` e a `acao` `modulo.gerir_licencas` ficam; o `criarShell` só põe no menu a página que tem `navegacao`) |
| modulo-core | `modules/core/web/index.ts` (página `perfis`) | **não muda**: "Perfis de acesso" fica (R-20261114-144500) |
| modulo-core | `modules/core/web/index.ts` (página `produtos`, campo `navegacao`) | "Produtos" → "Preço e custo" |
| modulo-core | `modules/core/manifest.ts` (`apps.web.menus`) | tirar "Usuários e módulos" da lista; "Produtos" → "Preço e custo"; "Perfis de acesso" fica |
| modulo-promotor | `modules/promotor/web/index.ts` (página `cadastros`, campo `navegacao`) | "Cadastros de trade" → "Trade" |
| modulo-promotor | `modules/promotor/manifest.ts` (`apps.web.menus`) | "Cadastros de trade" → "Trade" |
| engenheiro-apps | `apps/web/app/globals.css` e `apps/web/components/app-shell.tsx` | **token novo (R-20261114-184400)**: criar `--color-nav-grupo: #f59a52` no `globals.css` e usá-lo (`text-nav-grupo`) no título e na seta dos grupos do menu e na barra da tela atual, **sem reaproveitar `--color-accent-light`** |
| design-de-marca | `docs/marca/` (manual, §3) | **incluir no manual (R-20261114-184400)**: Sol claro `#F59A52` como cor do título de grupo do menu lateral do BKO (uso novo como texto, sobre o Grafite) e `#2B3743` (tela atual, hover e divisória do menu) |
| engenheiro-apps | `apps/web/components/app-shell.tsx` e o teste do menu | rótulos dos grupos conforme o M2 (inclusive "Produtos"); conferir textos fixos de teste que citem os rótulos antigos "Produtos" (item do Core) e "Cadastros de trade" |
| testes | `tests/modulos/acesso-perfil-modulos-rncore01.test.ts` (linhas 147–163) e `tests/e2e/bko/demo-bko.spec.ts` (linhas 105–108) | **nada a mudar nesses dois pontos**: o teste já espera, no estado novo, "Usuários e módulos" fora do `navegacao` e fora de `apps.web.menus`, com a página registrada por URL, e exige "Usuários" e "Perfis de acesso" no manifesto; o e2e já procura `nav-core-usuarios` e `nav-core-perfis`. Conferir só os testes que citem os rótulos antigos "Produtos" (item do Core) e "Cadastros de trade" |

Os `data-testid` (`nav-<modulo>-<id>`) e as rotas não mudam.

---

## §P — Revisão das páginas (R-20261114-142000, R-20261114-143500)

Vale para toda página do BKO (`modules/*/web` e `apps/web`). Regras transversais: só o texto que o usuário usa para agir (R-20261110-192153) e uma informação num lugar só (R-20261110-093124, RN-VEN-42). Medidas em 1366×768 (área útil da página: 1366 − 240 do menu − 64 de margem = **1062 px**).

| Seção | Assunto | Kit (`packages/ui/src/web/`) |
|---|---|---|
| §P1 | Cabeçalho: título e ações na mesma linha, sem frase sob o título | `ui.tsx` (`PageHeader`, `subtitle` obsoleto) |
| §P2 | Tabela sem rolagem lateral | `tabela-dados.ts`, `tabela-dados-componente.tsx` (`TabelaDados`) |
| §P3 | Menu "⋯" de ações (da linha e da página) | `menu-acoes.tsx` (`MenuAcoes`) |
| §P4 | Busca com lupa e filtros na mesma altura | `ui.tsx` (`CampoBusca`, `TextField`, `SelectField`), `icons.tsx` (`IconBusca`) |
| §P5 | Situação com um selo só | `ui.tsx` (`SeloSituacao`, `seloPrincipal`) |
| §P6 | Contagem e totais num lugar só (o zero aparece uma vez) | `ui.tsx` (`rotuloComContagem`) |
| §P7 | Estado vazio: o que falta e a ação que resolve | `ui.tsx` (`EstadoVazio`) |
| §P8 | Formulário na gaveta, com rodapé fixo | `overlay.tsx` (`Drawer` com `rodape`), `ui.tsx` (`CampoFormulario`, `CLASSE_CAMPO`, que parte da `CLASSE_CAMPO_BASE` dos filtros e da busca) |
| §P9 | Sem texto de explicação, de garantia ou de funcionamento | (regra de texto; sem componente) |
| §P10 | Mapa único dos módulos (id → nome → ícone); nativos fora das listas | `modulos.tsx` (`nomeDoModulo`, `IconeModulo`, `iconeDoModulo`, `CartaoDeModulo`, `modulosContrataveis`), `icons.tsx` (desenhos), `adicionais.tsx` (lê de `modulos.tsx`) |

### §P1. Cabeçalho da página
**Hoje.** 47 telas passam `subtitle` ao `PageHeader` (lista na §P11). Exemplos:
- `modules/core/web/components/farol/farol-page.tsx:125`: "Quem está comprando e quem esfriou: dias sem compra de cada cliente (contados até hoje) e positivação do mês por vendedor.";
- `modules/vendedor/web/pages/transportadoras-page.tsx:96`: "Lista do frete FOB, em que o cliente paga a transportadora direto.";
- `modules/vendedor/web/components/orders/orders-page.tsx:65`: o subtítulo vira contador ("0 pedidos · R$ 0,00 · atualizando…"; ver §P6).

As ações também se espalham: Pedidos tem dois links (Atualizar, Exportar CSV, `orders-page.tsx:68-74`); o Farol tem três botões iguais (Parâmetros do farol, Atualizar, Exportar CSV, `farol-page.tsx:128-157`), sem um principal.

**Regra.**
1. Título à esquerda (Archivo 800, 24 px) e ações à direita, **na mesma linha**. Nada embaixo do título: `subtitle` sai (está `@deprecated` no kit).
2. No máximo **um botão principal** (o que cria: "Novo usuário", "Nova transportadora") e **um secundário** visíveis. O resto (Exportar CSV, Atualizar, Parâmetros, Importar) vai no **"⋯" da página** (`MenuAcoes` com `rotulo="Mais ações"`), à direita do principal.
3. **Atualizar** vai para o "⋯": a lista já se atualiza ao abrir, ao voltar à janela e depois de cada ação (RN-CORE-23); o botão fica para quem quer forçar. "atualizando…" não aparece em texto: o "⋯" mostra "Atualizando…" no próprio item enquanto carrega.
4. O `badge` do cabeçalho (ex.: situação da trilha) continua aceito; o `eyebrow` só para o caminho de volta ("‹ Trilhas").

**Texto final.** Título = o `titulo` da página no `modules/<m>/web/index.ts` (sem mudança). Itens do "⋯" da página: "Exportar CSV", "Atualizar", "Parâmetros do <assunto>", nessa ordem; perigo (ex.: "Excluir todos") por último, em vermelho.

**Mudam:** todas as telas da coluna "subtitle" da §P11.

### §P2. Tabela sem rolagem lateral
**Hoje.** 48 arquivos usam `TableScroll` com `minWidth` (rolagem lateral dentro do quadro). Em 1366×768:
- Pedidos (`orders-page.tsx:140`, `minWidth={760}`) divide a linha com o painel "Aguardando aprovação" (340 px): a tabela fica com ~700 px e rola para o lado; a coluna "Recebido" some da vista.
- Farol (`farol-page.tsx:291` e `:356`, `minWidth` 760 e 860): 9 colunas na tabela de vendedores; a de clientes rola.
- Nomes do ERP em caixa alta ("AUTO PEÇAS BOA VISTA LTDA") ocupam mais largura.

**Regra.**
1. Lista usa `TabelaDados`: `table-fixed`, largura do quadro, texto longo com reticências e o texto inteiro no `title`.
2. Cada coluna tem **prioridade**: 1 = sempre; 2 = a partir de 672 px de quadro; 3 = a partir de 1024 px (consulta de contêiner, não da janela). No máximo **6 colunas** de prioridade 1 e 2 juntas.
3. A primeira coluna é o nome do item e abre o detalhe (clique na linha ou Enter no nome). Ações ficam no "⋯" da última coluna (52 px, §P3).
4. Número, dinheiro e data à direita, com algarismos de mesma largura. Dinheiro de centavos (`formatBRL`), data no fuso do tenant.
5. Nome todo em maiúsculas vira nome próprio com `nomeLegivel` (siglas LTDA, ME, EPP ficam).
6. `TableScroll` fica só para tabela que é grade de números (matriz de metas, calendário), onde cortar coluna esconde dado.

**Texto final (Pedidos).** Colunas: Cliente (1, 34%) · Nº (2, 92 px) · Vendedor (2) · Recebido (3, número, 116 px) · Valor (1, número, 116 px) · Situação (1, 164 px) · ⋯ ("PDF do cliente", "PDF interno", os do `order-drawer.tsx:79-84`). "Desc." sai da lista (está no detalhe e na aprovação).
**Texto final (Clientes/Farol, RD-0360).** Cliente (1, 40%) · Vendedor (2) · Dias sem compra (1, número, 150 px) · Farol (1, selo, 150 px) · ⋯. Os dias vêm só com o número ("43"; sem compra nenhuma, "—"); a data da última compra fica no `title` da célula ("Última compra: 02/10/2026"). Saem da lista "Última compra" (está no `title`), "Positivado" (a positivação está no KPI e na aba Vendedores) e "Documento" (a busca por CNPJ continua; o documento aparece no Cliente 360).

**Mudam:** todas as telas da coluna "tabela" da §P11 (exceto as grades citadas no item 6).

### §P3. Menu "⋯" de ações
**Hoje.** Ações em botões soltos na linha, que cortam ou quebram em duas linhas: `usuarios-page.tsx:316-345` (Editar, Desativar, Redefinir senha em `BOTAO_LINHA`), `transportadoras-page.tsx:206-211` (Editar, Inativar), `catalogo/web/pages/marcas-page.tsx:152-167` (Editar, Inativar/Reativar), `catalogo-page.tsx:245-249` (Editar, Ver).

**Regra.**
1. Na linha, **um botão "⋯"** de 36 px (alvo de 44 px com a célula) com `aria-label="Ações de <nome da linha>"`. Abre um menu com o rótulo inteiro de cada ação.
2. Ação de perigo (Inativar, Excluir, Cancelar) por último, em vermelho, depois de um traço; pede confirmação no `Dialog` como hoje.
3. Ação que o perfil não pode fazer **não aparece** (a API revalida). Linha sem nenhuma ação: sem "⋯".
4. Teclado: Enter/Espaço abre, setas andam, Home/End, Esc fecha e volta o foco ao botão. Item com o foco do teclado: fundo `accent-soft` e contorno de 2 px Azul noite por dentro, o mesmo padrão das abas (MC-0058); o hover continua `bg-ground`.
5. Abrir o item **não** vai no "⋯": é o clique no nome.

**Texto final.** Verbo no infinitivo, sem objeto quando a linha já diz qual é: "Editar", "Redefinir senha", "Inativar", "Reativar", "Ver só deste vendedor".
Clientes (RD-0365): o Cliente 360 é o detalhe do cliente, então abre pelo clique no nome (regra 5) e **não** entra no "⋯". O "⋯" da linha de cliente fica com "Ver só deste vendedor".

**Mudam:** usuários, transportadoras, formas de pagamento, filiais, motivos, fotos do PDV, aparelhos, marcas, catálogo, tabelas de preço, regras de alerta, questionários, cadastros de trade, trilhas (§P11).

### §P4. Busca com lupa e filtros
**Hoje.** A busca é um `<input type="search">` com classe local e rótulo em cima, em posições diferentes:
- Pedidos: última, rótulo "Cliente ou número", exemplo "Ex.: Auto Peças ou 000012" (`orders-page.tsx:112-115`), classe `campo` de 40 px, ao lado de selects de 38 px;
- Farol: última, "Cliente ou CNPJ" com "Nome ou CNPJ e Enter" (`farol-page.tsx:215-228`), só busca com Enter ou ao sair do campo;
- Transportadoras e Formas de pagamento: primeira, "Nome ou CNPJ" / exemplo (`transportadoras-page.tsx:129-132`, `formas-pagamento-page.tsx:156`);
- datas com `<input type="date">` de classe local (`orders-page.tsx:104-111`).

**Regra.**
1. A busca é o **primeiro** item da barra de filtros, com `CampoBusca` (lupa, 280 px, sem rótulo visível; o `placeholder` diz o que procura e o `aria-label` repete).
2. Busca ao digitar (espera de 300 ms) e Enter; sem "e Enter" no texto.
3. Filtros de escolha com `SelectField`; texto e data com `TextField`. Todos com **38 px** de altura e o mesmo traço. "De" e "Até" viram um campo só, **"Período"** ("01/11 a 14/11/2026"), para a barra caber numa linha em 1062 px.
4. "Limpar filtros" (botão secundário pequeno) só aparece com algum filtro ligado, no fim da barra. É o único lugar do botão: o estado vazio não repete (§P7).
5. Filtro "Todos" é o padrão e não se repete no rótulo ("Situação: Todas", não "Todas as situações").
6. **KPI que filtra não tem select repetido (RD-0361).** No Farol, os números (Verdes, Amarelos, Vermelhos, Sem compra) são o filtro de faixa: um clique filtra a lista, outro clique no mesmo desliga. O KPI escolhido aparece marcado (traço de 2 px Azul noite e fundo `accent-soft`, `aria-pressed="true"`) e conta como filtro ligado ("Limpar filtros" aparece). O select "Farol" sai. Com um KPI marcado, a aba Clientes fica sem contagem (o KPI marcado é a contagem).

**Texto final (placeholder).** Pedidos: "Buscar cliente ou nº do pedido". Clientes: "Buscar cliente ou CNPJ". Transportadoras: "Buscar nome ou CNPJ". Padrão: "Buscar <o que a lista mostra>".

**Mudam:** Pedidos, Farol, Transportadoras, Formas de pagamento, Trilhas (`trilhas-page.tsx:234`), Diagnósticos do portal (`tela-diagnosticos.tsx:236`) e toda lista com filtro de texto (§P11).

### §P5. Situação com um selo só
**Hoje.** Mais de um selo na mesma célula: `usuarios-page.tsx:300-311` mostra "Ativo" e a etiqueta da senha lado a lado; `orders-page.tsx:173-179` põe o selo do status e, embaixo, a situação de faturamento em texto ("Faturado parcial · NF 123").

**Regra.**
1. A coluna **Situação** mostra **um selo**: o mais importante para agir. A tela monta a lista em ordem de importância e o `SeloSituacao` mostra o primeiro.
2. Ordem: o que pede ação (Aguardando aprovação, Senha expirada, Erro) > o que bloqueia (Inativo, Rejeitado, Cancelado) > o estado normal (Ativo, Integrado, Faturado).
3. O resto da situação vai ao detalhe (gaveta), não à lista.
4. Selo sempre com texto (cor nunca sozinha); tons do kit (`pending`, `success`, `danger`, `warning`, `neutral`).

**Mudam:** Usuários (ativo + senha), Pedidos (status + faturamento), Aparelhos, Integração (lotes), Alertas.

### §P6. Contagem e totais num lugar só (o zero aparece uma vez)
**Hoje (achado do corretor, Pedidos sem nenhum pedido).** O mesmo zero aparece **3 vezes**: "0 pedidos · R$ 0,00" no subtítulo (`orders-page.tsx:65`), "Pedidos · 0" no título do quadro (`:135`) e "Nenhum pedido com esses filtros." (`:186`). E o painel ao lado diz "Aguardando aprovação · 0" junto de "Nada pendente." (`approvals-panel.tsx:226` e `:230`). O Farol repete o tamanho da carteira em "Clientes na carteira" (KPI, `farol-page.tsx:246`) e em "Clientes (N)" (`:337`); Transportadoras faz o mesmo em `:175`.

**Regra.**
1. A **contagem** da lista principal da página fica num lugar só: o **título da página** (`h1`), com `rotuloComContagem` ("Pedidos · 137", "Transportadoras e frete · 5"). O quadro da lista principal fica **sem título** (RD-0364): o `h1` já diz o que a lista é.
2. **Com zero**, o `h1` fica só com o rótulo ("Pedidos") e a página mostra só o `EstadoVazio`, **uma vez**, sem quadro em volta.
3. **Contagem e total são do filtro inteiro**, não das linhas carregadas (pergunta do testes). A API devolve a quantidade e a soma do filtro junto com a primeira página; as páginas seguintes só trazem linhas. Assim o rótulo e o número falam do mesmo conjunto: "Pedidos · 137" e "R$ 61.284,90" são os 137 pedidos do filtro, mesmo com 50 linhas na tela. O "+" do `rotuloComContagem` ("50+") fica só para lista sem contagem exata do servidor, e essa lista não mostra total.
4. O **total em dinheiro** vai ao lado do `h1` (o `badge` do `PageHeader`), em Archivo 700, 18 px, `text-ink-2`; com zero, não aparece.
5. Quadro de pendências (Aguardando aprovação, Coordenadas sugeridas, Digitadas pelos vendedores) **só aparece com pelo menos um item** e tem título com a contagem ("Aguardando aprovação · 3"): é o único quadro da página com título, porque divide a página com a lista. Sem pendência, o quadro some.
6. **O item pendente aparece num lugar só (RD-0363).** Com o quadro de pendências, a lista, a contagem e o total não trazem os pendentes, e o select "Situação" não oferece "Aguardando aprovação" (decisão h da §P13, opção a recomendada).
7. KPI não repete número que já está no título da página ou de uma aba da mesma tela.

**Texto final (Pedidos).** Com pedidos: `h1` "Pedidos · 137" e, ao lado, "R$ 61.284,90" (os dois sem os pendentes); quadro "Aguardando aprovação · 3" em cima, só com pendente; lista sem título. Sem pedidos: `h1` "Pedidos" e o vazio "Nenhum pedido com esses filtros." (o "Limpar filtros" fica na barra); sem quadro de pendências.
**Texto final (Transportadoras).** `h1` "Transportadoras e frete · 5", com o selo `neutral` "Frete padrão: CIF" ao lado (§P9); lista sem título. Com zero: `h1` "Transportadoras e frete" e o vazio "Nenhuma transportadora cadastrada." + "Nova transportadora".
**Texto final (Farol).** A contagem fica nas abas ("Clientes · 97", "Vendedores · 8"), que fazem o papel de título do quadro. KPI de positivação (RD-0362): "Positivação" e "62%", com o número na cor da faixa (`text-success`, `text-warning` ou `text-danger`, todas acima de 4,5:1 no branco) e **sem** o selo "Amarelo".

**Mudam:** Pedidos, Aprovações (gestor), Farol, Transportadoras, Coordenadas sugeridas, Alertas, Lotes da integração e toda lista com "· N" ou "(N)" no título (§P11).

### §P7. Estado vazio
**Hoje.** Cada tela escreve o vazio de um jeito: `<span>` cinza solto embaixo do cabeçalho da tabela (`orders-page.tsx:186`, `transportadoras-page.tsx:177-179`), `Notice` azul de informação (`farol-page.tsx:288-290`, `:338-343`), "Nada pendente." (`approvals-panel.tsx:230`), "Nada aguardando aprovação." (`gestor/web/pages/aprovacoes-page.tsx:63`), "Nenhum alerta." (`alertas-page.tsx:77`). A tabela vazia ainda desenha o cabeçalho das colunas.

**Regra.**
1. Lista sem linha: o `TabelaDados` não desenha a tabela e mostra o `EstadoVazio` (quadro tracejado, frase centralizada).
2. Duas frases só: **com filtro** "Nenhum <item> com esses filtros." (sem botão: o "Limpar filtros" já está na barra de filtros, §P4); **sem filtro** "Nenhum <item> cadastrado." (ou "ainda") + o botão de criar, se o perfil pode.
3. Sem ilustração, sem explicação de como o sistema funciona, sem `Notice`.

**Texto final.** "Nenhum pedido com esses filtros." · "Nenhum cliente com esses filtros." · "Nenhuma transportadora cadastrada." + "Nova transportadora" · "Nenhum alerta." (sem filtro e sem ação).

**Mudam:** todas as listas (§P11).

### §P8. Formulário na gaveta
**Hoje.** O formulário de transportadora abre como **quadro no meio da página**, entre os filtros e a lista (`transportadoras-page.tsx:144-170`): a lista desce, o "Salvar" fica longe do título e quem estava no fim da lista perde o lugar. Quatro telas têm um `Campo` local, cada um com a sua classe (`transportadoras-page.tsx:262`, `formas-pagamento-page.tsx`, `core/web/components/usuarios/usuarios-page.tsx`, `treinamento/web/pages/trilha-editar-page.tsx`), e os erros aparecem só como texto vermelho.

**Regra.**
1. Criar e editar um item de cadastro abre a **gaveta da direita** (`Drawer`, 560 px), com a lista atrás, escurecida. Título: "Nova <item>" ou "Editar <item>"; sem subtítulo.
2. Botões no **rodapé fixo** da gaveta (`rodape`): "Cancelar" (secundário) e **"Salvar"** (principal) à direita. Um principal só. Enquanto salva: "Salvando…" e o botão desligado.
3. Campos com `CampoFormulario` e `CLASSE_CAMPO` (42 px): rótulo em cima, "(opcional)" só no que não é obrigatório, erro embaixo com o ícone de alerta e `aria-invalid` no controle. Uma coluna; duas só para pares curtos (Inscrição estadual e Telefone).
4. Erro de campo aparece depois da primeira tentativa de salvar (como hoje) e some ao corrigir. Erro da API vai num `Notice` de perigo no topo do corpo da gaveta.
5. Depois de salvar: a gaveta fecha, a linha aparece na lista e o aviso no rodapé da tela diz "Transportadora salva.".
6. Formulário grande (Plano de RV, Construtor de pesquisa, Editar trilha) continua em página própria, com o mesmo `CampoFormulario` e a barra de botões fixa embaixo.

**Texto final (Nova transportadora).** Campos: "Nome", "CNPJ", "Inscrição estadual (opcional)", "Telefone (opcional)". Erros (os de `validarForm`, sem mudança): "Informe o CNPJ com 14 dígitos.", "CNPJ inválido: confira os dígitos.". Botões: "Cancelar", "Salvar".

**Mudam:** Transportadoras, Formas de pagamento, Filiais, Motivos, Fotos do PDV, Marcas, Usuários (gaveta já existe; trocar o `Campo` local), Regras de alerta, Cadastros de trade.

### §P9. Sem texto de explicação, de garantia ou de funcionamento
**Hoje.**
- Transportadoras, quadro "Padrão do frete da empresa" (`transportadoras-page.tsx:112-126`): "CIF: a empresa paga e o frete está no preço (sem transportadora). FOB: o cliente paga e o vendedor informa a transportadora. O pedido nunca tem valor de frete." e "Para mudar o padrão, fale com o suporte: a edição de parâmetros pelo BKO chega em uma próxima atualização.".
- Farol: a legenda das faixas e "Positivação pelos pedidos do Vendedor." (`farol-page.tsx:272-284`, `lib/farol.ts:74-78`), entre os KPIs e a tabela.
- Licenças: "Vale para os aparelhos no próximo sync." (`licencas-page.tsx:60`).
- Toast "Transportadora inativada: não aparece mais para o vendedor escolher." (`transportadoras-page.tsx:70`).

**Regra.** Sai todo texto que o usuário não usa para decidir ou agir agora: como o sistema funciona, o que acontece por trás, promessa de versão futura, garantia. Fica: rótulo, valor, erro com a ação que resolve, confirmação curta.

**Texto final.** Frete: o quadro vira o selo `neutral` "Frete padrão: CIF" (`text-ink-3 bg-neutral-soft`; MC-0057: é informação, não situação boa) ao lado do título da página (`badge` do `PageHeader`), sem a explicação e sem o "fale com o suporte". Farol: as faixas ficam na gaveta "Parâmetros do farol" (onde se mudam). Licenças: "Promotor ativado." Toast: "Transportadora inativada.".

**Mudam:** Transportadoras, Farol, Licenças e os subtítulos da §P1 (a maioria deles é texto de explicação).

### §P10. Mapa único dos módulos
**Hoje.** Três mapas de nome de módulo e telas que mostram o id:
- `licencas-page.tsx:167` mostra o id na tabela ("vendedor", "integracao") e no diálogo "Ativar vendedor?" (`:212`);
- `apps/web/components/portal/passo-empresa.tsx:34` tem o próprio `ROTULO_MODULO` (nome e frase), usado em `tela-empresa.tsx:167`, `tela-empresas.tsx` e `cartao-equipe.tsx`;
- `packages/ui/src/web/adicionais.tsx` (MC-0042) tem nome e ícone dos adicionais, com "Promotor Avulso".

**Regra.**
1. Uma fonte só: `modulos.tsx` (id → nome → ícone → frase de valor). Ícones de Promotor, Pesquisa e Treinamento já são os mesmos de `icons.tsx` (MC-0042), um desenho por módulo.
2. Nenhuma tela mostra o id. Core, Catálogo e Integração são **nativos**: entram em toda empresa e **não aparecem** em lista de módulos (licenças, perfis, portal); `modulosContrataveis()` já filtra e ordena.
3. Ligar e desligar módulo usa o `CartaoDeModulo` (ícone, nome, frase de valor e interruptor Sim/Não).

**Texto final.** Nomes: Gestor, Pesquisa, Promotor, Treinamento, Vendedor (nativos: Catálogo, Core, Integração com o ERP). Frases de valor só dos contratáveis (RD-0370): Gestor "Equipe, aprovações e indicadores.", Pesquisa "Questionários na visita, com fotos e resultados.", Promotor "Gôndola, share, preço, ruptura e validade no PDV.", Treinamento "Trilhas, quizzes e ranking para a equipe de campo.", Vendedor "Pedidos e orçamentos no app.". Os nativos ficam sem frase (não aparecem em lista).
Nome do adicional: "Promotor" em todo lugar, com "avulso" só na linha do preço (recomendação da marca, usada por ora; decisão e da §P13). `adicionais.tsx` lê nome e ícone de `modulos.tsx` (RD-0366): um mapa só.
Ícones: todos em `icons.tsx` (`IconVendedor`, `IconGestor`, `IconPromotor`, `IconPesquisa`, `IconTreinamento`, `IconCore`, `IconCatalogo`, `IconIntegracao` e o `IconMais` do "⋯"), com um traço só, 1,9 (RD-0367); `modulos.tsx` só mapeia o id ao ícone.

**Mudam:** Licenças, Perfis (módulos do perfil), gaveta de Novo usuário, portal (`passo-empresa.tsx`, `tela-empresa.tsx`, `tela-empresas.tsx`, `cartao-equipe.tsx`).

### §P11. Quem aplica (depois da aprovação do Alexandre)
Cada dono aplica nas próprias páginas, **um PR por dono**, com print 1366×768 antes/depois de cada tela para o corretor e a validação da marca. O kit não muda o comportamento de quem ainda não usa (o `subtitle` continua aceito até a tela sair dele). Legenda: S = §P1 (subtitle e ações), T = §P2/§P3 (tabela e "⋯"), B = §P4, Z = §P5, C = §P6/§P7 (contagem e vazio), F = §P8, X = §P9, M = §P10.

| Dono | Arquivos (`.../web/`) | O que muda |
|---|---|---|
| modulo-vendedor | `components/orders/orders-page.tsx`, `approvals-panel.tsx`, `order-drawer.tsx`, `status.tsx` | S, T, B, Z, C (Pedidos é o piloto: simulação da §P12). A rota da lista devolve a quantidade e a soma do filtro inteiro, sem os pendentes (§P6, regras 3 e 6) |
| modulo-vendedor | `pages/transportadoras-page.tsx`, `pages/formas-pagamento-page.tsx`, `pages/alcadas-page.tsx` | S, T, B, C, F, X (Transportadoras: simulação da §P12) |
| modulo-core | `components/farol/farol-page.tsx` (+ `farol-parametros-panel.tsx`, `curvas-abc-parametros-panel.tsx` na gaveta "Parâmetros do farol") | S, T, B, C, X (simulação da §P12) |
| modulo-core | `components/usuarios/usuarios-page.tsx`, `perfis/perfis-page.tsx`, `licencas/licencas-page.tsx`, `aparelhos/aparelhos-page.tsx` | S, T, Z, C, F, M |
| modulo-core | `carteira`, `produtos` (+ `medidas-panel.tsx`), `cliente360`, `coordenadas`, `recados`, `visitas` (+ `etapas-dialog.tsx`), `motivos`, `fotos-pdv`, `metas`, `metas-produtividade`, `plano-rv` (+ `plano-rv-editor.tsx`), `indicadores`, `routes`, `filiais`, `tarefas`, `calendario` | S, T, B, C, F (metas, calendário e editor do Plano de RV ficam com `TableScroll`: grade de números) |
| modulo-gestor | `pages/alertas-page.tsx`, `ranking-page.tsx`, `painel-page.tsx`, `regras-page.tsx`, `aprovacoes-page.tsx` | S, T, Z, C |
| modulo-catalogo | `pages/catalogo-page.tsx`, `marcas-page.tsx`, `tabelas-preco-page.tsx` | S, T, B, C, F |
| modulo-integracao | `components/monitor-page.tsx`, `lote-drawer.tsx`, `carga-arquivo-page.tsx`, `mapeamento-panel.tsx`, `conectores-panel.tsx`, `lotes-panel.tsx`, `inativacoes-panel.tsx` | S, T, Z, C |
| modulo-pesquisa | `pages/construtor-page.tsx`, `resultados-page.tsx`, `questionarios-page.tsx` | S, T, C, F |
| modulo-promotor | `pages/cadastros-page.tsx`, `trade-page.tsx` | S, T, C, F |
| modulo-treinamento | `pages/trilhas-page.tsx`, `trilha-editar-page.tsx` | S, T, B, C, F |
| engenheiro-apps | `apps/web/components/audit/audit-page.tsx`, `later-page.tsx`, `app/(bko)/page.tsx` | S, T, B, C |
| engenheiro-apps | `apps/web/components/portal/passo-empresa.tsx` (`ROTULO_MODULO` sai), `tela-empresa.tsx`, `tela-empresas.tsx`, `tela-diagnosticos.tsx`, `aba-integracao.tsx`, `cartao-equipe.tsx` | S, T, B, M |
| testes | e2e do BKO (`tests/e2e/bko/`) | trocar as asserções de texto que saem (subtítulos, "Nada pendente.", "Pedidos · 0", rótulos acima da busca) pelos novos; os `data-testid` das telas ficam |
| design-de-marca | — | validar os ícones dos módulos (§P10) e as simulações da §P12 antes do lote |

### §P12. Simulações (1366×768, escala 2, Archivo e IBM Plex de `apps/web/app/fonts/`)
Mesmo shell das simulações da §M (menu de 240 px, grupo da tela aberto). Dados fictícios. Os `.html` ao lado dos PNG "depois" são a fonte da simulação (Chrome sem janela, 1366×768, escala 2); os "antes" ficam como registro.

| Arquivo (`docs/design/telas/bko-revisao/`) | O que mostra |
|---|---|
| `pedidos-vazio-antes-1366x768.png` | Pedidos hoje, sem pedidos no filtro: o zero 3 vezes e "Aguardando aprovação · 0" com "Nada pendente." |
| `pedidos-vazio-depois-1366x768.png` | O mesmo filtro depois: `h1` só "Pedidos", busca com lupa, ações no "⋯", sem quadro de pendências e sem quadro em volta do vazio, "Nenhum pedido com esses filtros." uma vez |
| `pedidos-lista-antes-1366x768.png` | Pedidos hoje com dados: subtítulo-contador, tabela com rolagem lateral ao lado das pendências, status + faturamento |
| `pedidos-lista-depois-1366x768.png` | Depois (opção a da decisão h): pendências em cima, a lista sem os pendentes e sem título, "Pedidos · 137" e o total do filtro no `h1`, selo único, "⋯" aberto com o foco do teclado no primeiro item |
| `clientes-antes-1366x768.png` | Farol de clientes hoje: subtítulo, 3 botões, 6 KPIs, legenda; a lista de clientes não aparece na primeira tela |
| `clientes-depois-1366x768.png` | Depois: busca primeiro, sem o select "Farol", KPI "Vermelhos" marcado filtrando a lista, "Positivação 62%" na cor da faixa, aba "Clientes" sem contagem, "Vendedores · 8", colunas Cliente · Vendedor · Dias sem compra · Farol · ⋯ e a data da última compra no `title` |
| `transportadora-form-antes-1366x768.png` | Nova transportadora hoje: quadro do frete com explicação, formulário no meio da página |
| `transportadora-form-depois-1366x768.png` | Depois: gaveta da direita com rodapé fixo (Cancelar, Salvar), erro de CNPJ embaixo do campo, "Transportadoras e frete · 5" no `h1` com o selo `neutral` "Frete padrão: CIF", lista sem título |

### §P13. Decisões em aberto (Alexandre)
a. **Atualizar e Exportar CSV no "⋯" da página** (§P1): a página fica só com o botão de criar à vista.
b. **Pendências só com item** (§P6): "Aguardando aprovação" some quando não há pedido pendente.
c. **Farol** (§P2, §P4, §P6, §P9): abas Clientes e Vendedores no lugar de dois quadros; os KPIs filtram e o select "Farol" sai; "Positivação 62%" na cor da faixa, sem selo; colunas Cliente · Vendedor · Dias sem compra · Farol (saem Última compra, Positivado e Documento); legenda das faixas e parâmetros na gaveta "Parâmetros do farol"; sai o KPI "Clientes na carteira" (o número está na aba).
d. **Formulário na gaveta** (§P8) em vez do quadro no meio da página.
e. **Nome do adicional**: "Promotor" em todo lugar, com "avulso" só na linha do preço (recomendação da marca, já no kit), ou "Promotor Avulso". O kit tem um mapa só (`adicionais.tsx` lê de `modulos.tsx`): a decisão muda uma linha.
f. **"Período" num campo só** (§P4) no lugar de "De" e "Até": pede um seletor de intervalo de datas no kit (`packages/ui`), feito depois da aprovação.
g. **"Desc." sai da lista de Pedidos** (§P2): o desconto fica no detalhe do pedido e no cartão da aprovação.
h. **Pedido pendente num lugar só** (§P6, RD-0363). Hoje ele aparece no quadro de pendências e na lista.
   - Opção (a): o quadro de pendências fica, com Aprovar e Rejeitar à vista; a lista, a contagem e o total não trazem os pendentes, e o select "Situação" não oferece "Aguardando aprovação".
   - Opção (b): o quadro sai; o pendente fica na lista com o selo "Aguardando aprovação", e Aprovar e Rejeitar vão para o "⋯" da linha.
   - **Recomendo a (a).** Aprovar é a ação mais urgente da tela e segura o faturamento: com o quadro, fica a 1 clique, com o desconto, a alçada e o tempo de espera à vista para decidir. Na (b), vira 2 cliques, sem esse contexto na linha, e o pendente se perde entre os outros pedidos, na ordem de data. O quadro já some sem pendência (decisão b), então não ocupa espaço à toa. As simulações da §P12 seguem a (a).
