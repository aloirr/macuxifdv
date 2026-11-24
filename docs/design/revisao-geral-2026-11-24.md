# Revisão geral de UX das telas — 24/11/2026 (designer-ux)

Pedido do Alexandre: R-20261124-091113 e R-20261124-094002, item 3. Esta sessão só audita: nenhum código foi alterado.
Revisão feita em 24/11/2026, à noite (horário de Manaus).

**Material usado**
- **BKO e portal config.:** prints de 1366 px do stack local com o seed de demonstração (tenant "Distribuidora Exemplo", dados fictícios). Os prints citados estão em `docs/design/revisao-geral-2026-11-24/`, com o nome original.
- **App Campo e Gestão:** o app não roda na web (o expo-sqlite pede wasm). A revisão usou o código (`modules/*/app`, `apps/mobile/src`, `packages/ui/src/mobile`) e os prints que já estão em `docs/` (`docs/modulos/*/prints`, `docs/design/telas`).
- **PDFs e e-mails:** código (`modules/vendedor/domain/pdf-pedido.ts`, `packages/platform-sdk/src/email/modelos.ts`) e prints em `docs/design/telas/T-0159-*` e `docs/design/emails/`.
- **Os prints foram tirados num Chromium em inglês.** Por isso os campos de data nativos aparecem como `mm/dd/yyyy` e `November 2026`. Isso vira o achado UX-01, porque o cliente com navegador ou Windows em inglês vê a mesma coisa.

**Fora do escopo:**
- Parâmetros (a S3 já corrige).
- Os temas que já estão na fila do gerente, marcados como "já na fila" quando aparecem.

**Gravidade:**
- **alta:** leva a erro de leitura ou de decisão, ou fere uma regra inegociável;
- **média:** atrapalha o uso ou quebra a consistência de forma visível;
- **baixa:** é acabamento.

---

## A. Transversais (componentes de `packages/ui` e padrão de todas as telas)

**UX-01 — Campos de data e mês no formato do navegador** · média
- **O que está errado:** os campos de data aparecem como "mm/dd/yyyy" e "November 2026" em Pedidos (Período), Trade (De/Até), Metas, Indicadores e Clientes (Mês), Visitas, Painel da equipe, Nova trilha e Cadastros de trade (Vigência). Prints: `bko-pedidos.png`, `bko-trade.png`, `bko-metas.png`, `bko-visitas-detalhe.png`, `bko-trade-cadastros-novo.png`. Todos são `<input type="date|month">` nativos.
- **Dono:** designer-ux (`packages/ui/src/web/ui.tsx`: falta o componente) e os donos das telas.
- **Correção:** criar `CampoData` e `CampoMes` em pt-BR em `packages/ui/src/web` (dd/mm/aaaa, "novembro de 2026", calendário próprio) e trocar os nativos.

**UX-02 — Barra de filtros com rótulos e alturas diferentes** · média
- **O que está errado:** cada tela monta o filtro de um jeito.
  - Usuários: busca com rótulo "Buscar" próprio, campo de 44 px, sem lupa e sem placeholder (`bko-usuarios.png`).
  - Aparelhos: "Buscar por usuário ou aparelho" em 13 px negrito preto, ao lado de "Situação" em 12 px cinza, desalinhados (`bko-aparelhos.png`).
  - Metas e Indicadores: o rótulo "Mês" é diferente dos outros.
  - Pedidos, Transportadoras e Catálogo seguem o padrão: `CampoBusca` com lupa e selects de 38 px.
- **Dono:** modulo-core: `modules/core/web/components/usuarios/usuarios-page.tsx:431`, `modules/core/web/components/aparelhos/aparelhos-page.tsx:92`.
- **Correção:** usar `CampoBusca`, `SelectField` e `TextField` de `packages/ui/src/web/ui.tsx:61-110` em todas as barras, sem rótulo montado na mão.

**UX-03 — Data e hora escritas de quatro jeitos** · média
- **O que está errado:** o padrão do BKO é "24/11 às 17:42" (Alertas, Aprovações, Integração). As outras telas fogem dele:
  - Visitas: "23/11/2026, 15:20";
  - Recados: "24/11/2026, 21:39:08";
  - Ranking: "2026-11-01 a 2026-11-30", em formato ISO.
