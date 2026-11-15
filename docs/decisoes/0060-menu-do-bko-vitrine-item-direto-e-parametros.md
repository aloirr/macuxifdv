# ADR 0060 — Menu do BKO: grupos de módulo sempre visíveis e desativados sem licença, item direto, Parâmetros fixo acima de Sistema

- **Status**: proposta em 2026-11-15.
- **Data**: 2026-11-15
- **Tarefa**: menu Parâmetros do BKO ([spec](../design/menu-parametros/spec.md), branch `nuvem/menu-parametros-designer-ux`, commit 3040e94; desenho para os donos em [docs/desenho/menu-parametros.md](../desenho/menu-parametros.md))
- **Autor**: engenheiro-software
- **Origem**: R-20261115-113500, R-20261115-121000 (D1 a D10) e R-20261115-122000 (D11), do Alexandre. Altera a ADR 0050 (grupos e ordem do menu) e a forma de exibir a RN-CORE-01/03 no BKO; registra a fonte das seções de Parâmetros.

## Contexto
O menu do BKO (ADR 0050) tem 9 grupos em ordem alfabética e esconde tudo o que o usuário não tem (RN-CORE-01/03). A simulação aprovada pede: um item único "Parâmetros" que abre `/parametros/<secao>` com os painéis de configuração de vários módulos; Pesquisa, Trade e Treinamento como entradas próprias, sempre visíveis e desativadas (cadeado) quando a empresa não contratou o módulo; grupo de uma página só vira item direto (D9); Parâmetros fixo logo acima de Sistema (D1); saem os grupos Comercial e Conteúdo de campo. O shell (engenheiro-apps) e 7 módulos (donos diferentes) mudam no mesmo corte (v1.0.13), cada um no seu PR.

## Decisão
1. **Grupos** (`packages/platform-sdk/src/shell.ts`): `GRUPOS_MENU` = `acesso`, `analise`, `cadastros`, `comunicacao`, `operacao`, `parametros`, `pesquisa`, `produtos`, `sistema`, `trade`, `treinamento` (rótulos em `ROTULO_GRUPO_MENU`: Parâmetros, Pesquisa, Trade, Treinamento para os novos). Saem `comercial` e `conteudo_campo` de `GrupoMenu`; continuam aceitos em `GrupoDeclarado` (deprecados, como `administracao`) até os módulos migrarem.
2. **Ordem** (D1): alfabética pelo rótulo (ADR 0050), com `GRUPOS_FIXOS_NO_FIM = ['parametros', 'sistema']` depois de todos, nesta ordem. Comparador único `compararGrupoMenu({ id, titulo }, …)`, usado pela `navegacao` do SDK e pelo `menu-bko.ts` do shell (aceita grupos do shell, como "Mais").
3. **Item direto** (D9): grupo com um item só no menu montado (depois do perfil, da licença e dos itens da plataforma) aparece como item direto de 1º nível, com o rótulo do **grupo** (Pesquisa, Treinamento, Parâmetros) e o `href` do item; grupo que passa a ter 2 itens volta a ser sanfona. A regra é do shell (`montarGruposMenu`), porque só ele conhece "Mais" e Auditoria; o SDK não muda a `navegacao`.
4. **Vitrine sem licença** (P3, R-20261115-113500):
   - `ContextoShell.modulosContratados?: readonly ModuloId[]` = módulos ativos no tenant (contratados pela empresa), sem o recorte do perfil. Ausente: nada fica desativado (compatível).
   - `VITRINE_SEM_LICENCA` = `pesquisa` (grupo e seção `pesquisa`), `promotor` (`trade`), `treinamento` (`treinamento`). Só esses aparecem desativados; os demais módulos (core, catalogo, vendedor, gestor, integracao) continuam sumindo sem licença, como hoje (spec §3). Módulo novo na lista: com ADR.
   - Módulo de vitrine **não contratado** e cujo `manifesto.perfis` inclui o perfil do usuário: as páginas com `navegacao` entram na `navegacao` com `bloqueado: true` (no grupo final), `visao.pagina()` devolve null para elas e a seção de Parâmetros do módulo entra com `bloqueado: true` e sem painéis. O shell mostra cadeado, `aria-disabled="true"`, não navega e mostra o balão "Contrate o módulo para usar".
   - Empresa **contratou** e o perfil (ou a exceção do usuário) não tem o módulo: some, como hoje (é permissão, não contratação).
   - **Só exibição.** A API continua revalidando a licença em toda rota (RN-CORE-01, 403 `MODULO_INATIVO`); um endereço digitado sem licença cai no estado de sem acesso que já existe.
