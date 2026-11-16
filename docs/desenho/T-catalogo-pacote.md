# Catálogo: pacote pronto (4) e trabalhar enquanto carrega (5) — desenho técnico

Origem: R-20261115-070200-alexandre, item 2 ("Aprovado 4 e 5 para o catálogo. Faça imediatamente"). Caso real: carga do Anderson
parada em 42% na etapa "Catálogo e preços". Decisão de arquitetura: **ADR 0054 (proposta)**. Autor: engenheiro-software, 15/11/2026.
Regras citadas: RN-CORE-02/04/23/39/48, RN-CAT-05, ADR 0006, 0009, 0010, 0017, 0018, 0021, 0022, 0037, 0040.

## 0. O que existe hoje (lido em `origin/main` 3855e5a07)

- **Motor** (`packages/platform-sdk/src/motor-sync.ts`, do engenheiro-software, não do Core): a carga completa puxa entidade por
  entidade, páginas de `TAMANHO_PAGINA_SYNC = 1000` (`sync.ts`), cursor `(updated_at, id)`. A ordem vem de
  `chaveDeOrdemDaCarga` (RN-CORE-48, `modules/core/domain/entrada-sync.ts`): envio → Clientes e rota → **Catálogo e preços** →
  Pedidos e metas → Fotos e materiais.
- **SQLite do aparelho** (`sqlite/armazenamento.ts`): tabela genérica `ent_<entidade>(id, updated_at, deleted_at, dados JSON)`.
  Cada página vai em lotes de 500 com **manutenção incremental do FTS** (`linhasPorIds` + `manterIndice`) na mesma transação.
  Com 150 mil linhas são 150 requisições + ~300 transações com leitura das linhas antigas e manutenção do índice: é o que segura
  a tela em 42%.
- **Pull do catálogo** (`modules/catalogo/api/sync.ts`): `tabela_preco_item`, `tabela_escalonada`, `deposito`, `estoque_saldo`
  filtrados pelas filiais da carteira (`filiaisDoPull`, RN-CORE-39) com `variacaoPorFilial` na `versao_escopo`; o resto do
  catálogo é escopo `tenant`. Na etapa "Catálogo e preços" também entram `produto`, `produto_unidade` e `medida` do Core
  (`modules/core/api/sync.ts`, escopo `tenant`).
- **Entrada**: `apps/mobile/src/app/(tabs)/_layout.tsx` manda para `/sync` enquanto não há `sincronizado_em`; a tela de carga
  (`apps/mobile/src/components/tela-carga.tsx`) só libera no fim.
- **Busca**: a tela do catálogo (`modules/catalogo/app/telas/catalogo.tsx`) já busca na API (`GET /v1/catalogo/busca` com
  `customer_id`, que traz o preço) quando há sinal e não há filtro; sem sinal, busca local.
- **Arquivos**: S3 privado com GET pré-assinado (ADR 0037, `apps/api/src/pacotes.ts`, `armazenamento-s3.ts`); driver `disco` no
  dev/CI. **Worker**: despachante + agendador (ADR 0022, ciclo de 15 min). Node ≥ 24.7 no servidor (`node:sqlite` embutido).

## 1. Solução 4 — pacote pronto

### 1.1 Formato
- **Um arquivo SQLite compactado em gzip** (`.sqlite.gz`), com o MESMO layout do aparelho:
  `ent_<entidade>(id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, dados TEXT NOT NULL) WITHOUT ROWID`, onde `dados` é
  `JSON.stringify(linha)` da MESMA consulta do pull (byte a byte igual ao que o pull gravaria), mais a tabela `_pacote(chave, valor)`
  com: `formato = 1`, `tenant_id`, `modulo`, `particao`, `horizonte`, `geracao_base`, `entidades` (JSON `{nome: linhas}`).
- Só linhas vivas (`deleted_at is null`): na primeira carga não há o que apagar.
- Por que SQLite e não NDJSON: no aparelho a importação vira `ATTACH` + um `INSERT ... SELECT` por entidade, dentro do SQLite,
  sem passar 150 mil linhas pela ponte JS↔nativo nem `JSON.parse`. No servidor, `node:sqlite` já existe (sem dependência).
- Descompactação no aparelho: **`fflate`** (JS puro, ~30 KB, MIT), em blocos, no SDK (`descompactarGzip`), com leitor e
  gravador de arquivo injetados pelo shell. É a única dependência nova (ADR 0054). Fica no `platform-sdk` para o lockfile mudar só
  no PR do engenheiro-software.

