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
| [0027](0027-marcas-concorrentes-no-core.md) | Marcas concorrentes da referência cruzada: o Promotor é o dono e o Catálogo lê pelo contrato dele (`promotor.concorrentes@1`); risco do tenant e do perfil sem o Promotor; nada no Core (T-0085) | substituída pela 0034 |
| [0028](0028-producao-magalu.md) | Produção na Magalu Cloud: VM com Compose, banco no DBaaS por TLS, imagem por digest, publicação só por tag `v*` com aprovação no environment `PRODUCAO` (T-0086) | proposta |
| [0029](0029-super-admin-de-plataforma.md) | Super-admin de plataforma: identidade fora dos tenants, convite secreto no primeiro acesso, TOTP obrigatório, sessão curta revogável, rota de módulo opta por `superAdmin` com `x-macuxi-tenant`, auditoria de toda requisição (T-0087); condição do aceite: papel de banco `macuxi_portal` antes do 1º cliente real (T-0091) | aceita com condição · parcialmente substituída pela 0031 |
| [0030](0030-documento-publico-de-modulo.md) | Documento público de módulo: `RotaPublica.cache` (Cache-Control público, ETag, 304), fora do core só `GET` em `/<modulo>/v1`, sem token, licença, cabeçalhos nem sessão de tenant (T-0092) | aceita |
| [0031](0031-portal-so-email-e-senha.md) | Portal `config.` só com e-mail e senha: sem convite e sem TOTP, admin do cliente com escolha de empresa (token por empresa), super-admin pelo deploy e senha única da plataforma (RN-CORE-32); substitui os §2, §3 e o mínimo de 12 da 0029 (T-0093) | aceita (decisão do dono do produto, 07/11/2026) |
| [0032](0032-ciclo-de-senha-dos-usuarios.md) | Ciclo de senha dos usuários do tenant: senha temporária de 72 h por e-mail com troca obrigatória (login responde `SENHA_A_TROCAR`), "Esqueci a senha" paralelo, `sessao_versao` no token, `app` no login e `RotaModulo.superficie: 'bko'` (RN-CORE-33), outbox de e-mail cifrada em vez de pg-boss (T-0094) | proposta |
| [0033](0033-motor-de-permissoes-por-perfil.md) | Motor de permissões por perfil de acesso: chaves estáveis (plataforma no SDK, ações dos manifestos), padrão de fábrica com sobreposições por tenant, perfil personalizado a partir de uma base, multiperfil pela união com os limites travados pela regra mais restritiva (RN-CORE-33, RN-PRO-01, último admin), consulta a cada requisição em `ctx.usuario.perfis` (T-0111/T-0112) | proposta |
| [0034](0034-marcas-concorrentes-no-catalogo.md) | Marcas concorrentes no Catálogo: `catalogo.marca_concorrente` (mesmos ids, migração única), consulta `catalogo.marcas@1` (API e aparelho), entidade `marca_concorrente`, evento `catalogo.marca_concorrente.alterada@1`; o Promotor lê por contrato, `promotor.concorrentes@1` e a entidade `concorrente` em deprecação até 2026-12-08; retrato `marca_nome` mantido na mesma transação; substitui a 0027 (T-0113) | proposta |
| [0035](0035-recados-em-repositorio-proprio.md) | Recados online no repositório privado `macuxifdv-recados`: junções `mklink /J` de `.coord/recados` e `.coord/lidos` para o clone, `lidos/*.txt merge=union`, `sincronizar-recados.ps1` a cada 2 min e nos hooks de sessão, Actions de formulário (só `domontecristo`), aviso no Telegram e resumo de hora em hora; guardião e `verificar` cobrem o caminho do clone e o corte pela marca no `.gitignore` (T-0139) | proposta |
| [0036](0036-miniatura-de-foto-no-servidor-jpeg-js.md) | Miniatura da foto (320 px, até 30 KB) gerada pela API na 1ª leitura de `GET /v1/arquivos/:id/miniatura`, com a mesma regra de acesso do original, guardada ao lado dele (`<id>.m320.jpg`); `jpeg-js` (JS puro) em vez de `sharp` (T-0097 b) | aceita |