- **Dono:**
  - modulo-core: `modules/core/web/components/visitas/visitas-page.tsx:157`, `modules/core/web/components/recados/recados-page.tsx:168,207,208`;
  - modulo-gestor: `modules/gestor/web/pages/ranking-page.tsx:27`.
- **Correção:** usar sempre `formatDateTime(valor, sessao.fuso)` de `packages/ui`. Para o período, usar "01/11 a 30/11/2026" (ou "novembro de 2026").

**UX-04 — Contagem no título sem padrão** · baixa
- **O que está errado:**
  - com a contagem no título da página: "Pedidos · 11", "Pesquisas · 2", "Transportadoras e frete · 2";
  - com a contagem no título do painel: Filiais ("2 filiais"), Aparelhos ("0 aparelhos"), Visitas ("13 visitas");
  - sem contagem: Usuários.
- **Dono:** modulo-core (usuarios, filiais, aparelhos, visitas).
- **Correção:** a contagem vai no título da página com `rotuloComContagem` (`packages/ui/src/web/ui.tsx:145`), como em Pedidos.

**UX-05 — Ações da linha em quatro formatos** · média
- **O que está errado:**
  - "⋯": Usuários, Integração;
  - botões contornados: Filiais tem Editar, Tornar padrão e Apagar (`bko-filiais.png`); Metas tem 15 botões "Editar" ou "Definir" (`bko-metas.png`);
  - links de texto: Frases da carga, com "Editar Desativar" em 30 linhas (`config-frases-carga.png`).
  - "Apagar" não usa o estilo de perigo.
- **Dono:**
  - modulo-core: `modules/core/web/components/filiais/filiais-page.tsx:139-149` e `modules/core/web/components/metas/metas-page.tsx`;
  - engenheiro-apps: `apps/web/components/portal/tela-frases-carga.tsx`.
- **Correção:** as ações secundárias da linha vão para `MenuAcoes` (`packages/ui/src/web/menu-acoes.tsx`), com "Apagar" e "Desativar" no tom de perigo e por último. Fica à vista uma ação só por linha, quando ela é a principal.

**UX-06 — A linha realça e não abre nada** · média
- **O que está errado:** em Pedidos, clicar na linha abre a gaveta. Em Usuários, Alertas, Integração ERP, Aprovações e Visitas, a linha só realça e nada abre (os prints `*-detalhe` são iguais à lista: `bko-aprovacoes-detalhe.png`, `bko-visitas-detalhe.png`). O realce promete uma ação que não existe.
- **Dono:**
  - designer-ux: `packages/ui/src/web/tabela-dados-componente.tsx`, para realçar só quando há `aoAbrir`;
  - donos das telas: modulo-core, modulo-gestor, modulo-integracao.
- **Correção:** a linha com detalhe abre a gaveta, que no caso de Aprovações e Alertas traz as ações. A linha sem detalhe não realça.

**UX-07 — Criar um cadastro abre em três formatos** · média
- **O que está errado:**
  - gaveta à direita: Usuários, Transportadoras, Marcas, Checklist, Questionário;
  - diálogo central: Filiais, com 13 campos e sem "X" (`bko-filiais-novo.png`), e Criar rota;
  - página inteira: Nova trilha, Nova empresa.
- **Dono:** modulo-core: `modules/core/web/components/filiais/filiais-page.tsx:162-244`.
- **Correção:** cadastro vai para `Drawer` (`packages/ui/src/web/overlay.tsx:201`). A página inteira fica só para os editores longos (trilha, questionário, empresa). O diálogo fica só para confirmação ou escolha curta, como Criar rota.

**UX-08 — Abas em dois estilos** · média
- **O que está errado:**
  - Clientes, Formas e prazos, Cadastros de trade e o portal usam `Abas` sublinhadas (`bko-clientes-detalhe.png`).
  - Catálogo e Tabelas de preço usam botões cheios: a aba ativa vira um segundo botão principal escuro na tela (`bko-catalogo.png`).
- **Dono:** modulo-catalogo: `modules/catalogo/web/pages/catalogo-page.tsx:53-54` e a página de Tabelas de preço.
- **Correção:** trocar por `Abas` (`packages/ui/src/web/abas.tsx:102`).

