# Desenho T-0200 — Fotos do cliente: até 3 por item no BKO (a 4ª exclui a mais antiga), só a última no app

- **Autor**: engenheiro-software · **Data**: 2026-11-28 (Manaus) · **Tarefa**: T-0200 · **Versão**: v1.0.44
- **Origem**: R-20261126-204135-alexandre e R-20261126-204214-alexandre. Simulação aprovada "como está" (R-20261127-060714-alexandre,
  "1 A"): `docs/design/fotos-cliente-v1039.md` e os PNGs `01-bko-fotos-cliente`, `02-bko-ampliar-foto` e `03-app-so-a-ultima`
  (commit d5fa1e56, branch `nuvem/v1039-designer-ux-fotos`).
- **Regras**: RN-CORE-38 (fotos do PDV, segue valendo) e **RN-CORE-81** (nova, proposta no §2). **ADR**: nenhuma nova (§9).
- **Migração**: 0110 (reservada no quadro; a última no `main` é a 0109).
- **Resumo da decisão**:
  1. `core.cliente_foto` deixa de ter "uma viva por item" e passa a guardar **até 3 vivas** por (cliente, tipo). Uma coluna nova,
     `vigente`, marca a mais recente; o banco garante uma vigente por item.
  2. A regra da 4ª foto é uma função pura do domínio do Core (`limitarFotosDoItem`, RN-CORE-81), chamada pelo push com o item
     travado. A excluída vai para `deleted_at` e o arquivo dela é **descartado** pela plataforma (`tx.descartarArquivos`).
  3. Os bytes da descartada saem da guarda por um laço do worker (`apps/api/src/worker.ts`), depois do commit; a linha de
     `plataforma.arquivo` guarda `bytes_removidos_em`.
  4. O BKO lê as 3 pela rota que já existe, `GET /v1/core/clientes/:id/fotos`, com um campo novo por item (`fotos`).
  5. O app recebe só a vigente: o pull `cliente_foto` manda as demais como removidas. O contrato do pull não muda.

## 1. Como está hoje
| Ponto | Onde | Situação |
|---|---|---|
| Tipos de foto | `core.foto_tipo` (0057); `modules/core/api/fotos-pdv.ts` | Fachada semeada; admin cria CNH, contrato... (RN-CORE-38) |
| Fotos do cliente | `core.cliente_foto` (0057) | índice único `cliente_foto_vigente_uk (tenant_id, cliente_id, foto_tipo_id) where deleted_at is null`: **uma viva por item** |
| Envio | `modules/core/api/foto-pdv-push.ts` (`receberFotosPdv`) | todo perfil só adiciona (decisão de 24/11, `podeEnviarFoto`); a viva anterior vai para `deleted_at` "até a migração do índice" |
| Bytes | `plataforma.arquivo` + armazenamento (ADR 0010, 0041) | o `deleted_at` da `cliente_foto` não apaga o arquivo: a linha e os bytes ficam para sempre |
| Pull | `modules/core/api/sync.ts`, `TABELAS_SYNC.cliente_foto` | todas as linhas (as apagadas como removidas); `arquivo_id` nulo se o tipo não é fachada |
| App | `modules/core/app/lib/cliente360-local.ts` (`fotoMaisRecente`), visor do shell `apps/mobile/src/app/foto.tsx` | já abre uma foto só |
| BKO | `modules/core/web/components/cliente360/`, `pre-cadastro/pre-cadastros-recusados.tsx` | **não há** seção de fotos do cliente; só o cadastro de tipos (`fotos-pdv/fotos-pdv-page.tsx`) |
| Rota do BKO | `GET /v1/core/clientes/:id/fotos` | resumo tem/falta com o `arquivo_id` da viva (só nos tipos que o perfil abre) |

## 2. Regra nova — RN-CORE-81 (texto para o doc 03, pelo gerente-projetos)
> **RN-CORE-81 Até 3 fotos por item do cliente.** Cada item de foto do cliente (a fachada e cada tipo de documento, RN-CORE-38)
> guarda no máximo **3** fotos. Quando chega a 4ª, a **mais antiga** é excluída, sem aviso, do BKO e da guarda de arquivos.
> "Mais antiga" é a de menor instante da foto (`tirada_em`; sem ele, a hora em que o servidor a recebeu). O BKO mostra as 3, a mais
> recente em destaque; o app (Campo e Gestão) mostra só a mais recente. A API revalida o limite em toda gravação.
> *(Alexandre, R-20261126-204135 e R-20261126-204214; simulação aprovada R-20261127-060714; T-0200.)*