### 1.2 Partições (o que vai em cada arquivo)
A unidade é **(tenant, módulo, partição)**. Assim cada módulo gera o próprio arquivo pelo próprio provedor (fronteira: o
Catálogo não lê `core.produto`), e uma mudança de preço não regera o conteúdo.

| Pacote | Entidades | Quem recebe |
|---|---|---|
| `core` · `tenant` | `produto`, `produto_unidade`, `medida` | todo usuário com o Core |
| `catalogo` · `tenant` | `catalogo_no`, `produto_no`, `produto_relacao`, `produto_atributo`, `produto_conteudo`, `produto_referencia`, `sinonimo`, `marca_concorrente` | licença do Catálogo |
| `catalogo` · `filial:<uuid>` (um por filial) | `tabela_preco_item`, `tabela_escalonada` (inclui a de filial nula), `deposito`, `estoque_saldo` | licença do Catálogo **e** direito a preço (RN-CAT-05); só as filiais da carteira + a padrão (RN-CORE-39) |

- Ficam **fora** (continuam no pull paginado, são pequenas ou dependem da carteira): `tabela_preco`, `cliente_tabela_preco`,
  clientes, rota, pedidos, metas e tudo de escopo `carteira`/`usuarios`/`proprio`.
- O vendedor típico baixa **3 arquivos** (core, catálogo, a filial dele). Mais de `MAX_PARTICOES_PACOTE = 8` filiais para o
  mesmo usuário (admin/gerente com "todas"): o módulo segue no pull paginado.

### 1.3 Tamanho esperado
- `tabela_preco_item` em JSON: ~330 B por linha; com a chave e a página do SQLite, ~450 B. **150 mil itens ≈ 65 MB** de SQLite,
  **≈ 15 a 20 MB em gzip** (UUID comprime ~2:1, os nomes de campo repetidos comprimem muito).
- Download: 4G (10 Mbit/s) ≈ 15 s; 3G fraco (1 Mbit/s) ≈ 2,5 min. Importação (`INSERT ... SELECT` + `rebuild` do FTS): segundos.
- Pico de disco no aparelho ≈ 3× o descompactado (`.gz` + `.sqlite` temporário + `ent_*`). O shell confere o espaço livre antes;
  sem espaço, pull paginado.

### 1.4 Quem gera, quando e onde guarda
- **Gerador da plataforma no worker** (`apps/api/src/sync-pacotes-gerador.ts`, laço próprio como o do e-mail,
  `MACUXI_SYNC_PACOTES_INTERVALO_MS` padrão 60 s, ligado por `MACUXI_SYNC_PACOTES=1`). Para cada (tenant, módulo, partição):
  1. `pg_try_advisory_lock` da partição (dois workers não geram o mesmo);
  2. `horizonte = banco.horizonteSync()` e `geracao_base` atual;
  3. para cada provedor do módulo com `pacote`, lê em páginas de 5.000 (`provedor.pacote.puxar(ctx, { filial, desde, ate:
     horizonte, limite })`, em `comTenant` com `macuxi_app` e RLS) e grava no SQLite temporário (`node:sqlite`, uma transação
     por página);
  4. `VACUUM`, gzip nível 6 (`node:zlib`, em fluxo), md5 e bytes;
  5. `PUT` no S3: `sync-pacotes/<tenant_id>/<modulo>/<particao>/<pacote_id>.sqlite.gz` (driver `disco` no dev/CI: mesmo caminho
     relativo no diretório de arquivos);
  6. linha `pronto` em `plataforma.sync_pacote`; a anterior da partição vira `substituido` e o arquivo dela é apagado 1 h depois
     (quem estava baixando termina).
- **Gatilhos** (gravados em `plataforma.sync_pacote_pedido`, idempotente por partição):
  - **depois da integração**: `integracao.lote.concluido@1` na outbox (`plataforma.evento`, lido pelo worker) com data posterior
    ao `horizonte` do pacote do tenant marca as partições do tenant; gera quando não chega lote novo há 5 min (não regera no meio
    de uma carga de vários lotes);
  - **sob demanda**: `GET /v1/sync/pacotes` que não acha pacote pronto de uma partição grava o pedido (aquele aparelho segue no
    pull paginado);
  - **agendado**: pacote com mais de 24 h e com mudança desde o `horizonte` (consulta `limite: 1`, como as novidades) é regerado.