**UX-09 — Estado vazio em três formatos e com texto errado** · média
- **O que está errado:**
  - O vazio aparece como aviso cinza com ícone (Carteira, Coordenadas sugeridas), como linha dentro da tabela (Aparelhos, Auditoria) ou como texto solto (Recados → Minha caixa).
  - O texto erra em duas telas:
    - Aparelhos, sem filtro nenhum: "Nenhum aparelho com esses filtros. Limpe a busca ou a situação para ver todos." (`bko-aparelhos.png`);
    - Auditoria, com Entidade = Todas: "Nada registrado para esta entidade." (`bko-auditoria.png`).
- **Dono:**
  - modulo-core: `modules/core/web/components/aparelhos/aparelhos-page.tsx:124`;
  - engenheiro-apps: `apps/web/components/audit/audit-page.tsx:71`.
- **Correção:** usar `EstadoVazio` (`packages/ui/src/web/ui.tsx:281`) com dois textos, "ainda não há…" (sem filtro) e "nenhum com esses filtros" (com filtro, mais a ação Limpar filtros).

**UX-10 — Largura do conteúdo muda de tela para tela** · baixa
- **O que está errado:** Catálogo para em 1.062 px, Trade em 1.280 px, Recados e Filiais param antes da borda, e o resto vai até a borda (compare `bko-recados.png` com `bko-alertas.png`).
- **Dono:** modulo-catalogo (`catalogo-page.tsx:77`), modulo-promotor (`trade-page.tsx:98`), modulo-core (recados, filiais).
- **Correção:** a largura fica a cargo do shell. A página não fixa `max-w`.

**UX-11 — "Voltar" em cinco grafias e sem trilha** · baixa
- **O que está errado:** o voltar aparece como "‹ Pesquisas", "‹ Trilhas", "‹ Fotos em lote", "‹ Voltar" (perfis) e "← Empresas" (portal). A trilha "Catálogo › Alimentos" só existe no Catálogo.
- **Dono:**
  - designer-ux: criar o componente;
  - modulo-pesquisa, modulo-treinamento, modulo-catalogo (`fotos-lote-page.tsx:354`), modulo-core (`perfis-page.tsx:321,426`), engenheiro-apps (`apps/web/components/portal/base.tsx:287`).
- **Correção:** um `LinkVoltar` em `packages/ui/src/web`, no formato "← Nome da lista", usado em todas as páginas de segundo nível.

**UX-12 — "Atualizar" com três aparências** · baixa
- **O que está errado:** é botão contornado em Clientes, Rotas, Visitas, Metas, Indicadores e Auditoria, link de texto na Integração ERP e item do "⋯" em Trade e Alertas.
- **Dono:** modulo-integracao: `modules/integracao/web/components/monitor-page.tsx:39`, mais as outras telas.
- **Correção:** "Atualizar" e "Exportar CSV" vão sempre no "⋯" do cabeçalho. No canto fica só a ação principal.

**UX-13 — Códigos internos visíveis ao cliente** · alta

| Onde | Texto que o usuário vê | Dono | Gravidade |
|---|---|---|---|
| `packages/ui/src/web/perfis.ts:61-66`: dicas do cadeado em Parâmetros → Perfis | "(RN-CORE-04)", "(RN-CORE-32)", "(RN-CORE-35)" | designer-ux | alta |
| `packages/ui/src/comum/modulos.ts:23`: nome do grupo no formulário de perfil (`bko-perfis-novo.png`) | "Core" (jargão interno) | designer-ux, com o nome confirmado pelo Alexandre | média |
| `modules/integracao/domain/catalogo-produto.ts:33,40,47,52`: avisos da carga, mostrados no lote | "(RN-CAT-09)", "(RN-CAT-11)" | modulo-integracao | média |
| `modules/vendedor/api/orcamentos.ts:57`: erro 422 que chega ao vendedor no app | "… (RN-VEN-18)" | modulo-vendedor | média |
| `modules/treinamento/api/sync.ts:35`: rejeição do envio | "(RN-TRE-04)" | modulo-treinamento | baixa |
| `apps/mobile/src/app/diagnostico-carga.tsx:193`: texto compartilhado da tela oculta | "(T-0008)" | engenheiro-apps | baixa |
| Portal → empresa → Dados no Hub | "referencia_ausente, valor_fora_da_faixa" | já na fila (aba Integração/Dados) | — |