**Premissa do número**: a última RN-CORE no doc 03 é a 79; a 80 está na ADR 0070 (atualização obrigatória do APK) para entrar no
doc 03; nenhum branch aberto (`origin/*` em 28/11) usa a 81. O gerente confirma ao levar o texto ao doc 03.

### 2.1 Função pura — `modules/core/domain/fotos-pdv.ts` (modulo-core; teste antes, citando RN-CORE-81)
```ts
export const FOTOS_POR_ITEM_MAX = 3; // espelho do contracts (FOTOS_POR_ITEM_MAX); um teste confere que são iguais

export interface FotoDoItem { id: string; tirada_em: string | null; recebida_em: string } // ISO UTC

/** RN-CORE-81: com a foto nova somada às vivas do item, quais ficam, qual é a vigente e quais saem. */
export function limitarFotosDoItem(vivas: readonly FotoDoItem[], nova: FotoDoItem, max = FOTOS_POR_ITEM_MAX):
  { manter: string[]; vigente: string; excluir: string[] };
```
- Ordem (mais recente primeiro): `tirada_em ?? recebida_em` decrescente; empate por `recebida_em` decrescente; empate por `id`
  decrescente. Determinística: a mesma entrada sempre dá a mesma saída, em qualquer ordem da lista.
- `manter` = as `max` primeiras, `vigente` = `manter[0]`, `excluir` = o resto (zero, uma, ou mais de uma se o banco já tiver
  sobra por algum motivo: a função corrige).
- **A nova pode ser a excluída**: foto tirada offline há dias e enviada depois de 3 mais novas. Ela é aceita (idempotência do
  aparelho) e sai na mesma hora. É o caso previsto pela regra ("a mais antiga é excluída"), não um erro.
- `nova.id` repetido em `vivas` = erro de programação (o push trata o reenvio antes, pelo `id`).
- `fotoMaisRecente` (já existe) passa a usar a mesma ordem (exporte um comparador único `compararFotosRecentes` e use nos dois).

Casos de teste mínimos (`modules/core/domain/fotos-pdv.test.ts`): 0, 1, 2 e 3 vivas + nova; nova mais antiga que as 3; empates de
`tirada_em`; `tirada_em` nulo (foto antiga/ERP) com `recebida_em`; 5 vivas (sobra) + nova = exclui 3; ordem da entrada embaralhada.

## 3. Modelo de dados — migração 0110 (banco-dados)
Arquivos: `db/migrations/0110_core_cliente_foto_tres.up.sql` e `.down.sql` (nome sugerido; o banco-dados decide), dicionário em
`docs/banco/core.md` e `docs/banco/plataforma.md` ("0110 — até 3 fotos por item"), Drizzle em `modules/core/db/nuvem.ts`
(modulo-core, a coluna `vigente`).

**core.cliente_foto** (aditiva):
1. `vigente boolean not null default false`.
2. Backfill: `vigente = true` nas linhas vivas (hoje há no máximo uma viva por item, garantido pelo índice atual).
3. `drop index core.cliente_foto_vigente_uk`; novo `cliente_foto_vigente_uk on (tenant_id, cliente_id, foto_tipo_id) where vigente
   and deleted_at is null` (unique) e `check cliente_foto_vigente_viva (not vigente or deleted_at is null)`.
4. Índice do item para a leitura do BKO e o push: `cliente_foto_item_ix on (tenant_id, cliente_id, foto_tipo_id) where deleted_at is
   null`.
5. O limite de 3 **não** vai para gatilho: a regra é do domínio e a API revalida (CLAUDE.md, regra 2). O banco só garante uma vigente.
6. **Sem ressuscitar** as fotos já apagadas antes da 0110 (substituídas no BKO da T-0147, apagadas pelo "zerar empresa" da 0100):
   não há como separar umas das outras com segurança. O BKO começa com a vigente e vai juntando até 3.

**plataforma.arquivo** (aditiva):
1. `bytes_removidos_em timestamptz` (nulo = bytes ainda na guarda).
2. Índice parcial `arquivo_descartado_ix on (deleted_at, id) where deleted_at is not null and bytes_removidos_em is null and
   chave_armazenamento is not null`.
