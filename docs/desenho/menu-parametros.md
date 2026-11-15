# Desenho — Menu do BKO com Parâmetros (ADR 0058)

Origem: R-20261115-113500, -121000, -122000. Spec aprovada: `docs/design/menu-parametros/spec.md` (branch `nuvem/menu-parametros-designer-ux`, 3040e94). Decisão: [ADR 0058](../decisoes/0058-menu-do-bko-vitrine-item-direto-e-parametros.md). Corte: v1.0.13.

## 1. Contrato do SDK (engenheiro-software, `packages/platform-sdk/src/shell.ts`)
- `GRUPOS_MENU`/`GrupoMenu`: `acesso`, `analise`, `cadastros`, `comunicacao`, `operacao`, `parametros`, `pesquisa`, `produtos`, `sistema`, `trade`, `treinamento`. `GrupoDeclarado` aceita ainda `administracao`, `comercial` e `conteudo_campo` (deprecados).
- `GRUPOS_FIXOS_NO_FIM = ['parametros', 'sistema']` e `compararGrupoMenu({ id, titulo }, { id, titulo })`.
- `SECOES_PARAMETROS`/`SecaoParametros`/`ROTULO_SECAO_PARAMETROS`: `acesso`, `alertas`, `calendario`, `clientes`, `inicio`, `metas-e-rv`, `pedidos`, `pesquisa`, `produtos`, `trade`, `treinamento`, `visitas`.
- `VITRINE_SEM_LICENCA`: `pesquisa` → grupo/seção `pesquisa`; `promotor` → `trade`; `treinamento` → `treinamento`.
- `ModuloShell.paineisParametros?: PainelParametros<C>[]`; `PainelParametros<C> = { id; secao: SecaoParametros; titulo; ordem?; perfis?; acao?; caminhosAntigos?: readonly string[]; componente }`.
- `ContextoShell.modulosContratados?: readonly ModuloId[]`.
- `ItemNavegacao.bloqueado?: boolean`.
- `VisaoShell.parametros: SecaoParametrosVisivel<C>[]` (`{ secao, rotulo, caminho, bloqueado, paineis }`), `PainelParametrosVisivel<C>` (`{ modulo, id, titulo, ancora, testID, origem: 'painel' | 'pagina', componente }`) e `VisaoShell.destinoParametros(caminho): string | null`.
- Transição (`TRANSICAO_GRUPO`): o menu final já sai certo sem mudar os módulos; cada módulo migra no seu PR e a linha deixa de valer sozinha.

## 2. O que cada dono faz

### engenheiro-apps (`apps/web`) — base: este branch (`nuvem/menu-parametros-engenheiro-software`)
- `lib/menu-bko.ts`: ordenar grupos com `compararGrupoMenu`; D9: grupo com 1 item vira item direto (rótulo do grupo, `href` do item); grupo com todos os itens `bloqueado` vira entrada bloqueada (cadeado `IconLock` 14 px no lugar da seta, `aria-disabled="true"`, `tabindex="0"`, `aria-describedby`, balão "Contrate o módulo para usar" no hover, foco e clique; não abre nem navega); item "Parâmetros" (item direto, testID `nav-plataforma-parametros`) quando `visao.parametros` não for vazio, `href` `/parametros`.
- `components/app-shell.tsx`: `SHELL_WEB.montar({ ..., modulosContratados })` com `modulos_contratados` de `/v1/me/modulos` (ausente: não passar); antes de procurar a página, `visao.destinoParametros(caminho)` → `router.replace` (links antigos: `/perfis`, `/motivos`, `/fotos-pdv`, `/plano-rv`, `/alcadas`, `/regras-alerta`, `/usuarios-e-modulos`).
- Rota `/parametros/[secao]` (e `/parametros` → primeira seção não bloqueada): título "Parâmetros"; lista de seções à esquerda (200 px, `visao.parametros` na ordem dada; selecionada com a barra `accent`; bloqueada em `#5B6673` com cadeado); à direita os `paineis` empilhados: `origem: 'painel'` dentro de `Panel` com `titulo` e `id={ancora}`; `origem: 'pagina'` renderiza o componente como está (sem `Panel` nem título). Seção bloqueada: só o cadeado e "Contrate o módulo para usar", sem balão.
- Testes: `lib/menu-bko.test.ts` e `lib/menu-formas-pagamento.test.ts` (Formas de pagamento agora em Cadastros) mudam junto com este SDK (quebram sem a mudança).