- **Correção:** tirar o código do texto. O código continua no campo `codigo` do erro, que não aparece na tela.
- Na tela do BKO e do config, os textos extraídos (`textos-*.json`) não trazem nenhum RN-, RF-, T-, ADR ou RD-.

## B. BKO, tela a tela

### Menu lateral
**UX-14 — Item direto com cara de título de grupo** · baixa
- **O que está errado:** os itens diretos (Pesquisa, Treinamento, Parâmetros) usam a mesma tipografia dos títulos de grupo (maiúsculas, laranja) e ficam sem seta. Parecem grupos que não abrem (`bko-usuarios.png`).
- **Dono:** engenheiro-apps: `apps/web/components/app-shell.tsx` (regra D9).
- **Correção:** o item direto ganha uma marca própria (ícone ou "→") ou passa a ter o peso de subitem, e a diferença entre grupo e destino fica clara.

### Pedidos
**UX-15 — O Valor fica escondido e a coluna Ações ocupa 300 px vazia** · alta
- **O que está errado:** a tabela tem 1.610 px num espaço de cerca de 1.060 px (`bko-pedidos.png`).
  - Valor, Motivo e Observação ficam atrás da rolagem lateral.
  - "Supervisor" aparece cortado ("Super").
  - A coluna Ações, fixa à direita, ocupa 300 px e está vazia.
  - Para o executivo, o valor é o número principal da lista.
- **Dono:** modulo-vendedor: `modules/vendedor/web/lib/tabela-pedidos.ts:27-39`.
- **Correção:**
  - Valor logo depois de Cliente;
  - UF e Cidade numa coluna só;
  - Observação só na gaveta;
  - Ações vira um "⋯" de 48 px.

**UX-16 — Gaveta do pedido: documento sem máscara, rótulo obscuro, seção vazia e nenhuma ação** · média
- **O que está errado:** em `bko-pedidos-detalhe.png`:
  - "Documento do cliente 72469154000138" aparece sem máscara, enquanto a lista mascara;
  - o rótulo "Feito sem sinal" não diz nada a quem lê;
  - o cartão "Faturamento e devolução" aparece só com o título;
  - um pedido "Aguardando aprovação" não tem Aprovar nem Recusar, e os dois botões do topo são PDFs secundários.
- **Dono:** modulo-vendedor: `modules/vendedor/web/components/orders/order-drawer.tsx:88,93,142`.
- **Correção:**
  - formatar o documento com `formatarDocumento`;
  - trocar o rótulo por "Feito sem internet";
  - esconder o cartão vazio ou escrever "Ainda não faturado";
  - pôr Aprovar como principal, para quem pode aprovar, e mandar os PDFs para o "⋯".

### Usuários
**UX-17 — Coluna Módulos só com ícones de 16 px** · média
- **O que está errado:** são até cinco ícones sem texto por linha. Sem passar o mouse, não dá para saber qual é qual (`bko-usuarios.png`). Ícone sem texto fere a regra "cor e ícone sempre com texto". A linha também não abre (UX-06).
- **Dono:** modulo-core: `modules/core/web/components/usuarios/usuarios-page.tsx:59`.
- **Correção:** mostrar o nome curto do módulo em selo (ou "5 módulos", com a lista no detalhe).

### Aparelhos
- Estado vazio errado: ver UX-09.

**UX-18 — "Exportar CSV" desligado sem motivo** · baixa
- **O que está errado:** o botão aparece desligado e a tela não diz por quê.
- **Dono:** modulo-core: `aparelhos-page.tsx`.
- **Correção:** esconder o botão quando a lista está vazia.

### Produtos → Preço e custo
**UX-19 — Valores e percentuais quebram em duas linhas** · média
- **O que está errado:** aparecem "R$ / 12,47" e "15,00% / padrão" em duas linhas, em todas as linhas da tabela de 12 colunas (`bko-produtos.png`).
- **Dono:** modulo-core: `modules/core/web/components/produtos/produtos-page.tsx:127-160`.
- **Correção:** usar `TabelaDados` com `numero: true` (alinha à direita, sem quebra e com algarismos de largura fixa). O "padrão" vira selo ou nota no rodapé da coluna.