- Log: `tenant_id`, `modulo`, `particao` (uuid da filial, não é dado pessoal), linhas, bytes, duração. Nunca a URL assinada.

### 1.5 Versão e continuação do incremental
- Watermark = `horizonte` do pacote (relógio do banco, ADR 0006). Toda linha visível com `updated_at < horizonte` está no arquivo.
- O manifesto devolve, por entidade, o **cursor** `codificarCursor({ updated_at: horizonte, id: UUID_NIL })` e a
  **`versao_escopo` do usuário** (a mesma função `versaoEscopo(prov, ctx)` do pull). O motor grava os dois na mesma transação da
  importação. O pull seguinte da entidade continua do cursor (só o que mudou depois do pacote) e **não** dispara ressincronização,
  porque a versão já é a do usuário.
- Várias filiais: a entidade recebe o **menor** horizonte entre os pacotes importados; a sobreposição é inofensiva (upsert por `id`,
  só substitui com `updated_at` maior).
- `geracao_base` (ADR 0021): o manifesto só oferece pacote da geração atual; o motor confere com `conferirGeracao` antes de importar.

### 1.6 Rotas, autenticação e escopo (`apps/api/src/sync-pacotes.ts`)
- `GET /v1/sync/pacotes` → `PacotesSyncResposta` (Zod no SDK):
  `{ geracao_base?, pacotes: [{ id, modulo, particao, horizonte, bytes, md5, url, expira_em,
  entidades: [{ nome, linhas, cursor, versao_escopo? }] }] }`.
  - Sessão de usuário (`p.preparar`); **licença**: só módulos efetivos do usuário (RN-CORE-02/03); **perfil**: o provedor
    diz `pacote.permitido(ctx)` (Catálogo: `verPrecoDoPerfil` para a partição `filial`; promotor sem preço não recebe o arquivo, o
    preço nem chega ao aparelho, RN-CAT-05); **carteira/filial**: as partições `filial` são as de `filiaisDoPull(ctx)`
    (RN-CORE-39); **tenant**: `plataforma.sync_pacote` com RLS e chave do S3 com o `tenant_id`.
  - `url`: GET pré-assinado do S3 (validade `MACUXI_SYNC_PACOTES_VALIDADE_S`, padrão 900 s), aceita `Range` (retomada).
  - Desligado, sem S3/disco ou sem pacote pronto: `{ pacotes: [] }` (o aparelho segue no pull paginado). Servidor antigo: 404,
    tratado igual.
- `GET /v1/sync/pacotes/:id/arquivo`: só no driver `disco` (dev, CI, stack isolado), com `Range`, mesma checagem de escopo.
- Erros: 403 `MODULO_INATIVO` não acontece aqui (a lista só traz módulos efetivos); `:id` de outro tenant ou fora do escopo = 404.

## 2. No aparelho

### 2.1 Motor (SDK)
- Na **carga inicial** (sem `sincronizado_em`) e só para entidades **sem cursor e sem versão**, o motor pede o manifesto
  (`transporte.pacotes()`) no início da passada. Cada pacote vira um item da sequência, posicionado pela mesma `ordemDaCarga`
  da 1ª entidade dele; o item roda **antes** das entidades que cobre.
- Passos do item: baixar (`arquivos.baixarPacote(url, destino, { deBytes })`, retomada por `Range` a partir do `.part`) →
  conferir bytes e md5 → descompactar em blocos (`descompactarGzip`) → `PRAGMA quick_check` → **importar** (adaptador SQLite,
  `linhas.importarPacote(caminho, entidades)`): `ATTACH`, um `INSERT INTO ent_x ... SELECT ... FROM pacote.ent_x ON CONFLICT(id)
  DO UPDATE ... WHERE excluded.updated_at > ent_x.updated_at`, contagem conferida com `_pacote.entidades`, cursor e
  `versao_escopo` gravados, **na mesma transação exclusiva** (tudo ou nada), `DETACH`, índices FTS das entidades marcados para
  `rebuild` (sem manutenção linha a linha; `busca.finalizar` reconstrói uma vez no fim, como na carga em massa).
- Depois do item, cada entidade coberta segue no `puxarEntidade` de sempre a partir do cursor (poucas páginas): coberturas D-3,
  poda e `versao_escopo` seguem iguais.
- **Retomada**: `RegistroCarga` ganha `pacotes: { [id]: 'importado' }`; o `.part` fica no disco. Link vencido = pede o manifesto
  de novo; se o `id` mudou (pacote substituído), apaga o `.part` e baixa o novo.