3. Funções para o worker (SECURITY DEFINER, `search_path` fixo, EXECUTE só ao `macuxi_worker`, padrão da 0089):
   - `plataforma.arquivos_descartados(p_limite int) returns table (id uuid, tenant_id uuid, chave text)`: só `finalidade = 'pdv'`
     e `entidade = 'cliente_foto'` nesta versão (não muda o que acontece com os outros arquivos), mais antigos primeiro;
   - `plataforma.marcar_bytes_removidos(p_ids uuid[]) returns integer`.
4. Não mexe nas funções `sa_*` nem no kit do Conector (não precisa de PR conjunto `alexandre/*`).

**Down**: volta o índice antigo só se não houver item com mais de uma viva (senão aborta com mensagem: "apague as excedentes antes");
tira `vigente`, `bytes_removidos_em`, o índice e as duas funções.

RLS: as colunas novas herdam o RLS das tabelas (enable + force + isolamento_tenant, 0057/0005). Nada novo para o `macuxi_app`.

## 4. Guarda dos arquivos e exclusão da mais antiga (engenheiro-software, plataforma)
1. **SDK** (`packages/platform-sdk/src/api.ts`, `TransacaoTenant`): método novo, opcional só nos falsos dos testes, no molde do
   `restringirArquivos`:
   ```ts
   /** RN-CORE-81: descarta, NA MESMA transação, os arquivos DO MÓDULO DA ROTA ligados a `entidade`/`entidade_ids`
    *  (deleted_at = now()). O GET passa a dar 404 na hora; os bytes saem depois, pelo worker. Idempotente. */
   descartarArquivos?(alvo: { entidade: string; entidade_ids: readonly string[] }): Promise<{ descartados: number }>;
   ```
   Implementação em `apps/api/src/outbox.ts` (`update plataforma.arquivo set deleted_at = now() where modulo = $1 and entidade = $2
   and entidade_id = any($3) and deleted_at is null`).
2. **Upload depois do descarte** (`apps/api/src/arquivos.ts`, `PUT /v1/arquivos/:id`): a linha descartada do mesmo usuário responde
   **200 `{ descartado: true }`** sem gravar bytes, para a fila do aparelho dar o arquivo por enviado (hoje cairia em 409
   `ARQUIVO_SEM_REFERENCIA`, retentável, e ficaria tentando 7 dias). `for update` na linha serializa o PUT com o descarte.
   Código novo em `CODIGOS_ARQUIVO` só se o motor precisar distinguir (não precisa: 200 = enviado).
3. **Worker** (`apps/api/src/worker.ts` + `apps/api/src/expurgo-arquivos.ts`, novo): laço a cada 10 min (`MACUXI_EXPURGO_ARQUIVOS_MS`),
   liga só se `plataforma.arquivos_descartados` existir (padrão `SQL_EXISTE_*`). Lote de 200: remove `chave` e a miniatura
   (`chaveDaMiniatura`, `.m320.jpg`); objeto inexistente conta como removido; falha numa chave não para o lote (tenta no próximo
   laço). Depois chama `marcar_bytes_removidos`. Log só com contagens (`{ tipo: 'expurgo_arquivos', removidos, falhas }`), sem id,
   chave nem `tenant_id` por linha.
4. Bytes antes do commit nunca são apagados: a remoção só olha linhas já descartadas e confirmadas.
5. O `cache-control: private, max-age=86400` do GET segue: o navegador de quem já abriu a foto pode tê-la em cache por até 1 dia;
   a lista do BKO já não a referencia. Aceito (não há URL pública).

## 5. API (modulo-core) — `/v1/core`, validada por Zod, licença do módulo Core em toda rota
### 5.1 Envio: push `cliente_foto` (`modules/core/api/foto-pdv-push.ts`)
Sem rota nova: o aparelho já envia pelo sync. O que muda dentro da transação de cada item:
1. Mantém: advisory lock pelo `id`, reenvio pelo `id` (`aceito` se já existe, inclusive se já foi excluída), carteira
   (`FORA_DA_CARTEIRA`), cliente vivo, tipo vivo e ativo, `podeEnviarFoto`.
2. **Novo**: segundo lock pelo item, `pg_advisory_xact_lock(hashtext('cliente_foto_item:' || cliente_id || ':' || foto_tipo_id))`,
   para dois aparelhos não passarem de 3 ao mesmo tempo.