### Filiais
**UX-20 — Formulário da filial fora de ordem e estourando o diálogo** · média
- **O que está errado:** em `bko-filiais-novo.png`:
  - o CEP vem por último, depois do endereço;
  - o campo Telefone passa da borda do diálogo;
  - não há "X";
  - além disso, é um diálogo (UX-07).
- **Dono:** modulo-core: `modules/core/web/components/filiais/filiais-page.tsx:162-244`.
- **Correção:**
  - CEP primeiro, preenchendo logradouro, bairro, cidade e UF;
  - grupos "Identificação" e "Endereço";
  - abrir em gaveta.

### Transportadoras
**UX-21 — Edição sem máscara** · média
- **O que está errado:** na edição, CNPJ, IE e telefone aparecem crus (72353914000147, 9232002200), e a lista mostra formatado (`bko-transportadoras-detalhe.png`).
- **Dono:** modulo-vendedor: `modules/vendedor/web/pages/transportadoras-page.tsx:185,192`.
- **Correção:** máscara de CNPJ e telefone com `packages/ui/src/web/mascara.ts` ao digitar e ao abrir.

### Alertas
**UX-22 — Percentual no formato inglês** · alta
- **O que está errado:** aparece "Lucas Andrade está com 1.17% do ritmo…" e "0.79%" (`bko-alertas.png`). Em pt-BR, "1.17" se lê como mil cento e setenta.
- **Dono:** modulo-gestor: `modules/gestor/domain/alertas.ts:212`.
- **Correção:** formatar com `formatPct` pt-BR e uma casa ("1,2%").

**UX-23 — Mensagem e tipo cortados, sem coluna Cliente** · média
- **O que está errado:** aparecem "Cliente está sem visita há 67 dias (frequên…" e "Pedido aguardando apr…". A mensagem repete o tipo e esconde o que importa: qual cliente.
- **Dono:** modulo-gestor: `modules/gestor/web/pages/alertas-page.tsx:72-73`.
- **Correção:**
  - coluna Cliente (ou Pedido);
  - mensagem curta, sem repetir o tipo ("67 dias; frequência 30");
  - texto em até duas linhas, sem reticências.

**UX-24 — A severidade só aparece na cor** · média
- **O que está errado:** os selos "Aberto" vermelho e "Aberto" amarelo têm o mesmo texto.
- **Dono:** modulo-gestor: `alertas-page.tsx:22`.
- **Correção:** o selo diz "Crítico" ou "Atenção" (ou entra uma coluna Gravidade).

### Recados
**UX-25 — Hora no fuso do navegador** · alta
- **O que está errado:** aparece "24/11/2026, 21:39:08" quando em Manaus eram 17:39 (`bko-recados.png`). Isso fere a regra 4 (exibição no fuso do tenant).
- **Dono:** modulo-core: `modules/core/web/components/recados/recados-page.tsx:168,207,208` (`toLocaleString`).
- **Correção:** usar `formatDateTime(valor, sessao.fuso)`, sem segundos.

**UX-26 — O mesmo envio em duas tabelas** · média
- **O que está errado:** "Enviados e leitura" mostra o envio duas vezes: por envio ("0 de 1") e por pessoa ("Não lida"). Uma informação deve ficar num lugar só.
- **Dono:** modulo-core: `recados-page.tsx:141-210`.
- **Correção:** uma linha por envio, com "Lidas 0 de 1"; um clique abre as pessoas.

### Aprovações
**UX-27 — A lista não diz o que se aprova** · alta
- **O que está errado:** em `bko-aprovacoes-detalhe.png`:
  - a lista não tem Cliente nem número do pedido: quem aprova vê só o vendedor, o valor e o desconto;
  - o "⋯" sai cortado na borda, empurrado pelo selo "Vencido há 10 h úteis".
- **Dono:** modulo-gestor: `modules/gestor/web/pages/aprovacoes-page.tsx:51-56`.
- **Correção:**
  - colunas Cliente e Nº;
  - selo de prazo curto;
  - "⋯" numa coluna fixa de 48 px;
  - a linha abre o pedido com Aprovar e Recusar (UX-06).

