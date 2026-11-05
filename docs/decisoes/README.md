# Decisões de arquitetura (ADR)

Índice das ADRs do Macuxi FDV. Cada ADR traz contexto, decisão, alternativas e consequências. O status abaixo repete o
da própria ADR; em caso de divergência, vale o arquivo da ADR.

| ADR | Título | Status |
|---|---|---|
| [0001](0001-monorepo-modular-e-fronteiras.md) | Monorepo modular: workspace, pacotes base e fronteiras no CI | aceita |
| [0002](0002-dinheiro-e-calendario-em-packages-comum.md) | Dinheiro e calendário em `packages/comum` | aceita |
| [0003](0003-motor-de-sync-e-registro-de-telas-no-platform-sdk.md) | Motor de sync e registro de telas dos módulos no `platform-sdk` | aceita |
| [0004](0004-permissao-por-acao-no-manifesto.md) | Permissão por ação declarada no manifesto | aceita |
| [0005](0005-dono-do-cadastro-de-produto.md) | Dono do cadastro de produto: Core (base) e Catálogo (preço, estoque, conteúdo e busca) | aceita |
| [0006](0006-api-modular-rotas-declarativas-e-horizonte-do-pull.md) | API modular: rotas declarativas no platform-sdk, `createApp` e horizonte seguro do pull | aceita |
| [0007](0007-despacho-da-outbox-com-macuxi-worker.md) | Despacho da outbox entre tenants com o papel `macuxi_worker` | aceita · implementada na T-0022 |
| [0008](0008-erros-de-modulo-sessao-nos-shells-e-camera.md) | Erro HTTP de módulo, sessão real nos shells (com modo demonstração) e câmera no app | aceita |
| [0009](0009-sync-de-escrita-escopo-e-entidades-sem-provedor.md) | Sync de escrita e de escopo: comandos push-only, sobreposição da fila, versão do escopo e entidade sem provedor | proposta |
| [0010](0010-fotos-e-arquivos-enviados-pelo-aparelho.md) | Fotos e arquivos enviados pelo aparelho: rota de plataforma, metadados em `plataforma.arquivo` e bytes atrás de porta | proposta |
| [0011](0011-pedido-no-servidor-aprovacao-no-vendedor.md) | Pedido no servidor: a aprovação mora no Vendedor, aprovação automática dentro da alçada e vocabulário dos eventos | aceita |
| [0012](0012-consultas-entre-modulos.md) | Consultas entre módulos na API e no aparelho | aceita |
| [0013](0013-rotas-de-conector-chave-por-conector.md) | Rotas de Conector na API: prefixo `/<modulo>/v1` e chave de API por Conector | aceita |
| [0014](0014-ci-paralelo-cache-do-turbo.md) | CI em jobs paralelos, cache do Turborepo e check obrigatório `ci-ok` | proposta |
| [0015](0015-relogio-de-teste-e-lint-de-hora-fixa.md) | Relógio de teste comum e lint de hora fixa | proposta |
| [0016](0016-pedido-ao-erp-ampliado-no-v1.md) | Pedido ao ERP ampliado no v1: quantidade na unidade base e entrega condicionada à versão do Conector | aceita · emenda 1 |
| [0017](0017-sincronizacao-em-segundo-plano.md) | Sincronização em segundo plano (expo-background-task) e retomada da carga | proposta |
| [0018](0018-modelo-de-sincronizacao.md) | Modelo de sincronização do app: Sincronizar, fila automática, push e novidades | aceita |
| [0019](0019-consulta-opcional-sem-aresta-de-dependencia.md) | Consulta opcional sem aresta de dependência (`usaConsultasOpcionais`) | aceita |
| [0020](0020-ambiente-demo-magalu-cloud.md) | Ambiente demo/homologação na Magalu Cloud: VM com Docker Compose, túnel da Cloudflare, imagens no GHCR e fotos em Object Storage S3 | aprovada (04/11/2026, por Alexandre, R-20261104-213539) |
| [0021](0021-geracao-da-base-no-sync.md) | Geração da base do tenant no sync: o aparelho percebe a base recriada ou restaurada | proposta |
| [0022](0022-tarefas-periodicas-dos-modulos.md) | Tarefas periódicas dos módulos no worker (`ModuloApi.tarefas`, 15 min, por tenant) | proposta |
| [0023](0023-dependencias-do-app-fora-da-imagem-da-api.md) | Dependências do app fora da imagem da API: `overrides` `drizzle-orm>expo-sqlite: "-"` e imagem com `--prod` (sem `.pnpmfile.cjs`) | proposta |
| [0024](0024-dbaas-magalu-postgres-producao.md) | PostgreSQL gerenciado (DBaaS) da Magalu Cloud como banco de produção: teste de compatibilidade (`dbaas-teste.yml`) | proposta · resultado: compatível com plano B (B0, B1, B2); aceita após custo aprovado, B0–B2 no main e 3ª execução com a suíte verde |
| [0025](0025-consulta-pela-licenca-do-tenant.md) | Consulta entre módulos pela licença do tenant (`{ licenca: 'tenant' }`), complemento da ADR 0012 | aceita |
| [0026](0026-historico-por-aba-no-roteador-do-tabs.md) | Histórico das telas de módulo por aba no roteador do Tabs (`UNSTABLE_router` do expo-router 57; sem `__unsafe_action__`; testes de guarda e gate de atualização) | aceita com condições |
