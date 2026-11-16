# 04 — Arquitetura modular e dados

## Visão geral
```
 ┌──────────────── Android ────────────────┐      ┌─── Navegador ───┐
 │ Macuxi Campo        Macuxi Gestão       │      │  Backoffice Web │
 │ (variante campo)    (variante gestao)   │      │  (Next.js)      │
 │  shell + módulos ativos + SQLite local  │      │ shell + módulos │
 └───────────────┬─────────────────────────┘      └────────┬────────┘
                 │ HTTPS  /v1/<modulo>/*  /v1/sync/*        │
                 ▼                                          ▼
        ┌──────────────────── apps/api (Fastify) — monólito modular ───────────────────┐
        │ plataforma: auth, licenças, sync, eventos (outbox + despachante), extensões       │
        │ core │ catalogo │ vendedor │ promotor │ gestor │ pesquisa │ treinamento │ integracao │
        └───────┬───────────────────────────────┬───────────────────────────┬──────────┘
                ▼                               ▼                           ▼
     PostgreSQL gerenciado            Storage S3 (fotos, vídeos,       LLM + embeddings
     1 schema por módulo + RLS        PDFs, importações)              (busca do Catálogo)
     + pgvector                                ▲
                                               │ HTTPS de saída  /integracao/v1/*
                                 ┌─────────────┴─────────────┐
                                 │ Conector Macuxi (no cliente)│──► views SQL / API do ERP
                                 └────────────────────────────┘
```

## Ambiente e versões (decisão do Alexandre, 2026-10-31)
- **Node 24 LTS** no PC e no CI; `engines` do monorepo `>=24.7` (o argon2id nativo do login e do seed exige 24.7) e `.nvmrc` na raiz.
- **Expo SDK 57**; aparelho de referência **Android 10+ com 3 GB de RAM**; meta de busca offline p95 < 300 ms no aparelho (T-0008).
- PostgreSQL 16 + pgvector (`pgvector/pgvector:pg16`) no Docker local e no CI.

## Domínio e endereços (decisão do Alexandre, 2026-11-01, R-20261101-164531)
Domínio `macuxifdv.com.br` (registro.br, DNS na Cloudflare). O domínio raiz e o `www` são do site e do portal de compras, fora deste projeto: o Macuxi usa **só subdomínios**.
| Subdomínio | Uso | Situação |
|---|---|---|
| `api-demo.macuxifdv.com.br` | API da demonstração (túnel nomeado `macuxi-demo` no notebook do Alexandre → porta 8100) | ativo (T-0038) |
| `bko-demo.macuxifdv.com.br` | BKO da demonstração (mesmo túnel) | ativo (T-0038) |
| `api.macuxifdv.com.br`, `bko.macuxifdv.com.br`, `app.macuxifdv.com.br` | produção | **reservados** (servidor não decidido; não criar nada) |
- Os builds do APK levam o endereço da API do perfil do `eas.json` (`EXPO_PUBLIC_API_URL`).
- Os builds preview e producao não têm o campo Servidor no login. No build de desenvolvimento, o campo fica em "Avançado".

## Por que monólito modular (e não microserviços)
Um deploy só, uma base só, transações locais simples e custo baixo — mas com fronteiras rígidas entre módulos (schemas separados, contratos públicos e regras de importação verificadas no CI). Se um módulo precisar escalar sozinho no futuro (ex.: busca do Catálogo), ele já está isolado para ser extraído.

## Estrutura do monorepo
```
apps/
  mobile/        shell Expo; variantes "campo" e "gestao" (app.config.ts + perfis do eas.json, lidos pelo android-build.yml)
  web/           shell Next.js do Backoffice
  api/           bootstrap Fastify: carrega os plugins dos módulos ativos
  conector/      Conector on-premise (Node empacotado como serviço Windows)
modules/<modulo>/            core | catalogo | vendedor | promotor | gestor | pesquisa | treinamento | integracao
  manifest.ts    id, versão, depende, perfis, telas, abas, menus, entidades de sync, eventos, extensões
  domain/        regras puras + testes (RN-<MOD>-nn)
  contracts/     Zod: API pública, eventos publicados, payloads de extensão  ← única parte importável por outros módulos
  api/           plugin Fastify (/v1/<modulo>), handlers de eventos, jobs
  app/           telas React Native e serviços locais (registrados no shell)
  web/           páginas do BKO (registradas no shell)
  db/            schema na nuvem (Drizzle) e schema local (SQLite) — dono: agente de banco
packages/
  platform-sdk/  ModuleManifest, barramento de eventos, registro de extensões, motor de sync, permissões
  ui/            design system compartilhado (tokens, componentes)
  config/        eslint, tsconfig, regras de fronteira (dependency-cruiser)
db/              migrações geradas, políticas RLS, seeds, views-modelo para o Conector
tests/           e2e, integração entre módulos, carga
.coord/          coordenação dos agentes (ver 07)
docs/            produto, decisões (ADR), planos, módulos
```