3. Sai o `update ... set deleted_at` da vigente anterior. Entra: ler as vivas do item (`id, tirada_em, created_at as recebida_em`),
   inserir a nova (`vigente = false`), chamar `limitarFotosDoItem`, e numa sequência só:
   `update set vigente = false` onde era vigente e não é mais → `update set deleted_at = now(), vigente = false` nas `excluir` →
   `update set vigente = true` na `vigente`. (A ordem respeita o índice único.)
4. `tx.registrarArquivo` da nova (como hoje) e `tx.descartarArquivos({ entidade: 'cliente_foto', entidade_ids: excluir })`.
5. Sem evento novo (a foto não tem consumidor fora do Core). Sem dado pessoal em log.
6. Quem pode: a ação `cliente_foto.enviar` do manifesto (sem mudança). Promotor envia foto do PDV, não pedido: RN-07 do CLAUDE.md
   não se aplica.

### 5.2 BKO: `GET /v1/core/clientes/:id/fotos` (`modules/core/api/fotos-pdv.ts`)
Mantém a ação `cliente_foto.ver`, `carteira: 'filtrar_no_dominio'` com `ctx.carteira()` (404 `CLIENTE_NAO_ENCONTRADO` fora dela) e a
licença do Core. A consulta: vivas do cliente com `join core.usuario u on u.id = f.enviado_por` (mesmo schema), por item na ordem de
`compararFotosRecentes`, no máximo `FOTOS_POR_ITEM_MAX` (a API corta mesmo que o banco tenha sobra). Por item, campos novos
(aditivos; `arquivo_id` continua = a vigente, para quem já lê):
- `pode_abrir` = `podeAbrirFoto(perfil, tipo)` (o perfil sem acesso não vê o cartão no BKO — a tela esconde o cartão);
- `fotos`: `[]` quando `!pode_abrir`; senão até 3, a mais recente primeiro, cada uma `{ id, arquivo_id, tirada_em, enviado_por_nome }`.
`tirada_em` sai em UTC ISO (`coalesce(tirada_em, created_at)`); o BKO formata no fuso do tenant. A situação "tem/falta" não muda.

### 5.3 Abrir a foto
Pela rota que existe, `GET /v1/arquivos/:id` e `/miniatura` (ADR 0010/0041): licença, perfil (`perfis_leitura`) e carteira a cada
leitura. A excluída dá 404 logo depois do commit.

## 6. Contratos Zod — `modules/core/contracts/fotos-pdv.ts` (dono: **modulo-core**; descritos aqui, não editados por mim)
```ts
/** RN-CORE-81: fotos guardadas por item do cliente (fachada e cada documento). */
export const FOTOS_POR_ITEM_MAX = 3;

/** Uma foto do item no BKO (a mais recente primeiro). `tirada_em` em UTC ISO; sem autor = nulo. */
export const FotoDoItemSchema = z.object({
  id: Id,
  arquivo_id: Id,
  tirada_em: z.string().datetime(),
  enviado_por_nome: z.string().nullable(),
});
export type FotoDoItem = z.infer<typeof FotoDoItemSchema>;

// ResumoFotosClienteSchema.itens[] ganha (aditivo, compatível):
//   pode_abrir: z.boolean(),
//   fotos: z.array(FotoDoItemSchema).max(FOTOS_POR_ITEM_MAX),
```
- `ClienteFotoSyncSchema` e `ClienteFotoPushSchema`: **sem mudança** (o pull só deixa de mandar as não vigentes como vivas). O
  comentário do arquivo passa a citar RN-CORE-81 e a regra "a 4ª exclui a mais antiga".
- `ERROS_FOTO_PDV`: sem código novo (a exclusão é silenciosa por regra; nenhum 422 novo).
- `.coord/contratos/`: sem evento, extensão ou dependência nova (registro não muda).

## 7. Sync do app (só a última) — `modules/core/api/sync.ts` (modulo-core)
`TABELAS_SYNC.cliente_foto.tabela` passa a emitir a não vigente como removida:
```sql
case when f.vigente then f.deleted_at else coalesce(f.deleted_at, f.updated_at) end as deleted_at
```
- A vigente anterior vira `vigente = false` na mesma transação; o gatilho `cliente_foto_updated_at` sobe o `updated_at` e o pull
  incremental a reenvia como removida: o aparelho a apaga e fica só com a nova.
- Carga inicial: como hoje (o `puxarDe` decide o que fazer com as removidas). Escopo carteira, `arquivo_id` nulo fora da fachada:
  sem mudança.
