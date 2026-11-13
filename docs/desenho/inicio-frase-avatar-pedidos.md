# Desenho T-0170 — Frase do dia, foto ou avatar do vendedor, DU no Início e os 3 cards de Pedidos

- **Autor**: engenheiro-software · **Data**: 2026-11-12 (Manaus) · **Tarefa**: T-0170 · **Versão alvo**: v1.0.6
- **Origem**: R-20261112-204134-alexandre (pacote T-0170 aprovado), itens 1 (Início), 4 (Pedidos) e 6 (foto ou avatar).
  Imagens em `recados/anexos/2026-11-12-T0170-final-inicio.png`, `-pedidos.png` e `-avatares.png`; frases em
  `recados/anexos/2026-11-12-T0170-final-frases-padrao.md` (repositório `aloirr/macuxifdv-recados`).
- **Fora deste desenho**: sino, Recados e tarefas (tarefas do BKO: `docs/desenho/tarefas-consultor.md`), aba Performance,
  metas de produtividade e o visual (designer-ux, na marca v1 validada pelo design-de-marca).
- **Regras propostas**: RN-CORE-41 (frase do dia), RN-CORE-42 (foto ou avatar), RN-CORE-43 (DU no Início) e RN-VEN-43 (cards
  de Pedidos). O texto para o doc 03 está no §6; o gerente grava.

## 0. Resumo das decisões

| # | Assunto | Decisão técnica |
|---|---|---|
| 1 | Frases | Tabela nova `core.frase_dia`. As 30 padrão nascem por tenant com código fixo (`P01`…`P30`). O BKO cria, edita, desativa, reordena e remove. Pull para o aparelho, escopo tenant. |
| 2 | Rodízio | **Igual para todos os usuários do tenant**, por dia civil no fuso do tenant: índice = dias desde 01/01/1970 mod N, sobre as frases ativas ordenadas. Calculado no aparelho, offline. Sem frase ativa, a linha não aparece. |
| 3 | Foto ou avatar | Tabela nova `core.usuario_avatar`, uma linha viva por usuário: `iniciais` (padrão, sem linha), `avatar` (1 de 6 códigos) ou `foto` (arquivo). Os 6 avatares vêm **dentro do app e do BKO**, sem download. A foto segue a ADR 0010: fila de arquivos, `PUT /v1/arquivos/:id`, bucket privado, JPEG 480×640 feito no aparelho. |
| 4 | Troca | O vendedor troca a própria no Perfil, offline (comando na fila). O BKO troca a de qualquer usuário do tenant. A última troca vence pelo `alterado_em`. |
| 5 | DU | "DU 9 de 20" sai de `diasUteisDoPeriodo` (`@macuxi/comum`) com o calendário do Core (`core.calendario_metas@1`): o mesmo cálculo da Meta/dia. Recomendo contar os feriados nacionais já (decisão D3). |
| 6 | Cards de Pedidos | Função pura nova no Vendedor. Enviado = pedido que chegou ao servidor e não foi recusado nem cancelado. Orçamento em aberto = não convertido e não cancelado. Período pela **data de emissão** no fuso do tenant. Valor = `total_cents` do pedido (sem frete). Dentro da janela de 90 dias, conta no aparelho; fora dela, uma consulta resumida no servidor. |

## 1. Dados e tabelas (pedido ao banco-dados)