### Regras de fronteira (checadas no CI)
1. Um módulo importa apenas `packages/*`, `modules/core/contracts` e `modules/<outro>/contracts`.
2. Nenhum módulo lê ou escreve tabela de outro schema; dados de outro módulo chegam por API pública, evento ou read-model próprio.
3. Mudança incompatível em contrato = nova versão (`@2`), convivência com a anterior por 1 sprint, ADR e recado aos consumidores.

## Instalação de módulos (como "instalar/desinstalar" funciona)
> **Crítica**: no Android, APKs separados por módulo (ou *dynamic feature modules* do Google Play) exigem app nativo em Kotlin, vários logins/sincronizações e dobram o custo. **Recomendação: instalação lógica.** O código dos módulos vem no app (é pequeno, só JavaScript), mas **nada aparece, sincroniza ou ocupa espaço** sem licença; conteúdos pesados (fotos, vídeos de treinamento) só baixam se o módulo estiver ativo.

Fluxo:
1. Admin ativa o módulo no BKO (tenant → perfil → usuário). Evento `core.usuario.modulos_alterados@1`.
2. App recebe no próximo sync `GET /v1/me/modulos` (lista + versões + parâmetros).
3. Shell monta só abas, menus e extensões dos módulos efetivos; o motor de sync passa a puxar as entidades declaradas no `manifest` do módulo.
4. Desativação: shell desmonta, sync apaga as tabelas locais do módulo, API responde 403 `MODULO_INATIVO`.
5. Versão mínima por módulo: se o app estiver antigo, pede atualização só quando o módulo exigir.

### Manifesto (exemplo)
```ts
export const manifest = defineModule({
  id: 'promotor', versao: '1.0.0',
  depende: ['core'], opcionais: ['catalogo', 'pesquisa', 'vendedor'],
  perfis: ['promotor', 'supervisor', 'gerente', 'analista'],
  apps: { campo: { abas: ['Loja'] }, gestao: { abas: ['Trade'] }, web: { menus: ['Trade marketing'] } },
  sync: ['checklist_loja', 'mix_obrigatorio', 'meta_share', 'concorrente', 'produto_concorrente', 'foto_referencia', 'tarefa_trade'],
  publica: ['promotor.share.medido@1', 'promotor.preco.coletado@1', 'promotor.ruptura.registrada@1'],
  consome: ['core.visita.checkin@1', 'core.visita.checkout@1'],
  usaExtensoes: ['cliente.abas', 'visita.etapas_checkout', 'inicio.cards'],
});
```

## Comunicação entre módulos (em tempo de execução)
- **Eventos de domínio**: gravados na tabela `plataforma.evento` (outbox) na mesma transação; o despachante (`apps/api/src/worker.ts`, papel `macuxi_worker`, ADR 0007) entrega aos consumidores licenciados com retentativa; consumo idempotente por `evento_id`. Nome `<modulo>.<entidade>.<fato>@vN`.
- **API pública síncrona**: serviço exposto em `contracts` (ex.: `vendedor.criarPedidoEmNome()`), usado quando a resposta é necessária na hora.
- **Pontos de extensão (UI)**: o dono declara o slot (`produto.acoes`, `cliente.abas`, `visita.etapas_checkout`, `inicio.cards`, `menu.itens`, `pedido.criar_em_nome`); outros módulos registram componentes; o shell só renderiza o que está ativo.
> É o mesmo princípio do protocolo de recados entre os agentes (doc 07): cada um mexe só no que é seu e conversa por mensagens com formato padrão.

## Sincronização offline
- **Pull**: `GET /v1/sync/pull?entidades=...&cursor=...` por entidade registrada pelos módulos ativos; cursor `(updated_at, id)`; inclui removidos; páginas de 1.000; escopo da carteira.
- **Push**: `POST /v1/sync/push` com lote da outbox (pedidos, visitas, execuções, respostas, progresso de treinamento), idempotente por UUID; resposta por item: aceito | rejeitado (código RN) | conflito.
- **Conflitos**: dados vindos do ERP → servidor vence; pedido → app edita até `recebido`; respostas de pesquisa e progresso → somente inserção.
- **Volume alvo**: 20 mil SKUs, 500 clientes, 12 meses de histórico resumido no aparelho.

## Busca em linguagem natural (Catálogo)
- **Online**: o LLM transforma a frase em filtros estruturados + texto; a consulta combina busca textual (Postgres FTS) e semântica (pgvector) com filtros de estoque/preço; resultado reordenado. Cache de consultas frequentes; limite por usuário (RN-CAT-03).
- **Offline**: SQLite FTS5 com sinônimos do tenant, correção de digitação e atributos.
- **Pergunte ao catálogo**: RAG somente sobre fichas, FAQs e PDFs do tenant, com citação da fonte.
- Provedor de LLM e de embeddings atrás de interface (troca sem mexer no módulo). Premissa: Claude para interpretação/respostas e um modelo de embeddings multilíngue.