- No aparelho, a foto ainda na fila aparece como a mais recente (`fotosComPendentes` + `fotoMaisRecente`, sem mudança). Se o
  servidor a excluir na hora (§2.1, a nova mais antiga), o pull seguinte traz a vigente certa e o pendente some ao ser aceito.
- App antigo (antes da v1.0.44): recebe o mesmo formato e passa a ver só a vigente também. Nada a bloquear por versão.

## 8. Telas
### 8.1 BKO (modulo-core: `modules/core/web/`; designer-ux e design-de-marca conferem com a simulação)
- Componente novo `modules/core/web/components/cliente360/fotos-cliente.tsx` (seção "Fotos", grade 2 colunas; cartão por tipo,
  destaque 16:9 + até 2 linhas; estados 0/1/2/3, carregando, erro com "Tentar de novo"), usado em
  `cliente360/cliente360-page.tsx` e, em 1 coluna, na gaveta de `pre-cadastro/pre-cadastros-recusados.tsx` (`GavetaDoPreCadastro`,
  pelo `cliente_id`). Cliente da rota em `modules/core/web/lib/` (onde já ficam as rotas do Core).
- Diálogo de ampliar `modules/core/web/components/cliente360/ampliar-foto.tsx` (tela cheia, "n de 3", setas, ← → e Esc, foco
  volta). Se o diálogo servir a outros módulos, vira peça do `packages/ui` (designer-ux) — decidir na revisão, não antes.
- Cartão escondido quando `pode_abrir` é falso. Imagem pela miniatura (`caminhoMiniaturaArquivo`) nas linhas e pelo original no
  destaque e no ampliar. Data e hora no fuso do tenant; sem autor, só data e hora.
- Textos exatos da simulação; nenhum texto sobre o limite de 3 ou sobre a exclusão.
- Regras de 27/11: MENOS É MAIS, botões embaixo e juntos (a seção não tem botão de ação; o "Tentar de novo" fica no cartão).

### 8.2 App (Campo e Gestão)
- A seção "FOTOS DO PDV" da ficha não muda. O visor abre só a última: subtítulo `"<Tipo> · dd/mm/aaaa hh:mm"` (hoje só a data)
  montado em `modules/core/app/` (modulo-core).
- ⋮ **Trocar foto** no visor (simulação 03): o visor é do shell (`apps/mobile/src/app/foto.tsx`, `apps/mobile/src/lib/visor-foto.ts`,
  engenheiro-apps). `PedidoAbrirFoto` ganha `trocar?: { cliente_id: string; foto_tipo_id: string; nome_cliente: string }`; o ⋮ abre
  a `folha-foto-pdv` (câmera ou galeria) e o envio segue pelo `enviarFotoPdv` do Core, como o "Adicionar". "Trocar" no app =
  adicionar uma nova (a anterior fica no BKO; RN-CORE-81). O tipo `abrirFoto` no `AmbienteModulo` do SDK é meu e entra junto
  (pendência antiga citada em `apps/mobile/src/services/ambiente.ts`).

## 9. Permissões, escopo, segurança e por que não há ADR
- Licença do módulo Core em toda rota (montagem do `apps/api`); ação `cliente_foto.ver`/`cliente_foto.enviar` do manifesto;
  carteira no push e no GET; `perfis_leitura` no arquivo (sensível: admin, analista, gerente, supervisor).
- Sem dado pessoal em log: o push e o worker logam só contagens; nada do cliente nem do nome de quem enviou.
- Fixtures fictícias (UUIDs `U(n)`, "Cliente Teste", "Usuária Teste").
- **Sem ADR nova**: não há dependência nova nem contrato incompatível (campos aditivos; pull com o mesmo schema). A exclusão de
  bytes é a primeira da ADR 0010 para foto de módulo, mas fica restrita por função ao `cliente_foto`; se outro módulo quiser
  descartar arquivos, aí entra uma ADR (número só pelo quadro, lição 13).