### Visitas
**UX-28 — Fuso fixo em Manaus** · alta
- **O que está errado:** a tela usa sempre `America/Manaus`, e não o fuso do tenant. Uma empresa de São Paulo vê o check-in uma hora errado, inclusive no CSV.
- **Dono:** modulo-core: `modules/core/web/components/visitas/visitas-page.tsx:15,92,157,205`.
- **Correção:** usar `sessao.fuso`, com `formatDateTime` (UX-03).

### Metas e Indicadores
**UX-29 — Meta de venda definida em duas telas** · média
- **O que está errado:** Indicadores tem o painel "Definir vendas do mês" (`bko-indicadores.png`), e Metas também define (Editar, Definir, Meta da equipe). Uma informação deve ficar num lugar só.
- **Dono:** modulo-core: `modules/core/web/components/indicadores/indicadores-page.tsx:130-146`.
- **Correção:** Indicadores só mostra, com o link "Definir metas →" para Metas.

**UX-30 — Cabeçalho e tabela de Metas pesados** · média
- **O que está errado:** em `bko-metas.png`:
  - há quatro botões numa faixa abaixo do subtítulo, com o principal "Meta da equipe" fora do canto;
  - a tabela tem 15 botões "Editar" contornados;
  - os percentuais têm duas casas ("0,60%", "33,33%", "97,14%"), quando o padrão executivo é uma.
- **Dono:** modulo-core: `modules/core/web/components/metas/metas-page.tsx:122-139`.
- **Correção:**
  - o principal no canto do cabeçalho; Atualizar, Exportar e Copiar no "⋯";
  - Editar pelo clique na linha;
  - percentual com uma casa (inteiro a partir de 10%).

### Trade marketing
**UX-31 — Nome da loja cortado igual em todas as linhas** · alta
- **O que está errado:** todas as lojas aparecem como "Supermercado …" e não dá para distinguir uma da outra (`bko-trade.png`).
- **Dono:**
  - modulo-promotor: `modules/promotor/web/pages/trade-page.tsx:79`, a coluna sem largura;
  - designer-ux: `packages/ui/src/web/tabela-dados-componente.tsx:76`, que corta todas as células.
- **Correção:** a coluna de nome ganha largura mínima de 240 px e quebra em até duas linhas. O `TabelaDados` ganha a opção `quebra` para colunas de nome.

**UX-32 — Cartão escuro único** · baixa
- **O que está errado:** o KPI "Atingimento" aparece em cartão escuro, um destaque que não se repete em nenhuma outra tela.
- **Dono:** modulo-promotor: `trade-page.tsx:118` (`dark`).
- **Correção:** cartão normal; o destaque vem do selo Atingiu ou Abaixo.

### Cadastros de trade
**UX-33 — Abas cortadas e controles diferentes no checklist** · baixa
- **O que está errado:** em `bko-trade-cadastros-novo.png`:
  - as abas saem cortadas ("Mi…") sem sinal de que há mais;
  - a etapa usa "Remover" em texto, e Trilhas usa a lixeira;
  - a caixa "Obrigatória" é nativa, com 13 px.
- **Dono:** modulo-promotor: `modules/promotor/web/pages/cadastros-page.tsx`.
- **Correção:** abas com rolagem e sombra na borda (`Abas`), lixeira como em Trilhas e caixa de marcar de `packages/ui`.

### Pesquisas
**UX-34 — Público-alvo pede o id interno** · alta
- **O que está errado:** os campos Equipes e Clientes específicos pedem "Um id por linha" (`bko-pesquisas-detalhe.png`). O admin não conhece UUID.
- **Dono:** modulo-pesquisa: `modules/pesquisa/web/pages/construtor-page.tsx:244,247`.
- **Correção:** seletor com busca por nome ou código (cliente) e por nome (equipe), com os escolhidos em chips.

### Ranking
- Período em ISO: ver UX-03.

### Auditoria
- Vazio errado: ver UX-09.

**UX-35 — Contador ambíguo ao lado do filtro** · baixa
- **O que está errado:** "0 registros mais recentes".
- **Dono:** engenheiro-apps: `apps/web/components/audit/audit-page.tsx`.
- **Correção:** tirar a frase; a contagem vai no título (UX-04).