- **Fallback**: erro de rede = a passada para com erro, como hoje, e a próxima retoma o download. Qualquer outro erro (md5,
  tamanho, `quick_check`, contagem, sem espaço, rota 404/501, pacote ausente) = apaga os temporários, aviso no Diagnóstico
  (`pacote_falhou` + código, sem dado pessoal) e as entidades seguem no pull paginado. Nunca fica parado.
- Progresso: `ProgressoCarga` ganha `bytes?: { feitos, total }`; a etapa continua "Catálogo e preços" e o percentual anda pelo
  download.
- Fora da carga inicial: nada muda (novidades e incremental de hoje). Ressincronização de escopo (cliente novo com filial nova)
  segue no pull; o pacote é só para a primeira carga e para a troca de geração (ADR 0021), que também recomeça do zero.

### 2.2 Solução 5 — entrar enquanto carrega
- **Ordem nova da carga do Campo** (RN-CORE-48 revista, `modules/core/domain/entrada-sync.ts`): envio → Clientes e rota →
  Pedidos e metas → Fotos e materiais → **Catálogo e preços por último** (é a única etapa grande; assim Início, metas e pedidos
  já estão no aparelho quando o vendedor entra). Gestão: Aprovações (que contém o catálogo) vai para o fim pela mesma regra.
- **Liberação**: função pura do Core `entradaLiberada(progresso)` = a etapa "Clientes e rota" (Campo) ou "Equipe" (Gestão) está
  feita. O motor recebe `essenciais: (item) => boolean` e grava `sync:liberado_em` quando todos os essenciais da carga inicial
  concluem; `EstadoMotorSync.liberado_em` volta do armazenamento na abertura (app reaberto no meio entra direto).
- **Shell**: `(tabs)/_layout.tsx` troca `!estado.sincronizado_em` por `!(estado.sincronizado_em || estado.liberado_em)`; a tela
  de carga redireciona quando liberada e a passada continua em segundo plano (é a mesma promessa; `sincronizar()` é uma por vez).
  O envio (`motor.enviar`) já roda independente da passada: pedido feito durante a carga sai na hora.
- **Busca online até terminar**: o motor expõe `estado.pendentes` (entidades e etapas ainda não concluídas na carga inicial;
  vazio depois) e `motor.cargaPendente(modulo)`. Com o Catálogo pendente:
  - tela do catálogo, ficha e as consultas `catalogo.busca_produtos@1`, `catalogo.precos_cliente@1`, `catalogo.textos_produto@1`
    (usadas pelo Novo pedido do Vendedor) vão à API (`/v1/catalogo/busca`, `/v1/catalogo/produtos/:id`), com preço do cliente;
    filtro que a API não atende fica desligado durante a carga;
  - sem sinal e pendente: mensagem curta de "catálogo ainda carregando" (texto do designer-ux, parecer do corretor);
  - a API revalida preço e regra no pedido (regra 2 do CLAUDE.md), então o preço online não abre brecha.
- **Indicador discreto**: componente do `packages/ui` (designer-ux), montado pelo shell no topo das abas enquanto `pendentes`
  não está vazio: nome da etapa e percentual ("Catálogo 63%"), toque abre o detalhe da carga; some ao terminar. Sem aviso fora da
  área de alertas (RN-VEN-42); nada de explicar o que o sistema faz por trás (R-20261110-192153).

## 3. Contratos e ADR
- **ADR 0054 (proposta)**: pacote da primeira carga (formato, partições, gerador, rotas, `fflate`, entrada antecipada).
- **SDK (Zod/TS, `packages/platform-sdk/src/pacotes-sync.ts`)**: `PacoteSyncSchema`, `PacotesSyncRespostaSchema`,
  `MetaPacoteSchema` (`_pacote`), `FORMATO_PACOTE_SYNC = 1`, `MAX_PARTICOES_PACOTE`; `ProvedorSync.pacote?: { particao: 'tenant' |
  'filial'; permitido?(ctx); puxar(ctx: ContextoPacote, pedido: PedidoPull & { filial: string | null }) }` e
  `ModuloApi.particoesPacote?: { filiaisDoUsuario(ctx), filiaisDoTenant(ctx) }`; `TransporteSync.pacotes?()`,
  `ArquivosLocais.baixarPacote?/lerBloco?/gravarBloco?/espacoLivre?`, `LinhasSync.importarPacote?`, `DriverSqlite.anexar?/desanexar?`,
  `EstadoMotorSync.liberado_em` e `pendentes`, `ProgressoCarga.bytes?`, `OpcoesMotorSync.essenciais?`. Tudo **opcional e aditivo**:
  sem as peças, o motor faz o pull de hoje.