Todas com as colunas obrigatórias (`id uuid`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`),
gatilho de `updated_at`, `enable` + `force row level security` e a política `isolamento_tenant` para `macuxi_app`, iguais às
das tabelas do Core (`db/migrations/0002_core.up.sql`). Índice de sync `(tenant_id, updated_at, id)` em cada uma.

### 1.1 `core.frase_dia`

| Coluna | Tipo | Regra |
|---|---|---|
| `texto` | `text not null` | 1 a 120 caracteres depois do `trim`. Check no banco: `char_length(btrim(texto)) between 1 and 120`. |
| `ativa` | `boolean not null default true` | Frase inativa fica no BKO e sai do rodízio. |
| `ordem` | `integer not null` | Ordem do rodízio. O BKO reordena. Empate desempata pelo `id`. |
| `padrao_codigo` | `text null` | `P01`…`P30` nas frases que vieram com o FDV; nulo nas criadas pelo tenant. Check `~ '^P[0-9]{2,3}$'`. |

- **Únicos**: `(tenant_id, padrao_codigo)` **sem** filtro de `deleted_at`: a frase padrão removida pelo tenant não volta em
  nenhuma recarga. Único vivo `(tenant_id, lower(btrim(texto))) where deleted_at is null`: sem frase repetida.
- **Padrão × do tenant**: as duas ficam na mesma tabela e o BKO trata as duas igual (editar, desativar, remover). O
  `padrao_codigo` serve só para a carga ser idempotente e para uma versão futura do FDV acrescentar frases novas sem
  duplicar as que o tenant já tem. A frase padrão editada continua com o código: o texto do tenant vale.
- **Carga das 30 frases**:
  - **tenant novo**: `plataforma.provisionar_tenant` insere as 30, com `ordem` 1…30, na mesma transação (RN-CORE-31);
  - **tenants existentes**: a migração insere as 30 com `on conflict (tenant_id, padrao_codigo) do nothing`;
  - **seed da demo**: as mesmas 30, pela mesma função;
  - o texto das 30 fica num único arquivo SQL da migração, copiado de `2026-11-12-T0170-final-frases-padrao.md`.
- **Limite**: no máximo 366 frases vivas por tenant (uma por dia do ano), conferido no domain e na API (422 `RN-CORE-41`).
- **Pull** `frase_dia`: escopo **tenant**, inclui removidas (o aparelho apaga). SQLite: `core_frase_dia (id, texto, ativa,
  ordem, deleted_at, updated_at)`.

### 1.2 `core.usuario_avatar`

Uma linha **por troca**. A viva é a escolha atual; as anteriores ficam apagadas logicamente (mesmo molde de
`core.cliente_foto`, T-0147). Sem linha viva = iniciais.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` | UUID da troca, gerado no aparelho (ou no navegador, no BKO). É a chave da idempotência. |
| `usuario_id` | `uuid not null` | FK composta `(tenant_id, usuario_id)` → `core.usuario`. |
| `tipo` | `text not null` | `iniciais` \| `avatar` \| `foto`. |
| `avatar_codigo` | `text null` | `m1`, `m2`, `m3`, `f1`, `f2`, `f3`; obrigatório só no `avatar`. |
| `arquivo_id` | `uuid null` | id de `plataforma.arquivo`; obrigatório só na `foto`. Único. |
| `alterado_em` | `timestamptz not null` | Momento da troca no aparelho ou no navegador; decide quem vence (§2.3). |
| `alterado_por` | `uuid not null` | Quem trocou: o próprio vendedor ou o usuário do BKO. |

- **Checks**: `tipo in (...)`; `(tipo = 'avatar') = (avatar_codigo is not null)`; `(tipo = 'foto') = (arquivo_id is not null)`;
  `avatar_codigo in ('m1','m2','m3','f1','f2','f3')`.
- **Único vivo** `(tenant_id, usuario_id) where deleted_at is null`.
- A linha `iniciais` existe só para registrar a volta ao padrão por cima de uma escolha anterior.
- **Pull** `usuario_avatar`: escopo **usuários visíveis** (o vendedor recebe a dele; o supervisor e o gerente, a da equipe).
  Leva só as vivas e as removidas. SQLite: `core_usuario_avatar (id, usuario_id, tipo, avatar_codigo, arquivo_id, alterado_em,
  deleted_at, updated_at)`.

### 1.3 Onde fica a foto

- **Bytes**: no armazenamento de arquivos da plataforma (ADR 0010; S3 da Magalu na demo e na produção, ADR 0020 e ADR 0028),
  **bucket privado**, chave `<tenant_id>/core/<aaaa-mm>/<arquivo_id>.jpg`. Sem URL pública nem pré-assinada (ADR 0037 continua
  só para pacote publicado).
- **Metadados**: `plataforma.arquivo` com `modulo = 'core'`, `finalidade = 'avatar'`, `entidade = 'usuario_avatar'`,
  `entidade_id` = id da troca, `cliente_id` nulo, `enviado_por` = quem enviou, `perfis_leitura` nulo. O Core cria a linha na
  mesma transação do comando (`tx.registrarArquivo`), como em todo arquivo.
- **Tamanho e compressão no aparelho**: recorte 3:4 (o retângulo vertical do Início), redução para **480×640 px** e **JPEG
  qualidade 80** com o `expo-image-manipulator`: fica entre 40 e 90 KB. A regravação descarta o EXIF, inclusive o GPS. No BKO,
  o navegador faz o mesmo com `canvas` (`toBlob('image/jpeg', 0.8)`). O teto da rota continua 2 MB (ADR 0010); o domain do Core
  recusa no `PUT` acima de **300 KB** para `finalidade = 'avatar'` (422 `RN-CORE-42`), para a foto não virar um arquivo de
  câmera cheio.
- **Quem lê** (decisão D4): a foto do vendedor é lida por **qualquer usuário do tenant com o Core**, como um crachá: o
  supervisor na equipe e, depois, os rankings. Na rota `GET /v1/arquivos/:id` isso é uma linha: `core/avatar` entra em
  `ARQUIVOS_DO_TENANT` (`apps/api/src/arquivos.ts`, hoje só `catalogo/foto_produto`). Sem isso, a foto enviada pelo BKO ficaria
  invisível para o próprio vendedor, porque a regra atual olha `enviado_por`.
- **Miniatura**: as listas do Gestão usam `GET /v1/arquivos/:id/miniatura` (320 px, ADR 0036), sem mudança.
- **Foto trocada ou removida**: ao trocar, o Core apaga logicamente a linha anterior de `usuario_avatar` e o
  `plataforma.arquivo` da foto anterior (`deleted_at`), na mesma transação; a leitura passa a dar 404. A remoção dos bytes entra
  no expurgo diário de arquivos apagados, junto com o da RN-CORE-38 (depois da v1.0.5). Usuário desativado: a foto sai do pull
  e é apagada no mesmo expurgo.
- **Sem dado pessoal em log**: o log leva só `arquivo_id`, `usuario_id` e `tenant_id` (UUIDs, já é o padrão de
  `arquivos.ts`). Nunca o nome do usuário, os bytes, base64 ou o nome do arquivo de origem. O aparelho não manda a foto para o
  Sentry.

## 2. Contratos Zod, sync e offline (modulo-core, `modules/core/contracts/`)

### 2.1 `frases.ts`

```ts
export const FRASE_TEXTO_MAX = 120;
export const FRASES_MAX = 366;
export const FraseDiaSyncSchema = z.object({ ...Base, texto: z.string(), ativa: z.boolean(), ordem: z.number().int(),
  padrao_codigo: z.string().nullable() }).strict();
export const FraseDiaCriarSchema = z.object({ texto: z.string(), ativa: z.boolean().default(true) }).strict();   // ordem = fim da lista
export const FraseDiaEditarSchema = z.object({ texto: z.string(), ativa: z.boolean() }).partial().strict();
export const FrasesOrdemSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(FRASES_MAX) }).strict();
```

- **Rotas BKO** (`/v1/core/frases`): `GET` (lista, com a frase de hoje marcada), `POST`, `PUT /:id`, `DELETE /:id` (apaga
  logicamente) e `PUT /ordem` (a lista inteira de ids vivos, na nova ordem; ids faltando ou sobrando = 422).
- **Ação** `frase_dia.editar`: os mesmos perfis de `parametro.inicio` (analista e admin), que já editam o Início. Toda mudança
  vai para a auditoria (RN-AUD-01, como os parâmetros).
- **Sem evento**: o aparelho recebe pelo pull; o aviso de novidades (RN-CORE-23 item 4) já cobre a entidade nova.

### 2.2 `avatar.ts`

```ts
export const AVATARES = ['m1', 'm2', 'm3', 'f1', 'f2', 'f3'] as const;
export const TIPOS_AVATAR = ['iniciais', 'avatar', 'foto'] as const;
export const UsuarioAvatarPushSchema = z.object({
  id: z.string().uuid(), usuario_id: z.string().uuid(), tipo: z.enum(TIPOS_AVATAR),
  avatar_codigo: z.enum(AVATARES).nullable(), arquivo_id: z.string().uuid().nullable(), alterado_em: IsoDateTime,
}).strict().superRefine(/* avatar ⇔ código; foto ⇔ arquivo */);
export const UsuarioAvatarSyncSchema = UsuarioAvatarPushSchema.extend({ ...Base, alterado_por: z.string().uuid() }).strict();
```

- **Sync**: entidade `usuario_avatar` com pull e push. O mesmo contrato serve o BKO: `PUT /v1/core/usuarios/:id/avatar` com o
  corpo `UsuarioAvatarPush` (o navegador gera o UUID com `crypto.randomUUID()`), depois `PUT /v1/arquivos/:arquivo_id` com os
  bytes quando for foto.
- **Permissão**:
  - **app**: ação `usuario_avatar.trocar` para todos os perfis do app; o `receber` recusa `usuario_id` diferente do usuário
    logado (403 `FORA_DO_ESCOPO`);
  - **BKO**: ação `usuario_avatar.trocar_outro`, com os perfis que editam usuários no BKO (grupo "Usuários e senhas" da página
    Perfis de acesso; hoje o admin), recortada pelo escopo de `usuario.ver`.
- **Sem evento**.

### 2.3 Regras do `receber` (domain `modules/core/domain/avatar.ts`, puro, teste antes)

| Caso | Resultado |
|---|---|
| `id` já gravado | aceito, sem mudança (idempotente; reenvio da fila). |
| linha viva com `alterado_em` **maior** que a recebida | aceito como superado: grava a troca já apagada e não muda a escolha. É o caso do aparelho que ficou offline enquanto o BKO trocou depois. |
| caso normal | apaga logicamente a viva (e o arquivo dela, se foto) e grava a nova como viva. |
| `alterado_em` mais de 24 h no futuro em relação ao servidor | grava com o horário do servidor (relógio do aparelho errado; mesma tolerância da pesquisa). |
| `foto` | `tx.registrarArquivo({ id: arquivo_id, modulo: 'core', finalidade: 'avatar', entidade: 'usuario_avatar', entidade_id: id })`. |

### 2.4 Offline e cache no aparelho

- **Avatar sem rede**: os 6 desenhos vêm no pacote do app (`packages/ui`, PNG @2x e @3x, ou SVG se o designer-ux entregar
  vetor). Escolher um grava a linha local e enfileira o comando; aparece na hora, sem sinal. O BKO usa os mesmos arquivos.
- **Foto enviada offline**:
  1. o shell captura (câmera frontal ou galeria), recorta, reduz e grava `<documentos>/fotos/<uuid>.jpg` (serviço do shell,
     §5);
  2. o Core **copia** o arquivo para o cache `<documentos>/avatar/<arquivo_id>.jpg`, grava a linha local
     `usuario_avatar` e enfileira o comando e o arquivo (`motor.enfileirarArquivo`). A foto aparece na hora;
  3. com sinal, o comando sobe antes do arquivo (ADR 0010 §4); o arquivo sobe depois. O original da fila segue a regra dos
     7 dias; o cache fica.
- **Cache da foto de outra pessoa ou vinda do BKO**: depois do pull, o app baixa `GET /v1/arquivos/:id` para
  `<documentos>/avatar/<arquivo_id>.jpg` quando o arquivo não está no cache. Chave = `arquivo_id`: foto nova = arquivo novo, sem
  invalidação. O cache guarda só os `arquivo_id` vivos do pull; os outros são apagados na mesma passada.
- **Sem cache e sem sinal**: mostra as iniciais até baixar. Nunca um quadro vazio.
- **Logout ou troca de usuário**: o cache `avatar/` é apagado junto com os dados do usuário, como hoje.
- **Frases**: só texto, já no SQLite depois do pull. O rodízio não usa rede.

## 3. A regra do rodízio (RN-CORE-41)

```ts
// modules/core/domain/frase-do-dia.ts — puro, sem relógio
export function fraseDoDia(frases: readonly FraseDia[], hoje: string /* AAAA-MM-DD no fuso do tenant */): FraseDia | null {
  const ativas = frases.filter((f) => f.ativa && !f.deleted_at).sort((a, b) => a.ordem - b.ordem || (a.id < b.id ? -1 : 1));
  if (ativas.length === 0) return null;
  const dia = Math.floor(Date.parse(`${hoje}T12:00:00Z`) / 86_400_000);   // dias desde 01/01/1970
  return ativas[dia % ativas.length];
}
```

- **Igual para todos do tenant** (decisão D1): a frase de hoje é a mesma no aparelho de todo mundo e no BKO, que mostra
  "Frase de hoje" na lista. Assim o supervisor pode citar a frase na reunião da manhã.
- **Dia** = data civil no **fuso do tenant**, a mesma do Início (`dataLocal(agora, fuso)`). A frase vira à meia-noite do
  tenant, também sem sinal.
- **Rodízio sem repetir**: com a lista parada, N dias seguidos mostram as N frases, cada uma uma vez, na ordem do BKO.
- **Lista alterada** (frase nova, removida, desativada ou reordenada): a conta continua a mesma e o índice muda a partir do
  próximo pull. A frase do dia pode trocar no meio do dia nesse caso. Aceito pela simplicidade; guardar "a frase de cada dia"
  exigiria uma tabela e um job só para isso.
- **Sem frase ativa**: `null`. A linha da frase **não aparece** e o painel encolhe; não há texto substituto.
- **Exemplo** (12/11/2026, as 30 padrão ativas na ordem do arquivo): dia 20769, 20769 mod 30 = 9, frase nº 10 ("Cada cliente
  atendido é uma relação que cresce.").
- **Recado do dia (RN-CORE-26)** (decisão D2): o recado marcado pelo supervisor **não ocupa a linha da frase**. Ele continua
  como recado, no topo do balão do sino e da tela Recados e tarefas, destacado, porque o card de Recados sai do Início. O
  parâmetro `inicio.recado_do_dia_padrao` ("Bom trabalho hoje!") deixa de ter onde aparecer e sai do BKO, do contrato
  `ParametrosInicio` e do domain: a frase do dia ocupa esse papel.

## 4. Os 3 cards de Pedidos (RN-VEN-43)

### 4.1 Regra (domain `modules/vendedor/domain/resumo-pedidos.ts`, puro, teste antes)

| Card | Conta | Fica de fora |
|---|---|---|
| **Orçamentos em aberto** | `tipo = 'orcamento'`, `status ≠ cancelled` e sem `convertido_pedido_id`: a função `orcamentoEmAberto` que já existe (RN-VEN-18). | convertido (já conta como pedido) e cancelado. |
| **Pedidos enviados** | `tipo ≠ 'orcamento'` e status em `received`, `pending_approval`, `approved`, `sent_to_erp`, `integrated`, `invoiced_partial`, `invoiced`. É o "Enviado" do histórico em tags (RN-VEN-30) em diante. | `draft` (rascunho), `queued` (na fila do aparelho, ainda não enviado; inclui o "Não aceito"), `rejected` (recusado) e `cancelled`. |
| **Total** | orçamentos em aberto + pedidos enviados: soma das quantidades e soma dos valores. | — |

- **Valor**: `total_cents` do documento (RN-VEN-02: com descontos e acréscimos, **sem frete**). No faturado parcial vale o
  valor do pedido ("vendido", RN-GES-06), não o faturado. Soma em centavos (inteiro); a tela formata.
- **Período**: o da `FolhaPeriodo` da tela (Hoje, Ontem, Esta semana, Este mês, Mês passado, Este ano, dia, mês ou ano
  escolhido), pela **data de emissão** no fuso do tenant: `received_at` (o `emitido_em` da busca, T-0077). É a data da meta de
  pedido (RN-CORE-21). O orçamento usa a data em que foi salvo.
- **A lista continua com a regra dela** (emitido **ou** mudou de status no período, RF-VEN-14). Por isso, um pedido de
  outubro faturado em novembro aparece na lista de novembro e não entra nos cards de novembro (decisão D5).
- **Busca por texto e chip de situação não mudam os cards**: os cards resumem o período; os chips filtram a lista.
- **Toque no card** (o ›): "Orçamentos em aberto" filtra a lista nos orçamentos abertos do período; "Pedidos enviados", nos
  enviados; "Total" não navega.
- **Prova pelo mock aprovado**: 6 pedidos na lista; os 5 que não são "Recusado" somam R$ 812,40 + 126,64 + 1.130,00 + 176,96 +
  200,00 = **R$ 2.446,00**, que é o card "Pedidos enviados". O recusado (R$ 455,10) fica fora; o "Em aprovação" entra.
- **Constante única**: `STATUS_ENVIADO` em `modules/vendedor/contracts`, usada pelo domain e pela consulta SQL do §4.2 (o
  teste `.db.test.ts` confere que os dois dão o mesmo número).

### 4.2 Onde se calcula

- **Dentro da janela de 90 dias** (`JANELA_PEDIDOS_DIAS`): no aparelho, com os pedidos do pull mais a fila
  (`mergeOrders`), offline. Trocar o período recalcula em menos de 100 ms com 500 pedidos (mesma meta da RF-VEN-14).
- **Fora da janela**: rota nova `GET /v1/vendedor/pedidos/resumo?from&to[&vendedor_id]`, com o mesmo escopo da listagem
  (carteira ou equipe, licença, `promotor_ve_pedidos`). Devolve
  `{ orcamentos: { quantidade, valor_cents }, enviados: { quantidade, valor_cents } }`; o total é a soma no aparelho. Não usa
  a listagem paginada (até 5 × 200 linhas), que cortaria a soma. Sem sinal, os cards mostram "—" e a mensagem da lista
  (`mensagemForaDaJanela`) vale para a tela toda, sem texto novo.
- **Gestão** (decisão D6): a mesma tela de Pedidos ganha os mesmos cards, somando a equipe ou o vendedor escolhido no filtro.

### 4.3 O que sai

Os cards "Orçamentos" e "A faturar" saem do Início. Saem com eles `resumoOrcamentos`, `resumoAFaturar` e
`components/cards-inicio.tsx` do Vendedor, e a extensão `inicio.cards` deixa de recebê-los. Ficam `orcamentoEmAberto`
(usada pelo card novo) e `pedidoAFaturar` (usada pelo chip "A faturar"). O corretor confere.

## 5. Fonte do calendário de dias úteis (RN-CORE-43)

- **Função**: `diasUteisDoPeriodo(periodo, hoje, feriadosTenant, diasUteisSemana)` de `packages/comum/src/calendar.ts`, a mesma
  da Meta/dia (RN-CORE-26) e da RV (RN-CORE-29). O Início usa a função do domain que já existe (`calendarioDoTenant` em
  `modules/core/domain/meta-do-dia.ts`) e acrescenta só `duDoMes(hoje, calendario) → { atual: number | null, total: number }`:
  - `total` = dias úteis do mês;
  - `atual` = dias úteis antes de hoje + 1, quando hoje é útil;
  - hoje não útil → `atual = null` e a linha fica "Domingo, 15 de novembro · Não é dia útil" (o texto que hoje está em "Sem
    rota hoje · não é dia útil" e sai junto com a linha da rota; continua o único lugar que diz isso).
- **Semana útil**: parâmetro `metas.dias_uteis_semana` do tenant (padrão segunda a sábado, RN-CORE-26), editado no BKO em
  Parâmetros › Início. Chega ao aparelho pelo pull `parametro` e ao Gestor pela consulta `core.calendario_metas@1`.
- **Feriados nacionais**: calculados em `packages/comum/src/feriados.ts` (fixos e móveis pela Páscoa, inclusive Finados e
  20/11). **Hoje não entram**: a RN-CORE-26 diz "sem feriados até existir o cadastro", e o código só passa os nacionais quando
  a lista do tenant não é vazia (`feriadosDoCalendario`). Em novembro de 2026, segunda a sábado, isso dá 25 dias úteis em vez
  de 23 (Finados em 02/11 e Consciência Negra em 20/11), e a Meta/dia fica menor do que deveria.
  - **Recomendação (decisão D3)**: contar os nacionais já. A mudança é uma linha no domain do Core (passar `[]` em vez de
    `undefined` quando o tenant não tem feriado), muda a Meta/dia, a RV projetada e o fechamento no 2º dia útil, e precisa da
    nova redação da RN-CORE-26. Na quinta, 12/11/2026, o Início mostraria "DU 9 de 23".
- **Feriados do tenant** (estaduais e municipais, ex.: 05/09 no Amazonas): ainda não há cadastro. Proponho, numa tarefa
  própria depois da v1.0.6, a tabela `core.feriado` (data, nome) com tela em Parâmetros › Início, entregue pela mesma
  `core.calendario_metas@1`. O Gestor tem hoje outra lista de feriados no `horario_comercial`; a tarefa junta as duas numa
  fonte só.

## 6. RN propostas (texto para o doc 03)

- **RN-CORE-41 Frase do dia.** O Início mostra, abaixo da saudação, a frase do dia. O tenant nasce com as 30 frases padrão do
  FDV; analista e admin adicionam, editam, desativam, reordenam e removem no BKO (até 366, 1 a 120 caracteres, sem repetir).
  A frase de hoje é a mesma para todos os usuários do tenant: entre as frases ativas, na ordem do BKO, a de posição
  (dias desde 01/01/1970 da data de hoje no fuso do tenant) mod (número de frases ativas). Funciona offline. Sem frase ativa, a
  linha não aparece. Frase padrão removida não volta. O recado do dia (RN-CORE-26) não ocupa a linha da frase.
- **RN-CORE-42 Foto ou avatar.** O Início mostra, à direita do nome, a foto ou o avatar do usuário; o padrão são as
  iniciais. No Perfil do app, o usuário envia uma foto (câmera ou galeria, recortada em 3:4, JPEG 480×640, até 300 KB) ou
  escolhe 1 dos 6 avatares (3 masculinos e 3 femininos), ou volta às iniciais. Quem edita usuários no BKO também pode trocar.
  Vale a última troca pelo horário em que foi feita. A foto funciona offline e sobe pela fila; sem a foto no aparelho, aparecem
  as iniciais. A foto é vista pelos usuários do tenant, nunca por URL pública, e sai quando é trocada ou o usuário é desativado.
- **RN-CORE-43 DU no Início.** O topo do Início mostra "DU n de N": n = dias úteis do mês até hoje, contando hoje; N = dias
  úteis do mês, pelo calendário da RN-CORE-26. Em dia não útil, "Não é dia útil" no lugar do DU.
- **RN-VEN-43 Cards de Pedidos.** No topo da tela Pedidos (Campo e Gestão), três cards respeitam o período da tela, pela data
  de emissão no fuso do tenant: **Orçamentos em aberto** (não convertidos e não cancelados), **Pedidos enviados** (do
  "Enviado" em diante: recebido, em aprovação, aprovado, enviado ao ERP, integrado, faturado parcial e faturado; ficam fora
  rascunho, na fila, recusado e cancelado) e **Total** (a soma dos dois). Cada um com quantidade e valor (total do documento,
  sem frete). A busca e o chip de situação filtram só a lista.
- **RN-CORE-26 (ajuste)**: sai a frase padrão do recado do dia (`inicio.recado_do_dia_padrao`); se a D3 for aprovada, "sem
  feriados até existir o cadastro" vira "com os feriados nacionais; os do tenant entram quando houver o cadastro".

## 7. Plano por agente

| Agente | O que faz | Horas |
|---|---|---|
| **banco-dados** | Migração `core.frase_dia` (com as 30 frases e a carga nos tenants existentes) e `core.usuario_avatar`; RLS; `provisionar_tenant`; SQL do pull das duas entidades; SQLite; seed da demo; `.db.test.ts` (RLS entre tenants, únicos, carga idempotente, frase removida não volta). Testes de banco no CI (`stack-isolado.yml`). | 6 |
| **modulo-core** | Domain com teste antes (`fraseDoDia`, `validarFrase`, `duDoMes`, `aplicarTrocaAvatar`, D3 se aprovada); contratos `frases.ts` e `avatar.ts`; rotas do BKO (frases e avatar); `receber` do push; páginas do BKO (Frases do dia em Parâmetros › Início; foto ou avatar na edição do usuário); `inicio-local.ts` passa a entregar `frase`, `du` e `avatar`; tela do Perfil (folha "Foto ou avatar"); cache `avatar/`; retirada do `recado_do_dia_padrao`. | 18 |
| **engenheiro-apps** | Shell: `capturarFotoPerfil()` (câmera frontal ou galeria, recorte 3:4, 480×640, JPEG 80) em `apps/mobile/src/services/camera.ts`; painel do topo do Início em `apps/mobile/src/components/inicio.tsx` (data · DU, saudação, frase, retângulo do avatar); revisão técnica das telas. | 8 |
| **designer-ux** | Spec do painel (DU, frase, avatar), da folha "Foto ou avatar" do Perfil, dos 3 cards de Pedidos; os 6 avatares e as iniciais na marca v1, como arquivos em `packages/ui` (@2x e @3x ou SVG); componente `Avatar` em `packages/ui` (iniciais, código ou foto). | 7 |
| **design-de-marca** | Valida os avatares e o painel na marca v1 antes da implementação. | 1 |
| **modulo-vendedor** | `resumo-pedidos.ts` e `STATUS_ENVIADO` com teste antes (RN-VEN-43); cards na tela Pedidos com o toque que filtra; rota `GET /v1/vendedor/pedidos/resumo`; retirada dos cards do Início (§4.3). | 8 |
| **modulo-gestor** | Cards na Pedidos do Gestão com o filtro de vendedor (se D6 aprovada). | 2 |
| **engenheiro-software** | `core/avatar` em `ARQUIVOS_DO_TENANT` e teto de 300 KB por finalidade na rota de arquivos; nota na ADR 0041 (leitura da foto do usuário pelo tenant); revisão final. | 4 |
| **testes** | Rodízio (fuso, virada à meia-noite sem sinal, lista alterada, sem frase); avatar offline (fila, superado pelo BKO, reenvio idempotente, relógio errado); permissão (vendedor só o próprio; BKO no escopo); RLS entre tenants; cards × regra com o mock (R$ 2.446,00) e fora da janela; DU com e sem feriados. | 8 |
| **corretor-redundancias** | Parecer nas telas (Início, Perfil, Pedidos, BKO) e no código retirado. | 2 |
| **Total** | | **64 h** |

**Ordem**: designer-ux e design-de-marca (avatares e spec) e banco-dados em paralelo → modulo-core e modulo-vendedor →
engenheiro-apps (painel) → testes → corretor → revisão final. Os cards de Pedidos não dependem do resto e podem ir antes.

## 8. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| DU sem feriados nacionais (D3 recusada) | "DU 10 de 25" em vez de "9 de 23" em 12/11; Meta/dia menor | Aprovar a D3; o cadastro do tenant vem depois. |
| Foto de rosto é dado pessoal (LGPD) | Visível para o tenant inteiro | Bucket privado, rota autenticada, sem log, sai na troca e no desligamento; incluir a foto do perfil no termo da T-0145. |
| BKO troca a foto de alguém | Foto sem o consentimento do vendedor | Auditoria da troca; o vendedor volta às iniciais quando quiser. |
| Aparelho offline e BKO trocam | Escolha antiga sobrescreve a nova | Última troca vence pelo `alterado_em` (§2.3). |
| Recorte 3:4 do seletor do Android varia por fabricante | Foto mal enquadrada | O app reduz e centraliza de novo depois do recorte; o retângulo usa `cover`. |
| Frase muda no meio do dia quando o BKO mexe na lista | Duas frases no mesmo dia | Aceito (§3); o BKO mostra a "Frase de hoje" depois de salvar. |
| Cards e lista com regras de período diferentes | Contagem da lista ≠ soma dos cards | D5; os cards não mostram contagem da lista. |
| Mesmo arquivo do Início mexido por outras partes da T-0170 (sino, metas, produtividade) | Conflito entre agentes | O gerente sequencia `inicio.tsx` e `inicio-local.ts` numa frente só. |
| APK anterior | Não conhece as entidades novas | Tudo aditivo: o APK antigo ignora `frase_dia` e `usuario_avatar`; contrato `@1` sem mudança incompatível. |

## 9. Decisões para o Alexandre

- **D1 — Frase igual para todos?** Recomendo **sim**: a mesma frase para o tenant inteiro no dia. Alternativa: cada vendedor
  vê uma frase diferente.
- **D2 — Recado do dia na linha da frase?** Recomendo **não**: o recado do dia fica no sino, destacado no topo, e a linha é
  sempre a frase. A frase padrão do recado ("Bom trabalho hoje!") sai do BKO.
- **D3 — Feriados nacionais no DU e na Meta/dia já na v1.0.6?** Recomendo **sim**. Muda o DU de novembro de 25 para 23 e a
  Meta/dia de todos.
- **D4 — Quem vê a foto?** Recomendo **todos os usuários do tenant**, como um crachá. Alternativa: só o próprio e os chefes.
- **D5 — Período dos cards pela data de emissão?** Recomendo **sim**, como a meta. A lista continua mostrando também o que
  mudou de situação no período.
- **D6 — Os 3 cards também no Pedidos do Gestão?** Recomendo **sim**, somando a equipe ou o vendedor filtrado.
