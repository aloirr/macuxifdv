# ADR 0050 — Grupos do menu do BKO: 9 grupos em ordem alfabética, com transição compatível

- **Status**: proposta em 2026-11-14.
- **Data**: 2026-11-14
- **Tarefa**: revisão do BKO, menu ([spec](../design/telas/bko-revisao.md), §M2 e §M6)
- **Autor**: engenheiro-software
- **Origem**: R-20261114-192700 (pedido aprovado pelo Alexandre). Altera o registro de telas da ADR 0003 (`PaginaShell.grupo`).

## Contexto
O menu do BKO tem 4 grupos (`operacao`, `cadastros`, `analise`, `administracao`), em ordem fixa e com os itens pela `ordem` de cada página. A revisão do BKO (§M2) define 9 grupos, grupos e itens em ordem alfabética e nenhum item fora de grupo. Trocar o tipo de `grupo` de uma vez quebraria os 8 módulos e o `app-shell` do web no mesmo PR, com donos diferentes.

## Decisão
1. **Os 9 grupos** ficam no SDK (`packages/platform-sdk/src/shell.ts`): `GRUPOS_MENU` = `acesso`, `analise`, `cadastros`, `comercial`, `comunicacao`, `conteudo_campo`, `operacao`, `produtos`, `sistema`; tipo `GrupoMenu`; rótulos em `ROTULO_GRUPO_MENU` (Acesso, Análise, Cadastros, Comercial, Comunicação, Conteúdo de campo, Operação, Produtos, Sistema). Página sem grupo continua em `operacao`.
2. **Ordem alfabética no BKO**: a `navegacao` do web ordena pelo rótulo do grupo e depois pelo rótulo do item, com `localeCompare('pt-BR', { sensitivity: 'base' })` (sem diferenciar acento e caixa); desempate por módulo e id. A `ordem` da página não conta no BKO. No app (Campo e Gestão) a ordem das abas não muda.
3. **Transição compatível**:
   - `PaginaShell.grupo` aceita `GrupoMenu | 'administracao'`; `'administracao'` está deprecado.
   - A tabela interna `TRANSICAO_GRUPO` (`<modulo>/<idDaPagina>` → `{ de, para }`) leva o grupo de hoje ao grupo do M2. `grupoDoMenu(modulo, pagina)` aplica a linha só se a página ainda declara o `de`; senão vale o declarado, e `'administracao'` fora da tabela vira `sistema`. Quando o módulo passa a declarar o grupo novo, a linha deixa de valer sozinha.
   - A tabela vale só no BKO: no app os ids coincidem (`core/clientes`, `gestor/alertas`, `pesquisa/pesquisas`) e as abas não mudam.
   - `ItemNavegacao` ganha `grupoMenu` (já com a transição) e `rotuloGrupo`. `ItemNavegacao.grupo` continua sendo o declarado e está deprecado.
4. **Fim da transição**: quando todos os `modules/*/web/index.ts` declararem o grupo do M2 e o `apps/web/components/app-shell.tsx` agrupar por `grupoMenu`/`rotuloGrupo`, saem a tabela, o `'administracao'` e o `semTransicao`, e `ItemNavegacao.grupo` passa a ser `GrupoMenu` (ou sai, ficando só `grupoMenu`).

### Grupo novo por módulo (o que cada dono declara em `modules/<m>/web/index.ts`)
Só as páginas cujo grupo muda; as demais já declaram o grupo do M2.

| Módulo | Página (id) | Hoje | Grupo novo |
|---|---|---|---|
| core | `usuarios` | administracao | `acesso` |
| core | `perfis` | administracao | `acesso` |
| core | `aparelhos` | administracao | `acesso` |
| core | `usuarios-e-modulos` | administracao | `acesso` (sai do menu pela §M7; o grupo só vale se voltar) |
| core | `clientes` | operacao | `cadastros` |
| core | `plano-rv` | cadastros | `comercial` |
| core | `recados` | operacao | `comunicacao` |
| core | `produtos` | cadastros | `produtos` |
| vendedor | `alcadas` | cadastros | `comercial` |
| vendedor | `transportadoras` | cadastros | `comercial` |
| vendedor | `formas-pagamento` | administracao | `comercial` |
| gestor | `alertas` | operacao | `comunicacao` |
| gestor | `regras-alerta` | administracao | `comunicacao` |
| pesquisa | `pesquisas` | cadastros | `conteudo_campo` |
| promotor | `cadastros` | cadastros | `conteudo_campo` |
| treinamento | `trilhas` | cadastros | `conteudo_campo` |
| catalogo | `catalogo` | cadastros | `produtos` |
| catalogo | `marcas` | cadastros | `produtos` |
| catalogo | `tabelas-preco` | cadastros | `produtos` |
| integracao | `monitor` | administracao | `sistema` |
| integracao | `carga-arquivo` | administracao | `sistema` |

Ficam como estão: core `carteira`, `coordenadas-sugeridas`, `motivos`, `filiais`, `fotos-pdv` (cadastros); core `metas`, `indicadores`, gestor `painel`, `ranking`, promotor `trade` (analise); core `rotas`, `visitas`, gestor `aprovacoes`, vendedor `pedidos` (operacao). A Auditoria é da plataforma (`app-shell`) e entra em Sistema pelo engenheiro-apps.

## Alternativas consideradas
- **Trocar o tipo de uma vez** (o §M6 pedia): obriga 8 módulos e o `app-shell` no mesmo PR, contra a regra de um PR por dono. Recusada.
- **Mapa fixo grupo antigo → grupo novo**: não serve, porque o mesmo grupo de hoje vai para grupos diferentes (`cadastros` vai para 5 grupos). Recusada.
- **Manter a `ordem` no BKO**: o M2 pede ordem alfabética para o usuário achar o item sem decorar a posição. Recusada; a `ordem` continua valendo só nas abas do app.

## Consequências
- Nenhum módulo quebra: o BKO já mostra os grupos novos (pela tabela) assim que o `app-shell` usar `grupoMenu`/`rotuloGrupo`. Enquanto ele agrupar por `grupo`, os títulos são os antigos e os itens já saem em ordem alfabética do grupo novo.
- Cada módulo troca o próprio `grupo` no seu PR, sem prazo comum; a linha da tabela deixa de valer sozinha.
- Grupo novo no futuro: entra em `GRUPOS_MENU` e `ROTULO_GRUPO_MENU`, com ADR.