## Dados (1 schema por módulo)
Campos comuns: `id uuid`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`.

| Schema | Tabelas principais |
|---|---|
| `plataforma` | tenant, tenant_modulo (ativo, plano, licenças), perfil_modulo, usuario_modulo (exceção), evento (outbox), parametro, auditoria, dispositivo |
| `core` | filial (código, nome, cidade/UF, padrão; criada no `provisionar_tenant`, RN-CORE-39, ADR 0040), usuario, equipe (árvore), produto (cadastro base: sku, ean, nome, marca, categoria, medida da unidade, embalagem (medida + quantidade), custo, preço de venda, desconto máximo, ativo; RN-CORE-18/19), medida (sigla e descrição por tenant, RN-CORE-19), produto_unidade (UN/CX, fator, EAN; RN-VEN-15), cliente (com `cadastro_incompleto` e campos faltantes, RN-CORE-16/17; `filial_id` nunca nula, RN-CORE-39), fotos do PDV (tipos e fotos por cliente, RN-CORE-38; nomes das tabelas em `docs/desenho/T-0147.md`), cliente_endereco (entrega, RN-VEN-17), cliente_contato, carteira (cliente, usuario, papel), cliente_financeiro, titulo, historico_compra (resumo), rota, rota_parada, visita, visita_etapa, motivo, meta, indicador_diario, notificacao |
| `catalogo` | catalogo_no e produto_no (árvore do catálogo vinda do ERP, RF-CAT-04), produto_atributo, produto_midia, produto_conteudo (argumentos, FAQ, docs), sinonimo, produto_embedding (pgvector), tabela_preco, tabela_preco_item (com `filial_id`: o preço vale por filial), deposito (com `filial_id`: o estoque da filial é a soma dos depósitos dela), estoque_saldo, busca_log |
| `vendedor` | pedido (com modalidade de frete, transportadora, endereço de entrega e o retrato da filial, gravado pelo servidor no recebimento), pedido_item (medida, quantidade da embalagem, quantidade em unidades, desconto ou acréscimo), transportadora, pedido_evento, aprovacao, condicao_pagamento, cliente_condicao, reserva_estoque, alerta_ruptura |
| `promotor` | cadastros de trade: categoria_gondola, mix_obrigatorio, concorrente, produto_concorrente, meta_share, foto_referencia (planograma), checklist_modelo, checklist_item, tarefa_trade · coletas: visita_loja (permanência), checklist_resposta, gondola_registro (antes/depois, conformidade), medicao_share, coleta_preco, ruptura_item, validade_item, ponto_extra, ponto_extra_negociado, acao_concorrencia, tarefa_execucao, foto · read-model: indicador_promotor_dia |
| `gestor` | read-models: painel_vendedor_dia, alerta, alerta_regra |
| `pesquisa` | questionario, questionario_versao, pergunta, opcao, regra_condicional, publico_alvo, resposta, resposta_item, resposta_foto |
| `treinamento` | trilha, modulo_trilha, licao, quiz, questao, alternativa, publico_alvo, progresso, tentativa, xp_lancamento, medalha, medalha_usuario, ranking_periodo |
| `integracao` | conector, credencial, lote, lote_linha_erro, mapeamento, cursor_entidade, lote_staging, registro_atual, sessao_carga, sessao_carga_recebido, pendencia_inativacao, politica_versao, pedido_fila_erp, pedido_retorno, reconciliacao |

> **Filial (ADR 0040, T-0149, 10/11/2026):**
> - a filial fica no Core, e o Catálogo e o Vendedor a leem pela consulta `core.filiais@1`;
> - o aparelho recebe preço e estoque só das filiais da carteira do vendedor, mais a padrão;
> - tudo é aditivo, sem nova versão de contrato.
>
> Decisão (ADR-0005): o cadastro base de produto fica no schema `core` (tabela `produto`); preço, estoque, conteúdo e busca ficam no schema `catalogo`. O Vendedor depende do Catálogo e consome produto, preço e estoque por contrato; Promotor, Pesquisa e Gestor usam só o produto do Core.

## Segurança e não funcionais
- JWT de acesso 15 min + refresh rotativo 30 dias; argon2; RBAC + escopo de carteira + licença de módulo em toda rota.
- RLS por `tenant_id` em todos os schemas; teste automático de vazamento entre tenants por módulo.
- App abre em < 2 s; busca offline < 300 ms; API p95 < 300 ms; Android 10+.
- **LGPD:**
  - **Localização:** GPS no check-in e no checkout. O tracking contínuo (semana de 16/11) só liga com a base LGPD (finalidade, aviso e termo; RN-CORE-13 e RN-CORE-37, T-0145).
  - **Fotos de orientação:** sem rostos.
  - **Fotos do PDV:**
    - CNH e contrato social são dado pessoal;
    - ficam no bucket privado, sem URL pública nem pré-assinada;
    - a leitura passa pela rota autenticada, que confere perfil e carteira (`plataforma.arquivo.perfis_leitura`, ADR 0041);
    - a retenção vai enquanto o cliente estiver ativo e mais 5 anos depois de `core.cliente.inativado_em` (RN-CORE-38, T-0147);
    - o expurgo diário entra depois da v1.0.5.
  - **Por tenant:** exportação e exclusão.
- Observabilidade: logs pino com `tenant_id`, `modulo`, `request_id`; Sentry; métricas de sync e integração.
- Backups diários, retenção 30 dias; RPO 24 h, RTO 4 h.