### Integração ERP
**UX-36 — Identificador técnico no subtítulo** · baixa
- **O que está errado:** o subtítulo mostra "erp-matriz · v1.2.1 · …", nome técnico do conector e versão.
- **Dono:** modulo-integracao: `modules/integracao/web/lib/entidades.ts:75-87`.
- **Correção:** deixar só "Última carga recebida 24/11 às 17:19". A versão fica no portal.

### Página não encontrada (BKO e portal)
**UX-37 — 404 padrão do Next, em inglês** · média
- **O que está errado:** aparece "404 This page could not be found.", sem caminho de volta (`bko-tarefas.png`). No portal a página fica em branco.
- **Dono:** engenheiro-apps: falta `apps/web/app/not-found.tsx`.
- **Correção:** página em pt-BR com "Página não encontrada" e "← Voltar ao início".

## C. Portal de configuração

**UX-38 — Ajuda do código da empresa no formato antigo** · média
- **O que está errado:** a ajuda diz "Letras minúsculas, números e hífen", e a validação diz "2 a 40 letras minúsculas…". O código agora segue o formato AM0000: a empresa listada é AM0001, e o login novo recusa o código "demo" (`config-empresas-nova.png`). Isso aparece quando o servidor está sem planos (passo legado).
- **Dono:** engenheiro-apps: `apps/web/components/portal/passo-empresa-legado.tsx:59,102,313`.
- **Correção:** alinhar ajuda, sugestão e validação ao formato do login novo, ou aposentar o passo legado.

**UX-39 — Botões do rodapé à esquerda** · baixa
- **O que está errado:** em Nova empresa, "Conferir sem gravar" e "Criar empresa" ficam à esquerda; no BKO, ficam à direita.
- **Dono:** engenheiro-apps: `passo-empresa-legado.tsx`.
- **Correção:** alinhar à direita, com o principal por último.

**UX-40 — Erro técnico e ambíguo em Diagnósticos** · baixa
- **O que está errado:** aparece "Rota não encontrada." (`config-diagnosticos.png`). No stack local a mensagem vem do portal falso; falta conferir em produção. "Rota" confunde com a rota de visitas.
- **Dono:** engenheiro-apps: `apps/web/lib/portal-falso.ts:338` e `tela-diagnosticos.tsx`.
- **Correção:** "Não deu para carregar os diagnósticos." com "Tentar de novo".

**UX-41 — A lista de empresas não mostra que a linha abre** · baixa
- **O que está errado:** a linha não tem "→" nem "⋯".
- **Dono:** engenheiro-apps: `apps/web/components/portal/tela-empresas.tsx`.
- **Correção:** "→" no fim da linha, ou o nome como link.

- Aba Integração/Dados e aba Empresa: já na fila.

## D. App Campo e Gestão (pelo código e pelos prints de `docs/`)

**UX-42 — Ficha do cliente sem ação principal** · média
- **O que está errado:** o rodapé tem Check-in e Pesquisa (depois, Checkout e Pesquisa), todos no estilo contornado (`outlineDark`). Nenhum é o principal, contra a regra "um só principal por tela". Print: `docs/modulos/core/prints/checkin/gestao-ficha-checkin-pesquisa.png`. O endereço do cabeçalho também sai cortado em uma linha ("client…").
- **Dono:** modulo-core: `modules/core/app/telas/cliente.tsx:286,298,301`.
- **Correção:** Check-in e Checkout como principal (`accent` ou grafite); Pesquisa como secundário. O endereço em até duas linhas.

**UX-43 — Chip de filtro selecionado com pouco contraste** · baixa
- **O que está errado:** o chip "Todos" selecionado é só cinza claro sem borda e se distingue pouco dos outros, inclusive no sol. Print: `docs/modulos/vendedor/prints/2026-11-14-pedidos-sem-novo/depois-360x800.png`.
- **Dono:** designer-ux: `packages/ui/src/mobile/filtro.tsx`.
- **Correção:** o selecionado em grafite com texto branco (ou borda de 2 px no destaque), mais a marca de seleção.

**UX-44 — Percentual em vermelho perto da meta** · baixa
- **O que está errado:** no Início do Campo, 93% (Visitas e Itens/pedido) aparece em vermelho, que se lê como problema. Print: `docs/modulos/core/prints/inicio-enquadrado/inicio-360x640-fonte-1_15.png`.
- **Dono:** modulo-core: `modules/core/app/telas/inicio/`.
- **Correção:** confirmar a regra da cor. Se o vermelho é "abaixo do ritmo", o cartão diz isso em texto ("abaixo do ritmo").