## 10. Critérios de teste (Postgres local na sessão, sem Docker)
| # | Onde (dono) | O que prova |
|---|---|---|
| 1 | `modules/core/domain/fotos-pdv.test.ts` (modulo-core) | RN-CORE-81: casos do §2.1, ordem e empates |
| 2 | `db/testes/foto-pdv.test.ts` (banco-dados) | 0110: backfill (vigente = a viva); duas vigentes no item → 23505; vigente apagada → 23514; outro tenant não vê (RLS); `arquivos_descartados`/`marcar_bytes_removidos` só no `macuxi_worker`; down aborta com 2 vivas |
| 3 | `modules/core/api/fotos-pdv.db.test.ts` (modulo-core, novo) | push da 1ª à 5ª foto do mesmo item: ficam 3, a mais antiga com `deleted_at` e o arquivo descartado; a nova mais antiga sai na hora; reenvio do mesmo `id` (inclusive o excluído) = `aceito` sem nova escrita; dois pushes simultâneos não passam de 3; fora da carteira = `FORA_DA_CARTEIRA`; GET do BKO devolve até 3 na ordem, `pode_abrir` falso + `fotos: []` para vendedor em documento; módulo sem licença = 403 |
| 4 | `modules/core/api/sync.db.test.ts` ou o mesmo arquivo (modulo-core) | pull incremental depois da 2ª foto: a 1ª volta removida e a 2ª viva; o aparelho fica com 1 linha |
| 5 | `apps/api/src/arquivos.db.test.ts` e `expurgo-arquivos.test.ts` (engenheiro-software) | `descartarArquivos` só do módulo da rota; GET 404 depois do descarte; PUT depois do descarte = 200 `{ descartado: true }` sem bytes; worker remove original e miniatura, marca `bytes_removidos_em`, objeto inexistente conta como removido, log sem id |
| 6 | `tests/modulos/fotos-cliente-t0200.test.ts` (testes) | ponta a ponta com o motor: 4 fotos do aparelho → app com só a última, BKO com 3, a 1ª some do armazenamento falso |
| 7 | testes de tela do BKO e do app (modulo-core, engenheiro-apps) | estados 0/1/2/3, carregando, erro; "n de 3", setas nas pontas, Esc e foco; visor sem contador nem setas |

## 11. Divisão do trabalho e estimativa
| Etapa | Dono | Arquivos | Estimativa |
|---|---|---|---|
| Banco | banco-dados | `db/migrations/0110_*.up.sql` e `.down.sql`, `db/testes/foto-pdv.test.ts`, `docs/banco/core.md`, `docs/banco/plataforma.md`, `docs/banco/README.md` | 4 h |
| Plataforma | engenheiro-software | `packages/platform-sdk/src/api.ts` (`descartarArquivos`, tipo `abrirFoto`), `apps/api/src/outbox.ts`, `apps/api/src/arquivos.ts` (PUT descartado), `apps/api/src/expurgo-arquivos.ts` (novo), `apps/api/src/worker.ts` e testes | 5 h |
| Core: domínio, contratos e API | modulo-core | `modules/core/domain/fotos-pdv.ts` (+test), `modules/core/contracts/fotos-pdv.ts`, `modules/core/api/foto-pdv-push.ts`, `modules/core/api/fotos-pdv.ts`, `modules/core/api/sync.ts`, `modules/core/db/nuvem.ts`, `modules/core/api/fotos-pdv.db.test.ts` | 9 h |
| Core: telas | modulo-core | `modules/core/web/components/cliente360/fotos-cliente.tsx` e `ampliar-foto.tsx` (novos), `cliente360-page.tsx`, `pre-cadastro/pre-cadastros-recusados.tsx`, `modules/core/web/lib/` (cliente da rota), `modules/core/app/` (subtítulo e `trocar` no pedido do visor) | 8 h |
| Shell | engenheiro-apps | `apps/mobile/src/lib/visor-foto.ts`, `apps/mobile/src/app/foto.tsx` (⋮ Trocar foto), `apps/mobile/src/services/ambiente.ts` | 3 h |
| Conferência visual | designer-ux, design-de-marca | prints contra os PNGs 01, 02 e 03 | 1,5 h |
| Testes | testes | `tests/modulos/fotos-cliente-t0200.test.ts`, roteiro do lote, valor × regra | 4 h |
| Corretor e revisão final | corretor-redundancias, engenheiro-software | parecer e revisão | 1,5 h |
| **Total** | | | **36 h** |

Ordem: banco e plataforma em paralelo (caminhos distintos) → Core domínio/API → Core telas e shell em paralelo → conferência →
testes e corretor → revisão final. Observação: as telas do BKO e da ficha do app estão em `modules/core/web` e `modules/core/app`,
que são do **modulo-core** (`.coord/donos.json`); ao engenheiro-apps cabe só o shell (visor).