### modulo-core (`modules/core`)
- Contrato: `modulos_contratados` em `MeusModulosRespostaSchema` (seção 3).
- `web/index.ts`: `paineisParametros` com:
  - `acesso`: Perfis de acesso (id `perfis`, `acao` de hoje, `caminhosAntigos: ['perfis']`), Módulos (id `usuarios-e-modulos`, `caminhosAntigos: ['usuarios-e-modulos']`), Promotor vê pedidos;
  - `calendario`: Feriados, Janela do almoço;
  - `clientes`: Farol, Curvas ABC (saem da página Clientes);
  - `inicio`: Dias úteis e equipe parada, Frases do dia (saem da página Metas);
  - `metas-e-rv`: Plano de RV (id `plano-rv`);
  - `produtos`: Desconto máximo padrão, Medidas (saem das abas de Preço e custo; ordem 10 e 20, antes do Catálogo);
  - `visitas`: Motivos de não venda (id `motivos`), Fotos do PDV (id `fotos-pdv`), Etapa pendente (sai da página Metas).
- Tirar das páginas de origem os painéis que mudaram; tirar as páginas `perfis`, `motivos`, `fotos-pdv`, `plano-rv` e `usuarios-e-modulos` (ou deixar sem `navegacao`: o painel de mesmo id já as substitui) e os rótulos de `apps.web.menus` que sobrarem.

### modulo-vendedor (`modules/vendedor`)
- `formas-pagamento` e `transportadoras`: `grupo: 'cadastros'` (D4, D11).
- Alçadas: painel `{ id: 'alcadas', secao: 'pedidos', titulo: 'Alçadas', caminhosAntigos: ['alcadas'] }`, só os limites e só leitura (P6); tirar a página `alcadas` e o rótulo do menu.
- "Decisões recentes" das alçadas → dentro da página Pedidos (Operação › Pedidos, D5).

### modulo-gestor (`modules/gestor`)
- Regras de alerta: painel `{ id: 'regras-alerta', secao: 'alertas', caminhosAntigos: ['regras-alerta'] }` (desenho das regras na spec `nuvem/alertas-designer-ux`); tirar a página e o rótulo do menu.

### modulo-promotor (`modules/promotor`)
- Páginas `cadastros` e `trade`: `grupo: 'trade'`, `navegacao` "Cadastros" e "Indicadores" (D8; atualizar `apps.web.menus`).
- Painéis da seção `trade` só leitura (P4): Validade, Visita e coleta, Gôndola (de `GET /v1/promotor/cadastros/parametros` e `domain/parametros.ts`); sai a gaveta "Parâmetros de trade" da página de cadastros.

### modulo-pesquisa e modulo-treinamento
- Página principal com `grupo: 'pesquisa'` / `grupo: 'treinamento'` (vira item direto pela D9).
- Painéis só leitura (P4) na seção `pesquisa` (Vigência, Construtor, Fotos; `ParametrosPesquisaSchema`) e `treinamento` (Quiz e lição, XP, Níveis e ranking; `ParametrosTreinamentoSchema`), com o valor atual e "Padrão: X" só quando difere.

### modulo-catalogo
- Painel `{ id: 'catalogo', secao: 'produtos', titulo: 'Catálogo' }` com o limite da aplicação (RN-CAT-11, `aplicacao_max_cadastro`), só leitura enquanto não houver rota de gravação.

### testes
- e2e do menu: cadeado sem licença sem navegar; entrada some sem o módulo no perfil; seção bloqueada mostra o aviso; links antigos redirecionam. Ajustar `tests/e2e/bko/demo-bko.spec.ts` e `pedidos-bko.spec.ts` (`nav-core-perfis`, `nav-core-motivos`, `nav-core-plano-rv`, `nav-vendedor-alcadas` saem do menu).

## 3. Contrato pedido ao modulo-core (`modules/core/contracts/modulos.ts`)
Em `MeusModulosRespostaSchema`, campo aditivo:
```ts
/** ADR 0058: módulos contratados pela empresa (tenant_modulo ativo, sempre com o core), sem perfil nem exceções. Só exibição no BKO; não entra na versao_licencas. */
modulos_contratados: z.array(ModuloIdSchema).optional(),
```
Depois do merge, a plataforma (`apps/api/src/me-modulos.ts`, engenheiro-software) preenche com `LicencasUsuario.ativosNoTenant` em `/v1/me/modulos` (não no `/v1/sync/novidades`).

## 4. Ordem de merge
SDK (este branch) → shell (engenheiro-apps, empilhado sobre este, no mesmo lote) → módulos em qualquer ordem → contrato do Core → API.