**Alvos de toque (sem achado):** os botões de menos de 44 dp do app (copiar código de 28 dp, estoque de 32 dp, −/+ de 32 dp, Desfazer de 36 dp) têm `hitSlop` ou área externa que leva o alvo a 44 dp ou mais.

## E. PDFs e e-mails

**UX-45 — Duas cores de destaque e nenhum rodapé no PDF do pedido** · baixa
- **O que está errado:** no PDF do pedido (cliente), o rótulo "PEDIDO" sai no laranja da Macuxi, ao lado do verde da empresa no cabeçalho da tabela. São duas cores de destaque no documento do cliente. Também falta rodapé com página ("1 de 1") e data e hora de emissão. Print: `docs/design/telas/T-0159-pdf-horizontal-cliente.png`.
- **Dono:** modulo-vendedor: `modules/vendedor/domain/pdf-pedido.ts`. Precisa da validação do design-de-marca.
- **Correção:** "PEDIDO" na cor da empresa ou em grafite, e rodapé com página e emissão.

**UX-46 — Print de referência do e-mail desatualizado** · baixa
- **O que está errado:** o print do e-mail de acesso mostra o código "EXEMPLO", no formato antigo (`docs/design/emails/redefinir-senha/`).
- **Dono:** designer-ux.
- **Correção:** refazer o print com o código AM0000.
- O botão copiar no e-mail de acesso já está na fila.

---

## Resumo por dono

| Dono | Alta | Média | Baixa | Achados |
|---|---|---|---|---|
| modulo-core | 2 (UX-25, UX-28) | 11 (UX-02, UX-05, UX-07, UX-09, UX-17, UX-19, UX-20, UX-26, UX-29, UX-30, UX-42) | 4 (UX-04, UX-10, UX-18, UX-44) | 17 |
| modulo-gestor | 2 (UX-22, UX-27) | 3 (UX-03 ranking, UX-23, UX-24) | — | 5 |
| modulo-vendedor | 1 (UX-15) | 3 (UX-13 orçamento, UX-16, UX-21) | 1 (UX-45) | 5 |
| modulo-promotor | 1 (UX-31) | — | 3 (UX-10, UX-32, UX-33) | 4 |
| modulo-pesquisa | 1 (UX-34) | — | 1 (UX-11) | 2 |
| modulo-catalogo | — | 1 (UX-08) | 2 (UX-10, UX-11) | 3 |
| modulo-integracao | — | 1 (UX-13 avisos da carga) | 2 (UX-12, UX-36) | 3 |
| modulo-treinamento | — | — | 2 (UX-11, UX-13) | 2 |
| engenheiro-apps | — | 3 (UX-09 auditoria, UX-37, UX-38) | 8 (UX-05 frases, UX-11, UX-13 diagnóstico, UX-14, UX-35, UX-39, UX-40, UX-41) | 11 |
| designer-ux (`packages/ui`, `docs/design`) | 1 (UX-13 perfis.ts) | 3 (UX-01, UX-06, UX-13 "Core") | 3 (UX-11 LinkVoltar, UX-43, UX-46) | 7 (+ UX-31 no `TabelaDados`) |

**Total: 46 achados.**
- **Por gravidade:** 8 de gravidade alta (UX-13, UX-15, UX-22, UX-25, UX-27, UX-28, UX-31, UX-34), 21 média, 17 baixa.
- **Por superfície:**
  - transversais: 13;
  - BKO: 24;
  - portal: 4;
  - app: 3;
  - PDF e e-mail: 2.
- Um achado transversal pode ter mais de um dono.

**Ordem sugerida:**
1. Os de gravidade alta: fuso (UX-25, UX-28), número em inglês (UX-22), o que se aprova (UX-27), o valor escondido em Pedidos (UX-15), lojas indistinguíveis (UX-31), id interno na pesquisa (UX-34), códigos RN na tela (UX-13).
2. Os componentes de `packages/ui` que destravam vários achados de uma vez: `CampoData`, `LinkVoltar`, `TabelaDados` com `quebra` e realce só com `aoAbrir`.