5. **Página Parâmetros** (D3/D10):
   - Seções fixas no SDK: `SECOES_PARAMETROS` = `acesso`, `alertas`, `calendario`, `clientes`, `inicio`, `metas-e-rv`, `pedidos`, `pesquisa`, `produtos`, `trade`, `treinamento`, `visitas`, rótulos em `ROTULO_SECAO_PARAMETROS` (o id é o segmento do endereço da spec: `/parametros/metas-e-rv`). Seção nova: com ADR.
   - Fonte das seções: `ModuloShell.paineisParametros?: PainelParametros<C>[]` com `{ id, secao, titulo, ordem?, perfis?, acao?, caminhosAntigos?, componente }`. Painel não é página: não tem caminho nem item de menu. Recusamos um campo em `PaginaShell` porque o painel não tem rota própria e várias páginas de hoje (Clientes, Metas, Preço e custo) só cedem um painel e continuam no menu.
   - `VisaoShell.parametros: SecaoParametrosVisivel<C>[]` (só web): `{ secao, rotulo, caminho: 'parametros/<secao>', bloqueado, paineis }`, seções em ordem alfabética do rótulo; painéis por `ordem` (padrão 100), ordem de dependência do módulo e declaração; cada painel com `ancora` `<modulo>-<id>`, `testID` `parametros-<modulo>-<id>` e `origem`. Seção sem painel visível some (menos a bloqueada). `/parametros` abre a primeira seção não bloqueada.
   - `VisaoShell.destinoParametros(caminho)`: `/parametros/<secao>#<ancora>` para os `caminhosAntigos` dos painéis e para as páginas em transição; o shell redireciona os links antigos (`/perfis`, `/motivos`, `/fotos-pdv`, `/plano-rv`, `/alcadas`, `/regras-alerta`, `/usuarios-e-modulos`).
6. **Transição compatível** (tabela `TRANSICAO_GRUPO`, só no BKO): `<modulo>/<pagina>` → `{ de: GrupoDeclarado[], para?, secao?, ordem?, rotulo? }`, aplicada enquanto a página declarar um dos grupos de `de`.
   - Páginas que viram painel inteiro (`secao`): core `perfis` e `usuarios-e-modulos` → `acesso`; core `motivos` e `fotos-pdv` → `visitas`; core `plano-rv` → `metas-e-rv`; vendedor `alcadas` → `pedidos`; gestor `regras-alerta` → `alertas`. Até o módulo declarar o painel, a página inteira entra na seção com `origem: 'pagina'` (o shell a mostra como está, sem `Panel` nem título a mais) e sai do menu. Painel declarado com o **mesmo id** da página substitui a página.
   - Grupos: vendedor `formas-pagamento` e `transportadoras` → `cadastros` (D4, D11); pesquisa `pesquisas` → `pesquisa`; treinamento `trilhas` → `treinamento`; promotor `cadastros` → `trade` com o rótulo "Cadastros" e promotor `trade` → `trade` com o rótulo "Indicadores" (D7, D8); as linhas da ADR 0050 que já valiam continuam.
   - Fora da tabela: `administracao` → `sistema`; `comercial` e `conteudo_campo` → `cadastros`.