- **Core (`modules/core/contracts/entrada-sync.ts`)**: ordem nova e `entradaLiberada`; sem mudança de schema da tela (a lista de
  etapas é a mesma, muda a posição).
- **Eventos**: nenhum novo. O gerador lê `integracao.lote.concluido@1` (já existe) na outbox; não há consumidor de módulo.
- **Banco**: `plataforma.sync_pacote` e `plataforma.sync_pacote_pedido` (§5, tarefa B). Registro em `.coord/contratos/modulos.md`
  (pacote por módulo) no PR do engenheiro-software.
- **RN nova** (número pelo gerente no doc 03): "Na primeira carga o vendedor entra no app quando Clientes e rota terminam; o
  catálogo continua carregando com busca online até terminar". Revisão da RN-CORE-48 (catálogo por último).

## 4. Testes (o que o `testes` valida)
1. **Equivalência**: base com 150 mil `tabela_preco_item` (+ estoque e produtos) → pacote importado + incremental = pull paginado
   completo, `ent_*` idênticos (`id`, `updated_at`, `dados`), cursores e `versao_escopo` iguais (`*.db.test.ts` no CI, driver
   `node:sqlite`).
2. **Meta de tempo**: no CI, gerar 150 mil ≤ 60 s e importar 150 mil (node:sqlite) ≤ 10 s; no aparelho (roteiro, Android de
   entrada, 4G), primeira carga com 150 mil itens em **até 3 min** do login ao fim do catálogo, entrada liberada em menos de
   1 min (depois de Clientes e rota).
3. **Mudanças durante e depois**: preço alterado entre a geração e a carga chega pelo incremental; item apagado depois do pacote
   some; filial nova na carteira ressincroniza pelo pull.
4. **Segurança**: pacote de outro tenant = 404; promotor sem preço não recebe a partição `filial`; filial fora da carteira não é
   oferecida; módulo sem licença não aparece; link vencido renova.
5. **Falhas**: queda no meio do download retoma do byte; md5/contagem errados, sem espaço e servidor sem a rota caem no pull
   paginado e registram no Diagnóstico; troca de geração entre o manifesto e a importação recomeça.
6. **Entrada**: libera depois de Clientes e rota; app fechado no meio reabre já dentro; pedido feito durante a carga é enviado;
   busca online com preço; sem sinal mostra o aviso; indicador some no fim.
7. Valor × regra: a contagem de produtos e o preço na vitrine batem com o BKO depois da carga.

## 5. Divisão em tarefas por dono

Caminhos exclusivos; nenhuma tarefa toca caminho de outra. Números T-nnnn pelo gerente.

