# ADR 0054 — Pacote pronto da primeira carga e entrada enquanto carrega

- **Status**: proposta em 2026-11-15 (branch `nuvem/catalogo-pacote-engenheiro-software`).
- **Data**: 2026-11-15 (Manaus)
- **Autor**: engenheiro-software
- **Origem**: R-20261115-070200-alexandre, item 2 (soluções 4 e 5 aprovadas, execução imediata). Desenho:
  `docs/desenho/T-catalogo-pacote.md`.
- **Altera**: ADR 0003 e 0018 (a carga inicial pode semear entidades por arquivo antes do pull), RN-CORE-48 (ordem das etapas).

## Contexto
- A primeira carga puxa cada entidade em páginas de 1.000 (`TAMANHO_PAGINA_SYNC`) e grava em lotes de 500 com manutenção
  incremental do FTS. Com ~150 mil linhas de preço e estoque, a etapa "Catálogo e preços" leva dezenas de minutos (Anderson
  parado em 42%).
- A entrada no app só abre com `sincronizado_em`, então o vendedor espera o catálogo inteiro para ver os clientes.

## Decisão
1. **Pacote por (tenant, módulo, partição)**, partição `tenant` ou `filial:<uuid>`; gerado pela plataforma no worker a partir de
   `ProvedorSync.pacote.puxar` de cada módulo (o módulo continua dono da consulta; a plataforma não lê tabela de módulo).
2. **Formato**: arquivo SQLite com o layout do aparelho (`ent_<entidade>(id, updated_at, dados)` + `_pacote`), só linhas vivas,
   `dados` igual ao JSON do pull, compactado em gzip. Guardado no bucket privado em
   `sync-pacotes/<tenant_id>/<modulo>/<particao>/<id>.sqlite.gz`, metadados em `plataforma.sync_pacote` (RLS).
3. **Versão**: watermark = `horizonte` do banco na geração. O manifesto (`GET /v1/sync/pacotes`) entrega por entidade o cursor
   `(horizonte, UUID nulo)` e a `versao_escopo` do usuário; a importação grava os dois na mesma transação e o pull continua dali.
   Só pacote da `geracao_base` atual (ADR 0021).
4. **Escopo**: só módulos efetivos (licença), `permitido(ctx)` do provedor (RN-CAT-05: promotor sem preço não recebe a partição de
   filial), filiais da carteira (RN-CORE-39), link pré-assinado de 15 min com `Range` (ADR 0037); disco no dev/CI pela rota
   `/v1/sync/pacotes/:id/arquivo`.
5. **Gatilhos**: `integracao.lote.concluido@1` na outbox (com espera de 5 min sem lote novo), pedido do próprio manifesto quando falta
   pacote, e regeração de pacote com mais de 24 h que tem mudança. Laço próprio no worker, ligado por `MACUXI_SYNC_PACOTES=1`.
6. **Aparelho**: o motor importa por `ATTACH` + `INSERT ... SELECT` numa transação exclusiva, reconstrói o FTS uma vez no fim e cai
   para o pull paginado em qualquer falha que não seja de rede. Download com retomada (`.part` + `Range`).
7. **Dependência nova**: `fflate` (descompactação gzip em JS puro, ~30 KB, MIT) no `platform-sdk`, usada só no aparelho.
8. **Entrada enquanto carrega**: o catálogo passa a ser a última etapa da carga; o app libera a entrada quando "Clientes e rota"
   (Campo) ou "Equipe" (Gestão) termina (`liberado_em` persistido pelo motor); com o catálogo pendente, busca, ficha e consultas de
   preço vão à API; indicador discreto até terminar.
9. Tudo **aditivo e opcional**: servidor sem a rota ou desligado devolve lista vazia e o app faz o pull de hoje; nenhum evento novo,
   nenhuma versão nova de contrato existente.

## Contratos (A1, `packages/platform-sdk`)
- `pacotes-sync.ts`: `PacoteSyncSchema`, `PacotesSyncRespostaSchema` (tolerante a campos novos), `MetaPacoteSchema` (tabela
  `_pacote` lida como `{ chave: valor }` em texto), `FORMATO_PACOTE_SYNC = 1`, `MAX_PARTICOES_PACOTE = 8`, `ROTA_SYNC_PACOTES`,
  `particaoDeFilial`/`filialDaParticao`, `CODIGOS_FALHA_PACOTE` e `ErroPacoteSync` (código do aviso `pacote_falhou`).
- `api.ts`: `ProvedorSync.pacote?: PacoteProvedorSync`, `ContextoPacote` (worker, sem pessoa, como `ContextoTarefa` com
  `comTenant`) e `ModuloApi.particoesPacote?`. `definirModuloApi` recusa pacote sem `puxar`, com escopo diferente de `tenant`
  (o arquivo é igual para todos da partição), partição fora de `tenant`/`filial`, e partição `filial` sem `particoesPacote`.
- `motor-sync.ts` (só tipos): `TransporteSync.pacotes?`, `ArquivosLocais.baixarPacote?/lerBloco?/gravarBloco?/espacoLivre?`,
  `LinhasSync.importarPacote?`, `EstadoMotorSync.liberado_em?`/`pendentes?`, `ProgressoCarga.bytes?`,
  `OpcoesMotorSync.essenciais?`. `sqlite/driver.ts`: `DriverSqlite.anexar?/desanexar?`. Todos opcionais: quem monta um
  `EstadoMotorSync` hoje (shells, testes) continua compilando.

## Alternativas
- **NDJSON.gz por entidade**: mais simples de gerar, mas no aparelho são 150 mil `JSON.parse` e 150 mil chamadas pela ponte
  JS↔nativo. Descartado pelo tempo.
- **Páginas maiores no pull (10 mil)**: reduz requisições, não resolve a gravação linha a linha nem o FTS incremental, e pesa na API.
- **`Content-Encoding: gzip` do S3 em vez de `fflate`**: a descompactação transparente do OkHttp não convive com `Range` (retomada).
- **Um arquivo por filial com tudo dentro**: duplica produtos e conteúdo em cada filial e obriga o Catálogo a ler `core.produto`.

## Consequências
- Primeira carga com 150 mil itens em poucos minutos (download de ~15 a 20 MB) e entrada em menos de 1 min.
- Disco do aparelho no pico ≈ 3× o pacote descompactado (o shell confere antes).
- Custo de armazenamento e de geração no worker por tenant e filial; retenção de 2 pacotes por partição.
- Pacote velho é coberto pelo incremental; a qualidade da primeira carga depende do gatilho de lote do Hub.