7. **API**: `GET /v1/me/modulos` ganha `modulos_contratados` (aditivo, opcional; contrato do Core, pedido ao modulo-core): `z.array(ModuloIdSchema).optional()` = `plataforma.tenant_modulo` ativo do tenant (sempre com o `core`), sem o perfil nem as exceções; **não** entra na `versao_licencas` (contratar um módulo que o perfil não usa não pode forçar a carga inteira do app). A plataforma (`apps/api/src/me-modulos.ts`, engenheiro-software) preenche com `LicencasUsuario.ativosNoTenant` depois do contrato; o shell web passa o campo como `modulosContratados`.
8. **Fim da transição**: com todos os módulos declarando o grupo final e os painéis, saem a tabela, `administracao`, `comercial`, `conteudo_campo`, a `origem: 'pagina'` e o `ItemNavegacao.grupo`.

### Texto proposto para a RN-CORE-03 (doc 03; o dono é o gerente-projetos)
> **RN-CORE-03** Um módulo só aparece se suas dependências estão ativas; funcionalidades que usam extensão opcional (ex.: "pedido em nome" precisa do Vendedor) somem sem erro quando o módulo provedor está inativo. **Exceção de exibição no BKO (ADR 0060):** Pesquisa, Trade (Promotor) e Treinamento, quando a **empresa** não contratou o módulo, aparecem no menu e em Parâmetros desativados, com cadeado e "Contrate o módulo para usar", sem abrir nada; com a empresa licenciada e o perfil sem o módulo, somem como os demais. A exibição não libera acesso: a API revalida a licença em toda rota (RN-CORE-01).

A RN-CORE-01 não muda de texto (o cálculo dos efetivos é o mesmo); só ganha a remissão à exceção da RN-CORE-03.

## Alternativas consideradas
- **Mostrar desativado todo módulo não contratado** (Pedidos, Catálogo, Integração…): a spec decidiu só Pesquisa, Trade e Treinamento (§3, "como hoje" para core, vendedor e gestor). Recusada; a lista `VITRINE_SEM_LICENCA` cresce por ADR.
- **`PaginaShell.secaoParametros`**: obrigaria um caminho e uma rota falsa por painel, e não serve para as páginas que só cedem um painel. Recusada.
- **Slot de extensão `parametros.secoes` do Core**: o slot é do Core e não carrega licença de módulo não contratado (item de módulo inativo nem entra). Recusada; o SDK monta as seções como monta a `navegacao`.
- **Trocar o tipo de uma vez, sem transição**: quebraria 7 módulos e o shell no mesmo PR. Recusada (mesmo motivo da ADR 0050).
- **Calcular o item direto no SDK**: o SDK não conhece o grupo "Mais" nem a Auditoria do shell. Recusada.

## Consequências
- Com este SDK e o shell novo, o menu final já aparece sem mudança nos módulos (pela tabela): Parâmetros com as páginas inteiras em transição, Trade com Cadastros e Indicadores, Pesquisa e Treinamento como itens diretos.
- Os testes do shell web que esperam Comercial e Conteúdo de campo (`apps/web/lib/menu-bko.test.ts`, `menu-formas-pagamento.test.ts`) e os e2e do BKO que clicam em `nav-core-perfis`, `nav-core-motivos`, `nav-core-plano-rv` e `nav-vendedor-alcadas` (`tests/e2e/bko/demo-bko.spec.ts`, `pedidos-bko.spec.ts`) mudam junto: o PR do engenheiro-apps entra empilhado sobre este (mesmo lote), e o testes ajusta os e2e.
- O cadeado depende de `modulos_contratados` na API; até lá, nada aparece desativado e o comportamento é o de hoje (some).
- Parâmetros de Pesquisa, Trade e Treinamento ficam só leitura (P4) até cada módulo ter rota de gravação (lote futuro).