| # | Dono | Tarefa | Caminhos (exclusivos) | Depende de | Ordem |
|---|---|---|---|---|---|
| A1 | engenheiro-software | Contratos do SDK (tipos e Zod do §3, sem comportamento) + ADR 0054 | `packages/platform-sdk/src/pacotes-sync.ts` (+ teste), `api.ts`, `sync.ts`, `motor-sync.ts` (só tipos), `sqlite/driver.ts`, `index.ts`; `docs/decisoes/0054-*`, `.coord/contratos/modulos.md` | — | 1º (destrava todos) |
| B | banco-dados | Migração `0070_plataforma_sync_pacote` (tabelas `sync_pacote` e `sync_pacote_pedido`, colunas padrão, RLS, grants `macuxi_app` leitura + pedido, `macuxi_worker` escrita, índice por partição/situação) e índices de leitura por filial se o EXPLAIN pedir (`catalogo.tabela_preco_item (tenant_id, filial_id, updated_at, id)`) | `db/migrations/0070_*`, `docs/banco/sync-pacote.md` | — | paralelo com A1 |
| C | modulo-catalogo | `pacote` nos provedores (partições `tenant` e `filial`, `permitido` pelo RN-CAT-05, `particoesPacote` por `core.filiais@1`); app: busca, ficha e consultas online com `cargaPendente('catalogo')`, aviso sem sinal | `modules/catalogo/api/sync.ts` (+ testes), `modules/catalogo/api/index.ts`, `modules/catalogo/app/**` | A1 | 2º, paralelo |
| D | modulo-core | `pacote` em `produto`, `produto_unidade`, `medida`; RN-CORE-48 revista (catálogo por último) e `entradaLiberada`/`essencialDaEntrada` (função pura, teste citando a RN) | `modules/core/api/sync.ts` (+ teste), `modules/core/domain/entrada-sync.ts` (+ teste), `modules/core/contracts/entrada-sync.ts`, `modules/core/app/index.ts` | A1 | 2º, paralelo |
| A2 | engenheiro-software | Motor: item de pacote, retomada, fallback, `liberado_em`, `pendentes`, `bytes`; SQLite: `importarPacote` (ATTACH, transação, rebuild do FTS); `descompactarGzip` com `fflate`; simulado nos testes | `packages/platform-sdk/src/motor-sync.ts`, `motor-sync.pacote.test.ts`, `sqlite/armazenamento.ts`, `sqlite/driver-node.ts`, `sync-simulado.ts`, `packages/platform-sdk/package.json`, `pnpm-lock.yaml` | A1 | 2º, paralelo |
| A3 | engenheiro-software | Servidor: rotas `/v1/sync/pacotes` e `/arquivo`, gerador no worker (laço, trava, gatilhos, S3/disco, retenção), config e `.env.example` | `apps/api/src/sync-pacotes.ts`, `sync-pacotes-gerador.ts` (+ testes), `worker.ts`, `app.ts`, `config.ts`, `armazenamento-s3.ts` | A1, B (C e D para ter o que gerar) | 3º |
| F | designer-ux | Indicador de carga em segundo plano (componente mobile) e textos: indicador, catálogo carregando sem sinal; simulação para o design-de-marca | `packages/ui/src/**` (componente novo + export), `docs/design/**` | — (contrato: recebe nome da etapa e percentual) | paralelo desde já |
| E | engenheiro-apps | Shell: `transporte.pacotes()`, `baixarPacote` com `Range` e `.part`, leitura/escrita em blocos, espaço livre, `anexar`/`desanexar` no driver expo; ligar `essenciais` (do Core) no motor; gate de entrada por `liberado_em`; tela de carga redireciona ao liberar; monta o indicador do F | `apps/mobile/src/services/{transporte,arquivos,sqlite-expo,motor-do-usuario}.ts` (+ testes), `apps/mobile/src/app/(tabs)/_layout.tsx`, `apps/mobile/src/components/tela-carga.tsx` (+ teste), `apps/mobile/src/state/plataforma.tsx` | A1 (tipos), D (função), F (componente) | 3º |
| G | testes | Roteiro e testes do §4: carga de 150 mil no CI (`tests/carga/`), e2e do stack isolado, roteiro do aparelho com tempos e prints | `tests/**`, `docs/testes/**` | todas | contínuo; fecha por último |

- **Sem tarefa** para modulo-vendedor e modulo-integracao: o Novo pedido usa as consultas do Catálogo, que caem para a API sozinhas
  (C). Se a C mostrar que alguma consulta não pode ser assíncrona, o modulo-catalogo avisa e o gerente abre a tarefa do Vendedor.
- **Gerente**: RN nova e revisão da RN-CORE-48 no doc 03; quadro. **Corretor-redundancias** (textos e tela de carga) e
  **design-de-marca** (indicador e ordem das etapas na tela) antes do lote e do build.
- **Entrega em duas ondas** (cada uma independente): **onda 1 = solução 5** (D + A2 só `liberado_em`/`pendentes` + E sem pacote +
  F + C só busca online): já tira o vendedor da tela de 42%. **Onda 2 = solução 4** (A2 completo, A3, B, C provedores, E download).
  Servidor sem `MACUXI_SYNC_PACOTES=1` e app antigo continuam funcionando; deploy só com "aprovo deploy vX.Y.Z".

## 6. Riscos
- `ATTACH` no expo-sqlite precisa rodar na conexão da transação exclusiva (`withExclusiveTransactionAsync` é outra conexão): o
  engenheiro-apps confirma na E com teste no aparelho antes da onda 2; plano B é ler o arquivo anexado em lotes de 5.000 pelo
  `tx` (mais lento, ainda sem rede no meio).
- Desempenho do `fflate` no Hermes com 20 MB: medir na E; plano B é publicar o `.sqlite` sem gzip quando o `.gz` passar de 30 MB.
- Pacote velho (gerado antes de uma carga grande do ERP sem lote concluído): o incremental cobre; o gatilho agendado de 24 h limita.
