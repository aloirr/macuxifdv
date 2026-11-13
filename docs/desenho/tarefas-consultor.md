# Desenho — Tarefas do consultor (Recados e tarefas, T-0170)

- **Autor:** engenheiro-software · **Data:** 13/11/2026 · **Situação:** proposta, aguarda as decisões do §10
- **Pedido:** Alexandre, R-20261112-204134-alexandre, itens 2 e 3 (sino em todas as telas; "Recados e tarefas" com tarefas do BKO)
- **Imagens:** `recados/anexos/2026-11-12-T0170-final-recados-e-tarefas.png` e `-final-inicio-sino-aberto.png` (repositório de recados)
- **Base:** RF-CORE-09, RN-CORE-03/04/33/35, RN-PRO-01, RN-PES-01/04/06; ADR 0009 (comando de push), 0010 (fotos), 0012 e 0019
  (consultas), 0025 (licença do tenant), 0033 (permissão por perfil); desenho T-0016 §5 (central de notificações)
- **Versão alvo:** v1.0.6 (fora do build da v1.0.5)
- **Escopo deste documento:** só o desenho. Nenhum código, migração, contrato ou tela muda nesta frente.

---

## 1. RF proposto

**RF-CORE-18 (P0) Tarefas do consultor.** 🖥️📱C (número a confirmar pelo gerente no doc 02)

- **Quem cria:** no BKO, o gerente, o analista e o admin, para pessoas do próprio escopo (RN-CORE-04). O supervisor não entra no
  BKO (RN-CORE-33): ver a decisão **D1** no §10.
- **Para quem:** um ou mais consultores (vendedor ou promotor), uma equipe ou todos os consultores do escopo de quem cria.
- **Campos:**

  | Campo | Regra |
  |---|---|
  | Título | obrigatório, 1 a 120 caracteres |
  | Descrição | opcional, até 1000 caracteres |
  | Prazo | obrigatório, data civil no fuso do tenant, hoje ou depois |
  | Cliente | opcional; precisa estar na carteira do destinatário (§8, RN-CORE-TAR-04) |
  | Tipo | `simples` (marcar como feita), `foto` (1 a 5 fotos pela câmera) ou `pesquisa` (um questionário publicado do módulo Pesquisa) |

- **No app Campo:** a tarefa aparece no sino, no balão e na tela "Recados e tarefas". O consultor conclui ali:
  - **simples:** marca a caixa;
  - **foto:** tira as fotos e marca;
  - **pesquisa:** responde ao questionário; a tarefa se conclui sozinha quando a resposta chega ao servidor.
- **No BKO:** cadastro, cancelamento e acompanhamento (feitas, abertas, atrasadas e canceladas, por tarefa e por consultor).
- **Offline:** concluir funciona sem sinal e sobe na próxima sincronização.

---

## 2. Onde a tarefa fica e como se junta aos recados

### 2.1 Módulo: Core

A tarefa fica no **Core**, no schema `core`, ao lado de `core.notificacao`. Motivos:

1. **A lista é do Core.** O sino, o balão e a tela "Recados e tarefas" são a central de notificações (RF-CORE-09), que já é do
   Core. Se a tarefa ficasse em outro módulo, o Core precisaria ler as tabelas dele ou depender dele, e a regra 1 proíbe as duas
   coisas.
2. **O Core é obrigatório.** Todo consultor tem Core, então a tarefa não depende de licença nova. Só o tipo `pesquisa` depende de
   outro módulo, e o Core já consome o evento da Pesquisa.
3. **O destinatário, a equipe, o escopo e a carteira já são do Core** (`usuariosVisiveis`, `core.carteira`).

Não criamos um módulo `tarefas` novo: ele só existiria para ser lido pelo Core.

**Tarefa de campanha do Promotor (RF-PRO-10, `promotor.tarefa_trade`).** Ela continua no Promotor. As duas são diferentes:

| | Tarefa do consultor (esta) | Tarefa de campanha (RF-PRO-10) |
|---|---|---|
| Alvo | uma pessoa, uma equipe ou todos | uma loja, um segmento ou todas as lojas |
| Onde aparece | sino e "Recados e tarefas" | checklist da visita à loja |
| Comprovação | caixa, foto ou pesquisa | foto, dentro da visita |

O corretor vai ver dois conceitos com o nome "tarefa": a decisão **D7** do §10 define como ficam.

### 2.2 Uma lista só, sem duplicar o modelo

A tarefa tem duas partes:

- **o aviso**: é novo ou não, sobe o número do sino, vai por push. Isso já existe e é a `core.notificacao`;
- **a execução**: prazo, situação, comprovação e cancelamento. Isso é novo e fica em `core.tarefa` e `core.tarefa_destinatario`.

**Como funciona:**

- **Criar a tarefa** grava, na mesma transação, uma `core.notificacao` por destinatário, com:
  - `tipo = 'sistema'`;
  - `subtipo = 'tarefa'`;
  - a coluna nova `tarefa_id`.

  O push, a leitura (`notificacao_leitura`), a janela de 30 dias e o evento `core.notificacao.criada@1` são os que já existem.
- **O sino** soma as notificações não lidas, com a função `contarNaoLidas` de hoje. Essa soma já inclui recados, avisos de pedido
  e avisos de tarefa. Não existe um segundo contador de "tarefa nova".
- **A lista** é montada no aparelho por uma função pura nova do Core, `montarRecadosETarefas(notificacoes, tarefas, fila, agora)`:
  - cada tarefa vira um item;
  - a notificação com `subtipo = 'tarefa'` não aparece como item: ela só marca a tarefa como "nova" (ponto laranja) até ser lida;
  - as outras notificações aparecem como hoje.
- **Abrir a tarefa ou concluí-la** lê a notificação dela (o comando `notificacao_leitura` que já existe), e o sino desce.

**Por que não `tipo = 'tarefa'`.** O `NotificacaoSyncSchema` tem `tipo: z.enum(TIPOS_NOTIFICACAO)`, e o app lê com `tolerante()`.
Um valor novo no enum derruba o pull da notificação nos aparelhos com a v1.0.5 ("vocabulário novo = @2 + ADR"). Com
`tipo = 'sistema'` e `subtipo = 'tarefa'`, o app antigo mostra "Aviso do sistema · Nova tarefa: …" e não quebra. O `subtipo` já é
um texto livre validado (migração 0030), e `tarefa_id` entra como campo opcional, que é uma mudança aditiva.

**Por que não guardar a tarefa dentro de `core.notificacao`.** A notificação some do aparelho depois de 30 dias e não tem prazo,
cancelamento, comprovação nem tipo. A tarefa aberta precisa ficar no aparelho até ser feita, mesmo depois de 30 dias.

---

## 3. Tabelas (pedido ao banco-dados)

Migração aditiva `00NN_core_tarefa` (o número é do banco-dados). O dicionário fica em `docs/banco/core.md`. As duas tabelas novas
seguem o padrão da 0006:

- colunas comuns: `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`;
- RLS `enable` + `force` com a política `isolamento_tenant`;
- gatilho de `updated_at`;
- chaves estrangeiras compostas `(tenant_id, x_id)`;
- `external_id` único por tenant (`where external_id is not null and deleted_at is null`);
- grants para o `macuxi_app` sem `delete`: remover = `deleted_at`.

### 3.1 `core.tarefa`: a tarefa como foi cadastrada

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid | gerado no BKO (idempotência do POST) |
| `tenant_id` | uuid | |
| `autor_id` | uuid | chave para `core.usuario`; quem criou |
| `titulo` | text | `check` 1..120 |
| `descricao` | text null | `check` ≤ 1000 |
| `prazo` | date | data civil no fuso do tenant |
| `cliente_id` | uuid null | chave para `core.cliente` |
| `tipo` | text | `check in ('simples','foto','pesquisa')` |
| `questionario_id` | uuid null | **sem chave estrangeira** (schema `pesquisa`, regra 1); `check ((tipo = 'pesquisa') = (questionario_id is not null))` |
| `alvo` | text | `check in ('usuarios','equipe','todos')`; só para mostrar no BKO |
| `equipe_id` | uuid null | quando `alvo = 'equipe'` |
| `cancelada_em` | timestamptz null | |
| `cancelada_por` | uuid null | chave para `core.usuario` |
| `motivo_cancelamento` | text null | `check` ≤ 300 |
| colunas comuns | | `created_at`, `updated_at`, `deleted_at`, `external_id` |

Mais duas restrições:

- `check ((cancelada_em is null) = (cancelada_por is null))`;
- a unicidade `(tenant_id, id)`, para a chave composta da tabela abaixo.

**Índices:**

- `tarefa_sync_ix (tenant_id, updated_at, id)`;
- `tarefa_autor_ix (tenant_id, autor_id, created_at desc)`, para a lista do BKO;
- `tarefa_prazo_abertas_ix (tenant_id, prazo) where cancelada_em is null and deleted_at is null`, para as atrasadas;
- `tarefa_external_uk`.

### 3.2 `core.tarefa_destinatario`: uma linha por consultor

Esta é a linha que vai ao aparelho.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid | id da linha de sync |
| `tenant_id` | uuid | |
| `tarefa_id` | uuid | chave composta para `core.tarefa` |
| `usuario_id` | uuid | chave para `core.usuario` |
| `concluida_em` | timestamptz null | hora do aparelho (RN-CORE-TAR-06) |
| `recebida_em` | timestamptz null | hora do servidor ao aceitar |
| `conclusao_id` | uuid null | UUID do comando, para a idempotência |
| `observacao` | text null | `check` ≤ 500 |
| `resposta_id` | uuid null | resposta da Pesquisa (sem chave estrangeira) |
| `suspeita` | boolean | padrão `false`; relógio adiantado (RN-CORE-TAR-06) |
| colunas comuns | | `created_at`, `updated_at`, `deleted_at`, `external_id` |

**Restrições:**

- `unique (tenant_id, tarefa_id, usuario_id)`: a mesma tarefa não vai duas vezes à mesma pessoa;
- `unique (tenant_id, conclusao_id) where conclusao_id is not null`;
- `check ((concluida_em is null) = (recebida_em is null))`.

**Índices:**

- `tarefa_dest_sync_ix (tenant_id, updated_at, id)`;
- `tarefa_dest_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)`, para o pull `proprio`;
- `tarefa_dest_abertas_ix (tenant_id, usuario_id) where concluida_em is null and deleted_at is null`;
- `tarefa_dest_tarefa_ix (tenant_id, tarefa_id)`, para o acompanhamento.

**Fotos.** As fotos ficam em `plataforma.arquivo` (ADR 0010), com:

- `modulo = 'core'`, `finalidade = 'tarefa'`;
- `entidade = 'tarefa_destinatario'`, `entidade_id = <id>`;
- `cliente_id` da tarefa, para o escopo de leitura.

Não há tabela de fotos nova.

### 3.3 Mudança em `core.notificacao` (aditiva)

- Coluna nova `tarefa_id uuid null`, com chave composta para `core.tarefa` e `check (tarefa_id is null or subtipo = 'tarefa')`.
- `unique (tenant_id, usuario_id, tarefa_id) where tarefa_id is not null`: criar a mesma tarefa de novo não duplica o aviso.
- **Gatilho de `updated_at` em `core.tarefa`:** alterar o prazo, a descrição ou o cancelamento também mexe no `updated_at` das
  linhas de `core.tarefa_destinatario` da tarefa. Assim o pull, que lê pelo destinatário, traz a mudança. Quem implementa (o
  gatilho ou a própria API) fica a critério do banco-dados.

### 3.4 No aparelho (SQLite)

- **Entidade de pull `tarefa`:** a linha do destinatário com os dados da tarefa.
- **Entidade de push `tarefa_conclusao`:** só envio.
- O registro vai em `docs/banco/aparelho-sqlite.md`.

---

## 4. Contratos (Zod) e eventos

Os contratos ficam em `modules/core/contracts/tarefa.ts` (dono: modulo-core) e os eventos são registrados em
`.coord/contratos/` (engenheiro-software).

### 4.1 Contratos

```ts
export const TIPOS_TAREFA = ['simples', 'foto', 'pesquisa'] as const;

// BKO → POST /v1/core/tarefas
export const CriarTarefaSchema = z.object({
  id: z.string().uuid(),                                   // idempotência: mesmo id = mesma tarefa
  titulo: z.string().trim().min(1).max(120),
  descricao: z.string().trim().max(1000).nullable().default(null),
  prazo: DataCivil,                                        // 'AAAA-MM-DD'; ≥ hoje no fuso do tenant (API revalida)
  cliente_id: z.string().uuid().nullable().default(null),
  tipo: z.enum(TIPOS_TAREFA),
  questionario_id: z.string().uuid().nullable().default(null),
  destino: z.discriminatedUnion('alvo', [
    z.object({ alvo: z.literal('usuarios'), usuario_ids: z.array(z.string().uuid()).min(1).max(500) }).strict(),
    z.object({ alvo: z.literal('equipe'), equipe_id: z.string().uuid() }).strict(),
    z.object({ alvo: z.literal('todos') }).strict(),
  ]),
}).strict().refine((v) => (v.tipo === 'pesquisa') === (v.questionario_id !== null), { path: ['questionario_id'] });

export const CriarTarefaRespostaSchema = z.object({
  tarefa_id: z.string().uuid(), destinatarios: z.number().int(), ja_existia: z.boolean(),
}).strict();

// BKO → PATCH /v1/core/tarefas/:id (só prazo e descrição; o resto não muda, RN-CORE-TAR-09)
export const EditarTarefaSchema = z.object({ prazo: DataCivil.optional(), descricao: z.string().trim().max(1000).nullable().optional() }).strict();

// BKO → POST /v1/core/tarefas/:id/cancelar
export const CancelarTarefaSchema = z.object({ motivo: z.string().trim().min(1).max(300) }).strict();

// Pull 'tarefa' (escopo 'proprio'): uma linha por destinatário
export const TarefaSyncSchema = z.object({
  ...Base,                                                 // id = tarefa_destinatario.id
  tarefa_id: z.string().uuid(),
  usuario_id: z.string().uuid(),
  titulo: z.string().max(120),
  descricao: z.string().max(1000).nullable(),
  prazo: DataCivil,
  tipo: z.enum(TIPOS_TAREFA),
  cliente_id: z.string().uuid().nullable(),
  cliente_nome: z.string().nullable(),                     // instantâneo para o caso de o cliente sair da carteira
  questionario_id: z.string().uuid().nullable(),
  autor_nome: z.string().nullable(),
  autor_perfil: PerfilSchema.nullable(),                   // origem ("Tarefa da supervisão"), texto do designer-ux
  concluida_em: z.string().datetime().nullable(),
  cancelada_em: z.string().datetime().nullable(),
}).strict();

// Push 'tarefa_conclusao' (comando, ADR 0009; conflito 'somente_insercao')
export const ConclusaoTarefaSchema = z.object({
  id: z.string().uuid(),                                   // UUID do comando, gerado no aparelho
  tarefa_destinatario_id: z.string().uuid(),
  concluida_em: z.string().datetime(),                     // hora do aparelho
  foto_ids: z.array(z.string().uuid()).max(5).default([]), // obrigatório (1..5) no tipo 'foto'; a API revalida
  observacao: z.string().trim().max(500).nullable().default(null),
}).strict();

// GET /v1/core/tarefas (BKO) e GET /v1/core/tarefas/:id
export const TarefaListaQuerySchema = z.object({
  situacao: z.enum(['abertas', 'atrasadas', 'concluidas', 'canceladas']).optional(),
  usuario_id: z.string().uuid().optional(), equipe_id: z.string().uuid().optional(),
  de: DataCivil.optional(), ate: DataCivil.optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
// Resumo por tarefa: total, feitas, feitas_no_prazo, abertas, atrasadas, sem_consultor_ativo (RN-CORE-TAR-10)
// Resumo por consultor: abertas, atrasadas, feitas_no_prazo, feitas_com_atraso, pct_no_prazo
```

O `NotificacaoSyncSchema` ganha `tarefa_id: z.string().uuid().nullable().optional()`, que é aditivo. O `subtipo = 'tarefa'` entra
na lista de valores conhecidos do Core.

### 4.2 Eventos (sem título nem descrição no payload; dado pessoal fica no banco, como no `core.notificacao.criada@1`)

| Evento | Payload | Consumidores |
|---|---|---|
| `core.tarefa.criada@1` | `tarefa_id`, `autor_id`, `tipo`, `cliente_id`, `prazo`, `usuario_ids` (≤ 500), `criada_em` | Gestor (painéis) |
| `core.tarefa.concluida@1` | `tarefa_id`, `tarefa_destinatario_id`, `usuario_id`, `cliente_id`, `tipo`, `concluida_em`, `recebida_em`, `no_prazo`, `fotos_total`, `resposta_id`, `suspeita` | Gestor (ficha: tarefas cumpridas, RF-GES-10) |
| `core.tarefa.cancelada@1` | `tarefa_id`, `cancelada_por`, `cancelada_em`, `abertas_no_cancelamento` | Gestor |

- O aviso ao consultor **não** usa um consumidor de `core.tarefa.criada@1`: a notificação é gravada na mesma transação e publica
  o `core.notificacao.criada@1` que já existe. O push sai pelo consumidor de hoje (`push.ts`).
- O manifesto do Core passa a ter:
  - `publica`: os 3 eventos;
  - `sync`: `tarefa` e `tarefa_conclusao`;
  - `acoes`: as do §6;
  - menu do BKO: "Tarefas".

### 4.3 Tarefa do tipo pesquisa: o Core consome um evento que já existe

O Core já consome `pesquisa.resposta.registrada@1`. O consumidor ganha mais um passo:

- **Passo novo:** a resposta conclui a **mais antiga** linha aberta de `core.tarefa_destinatario` que atenda a tudo isto:
  - mesmo `usuario_id`;
  - tarefa `tipo = 'pesquisa'` com o mesmo `questionario_id`;
  - mesmo cliente, se a tarefa tiver cliente;
  - linha criada antes do `recebida_em` da resposta;
  - tarefa não cancelada.
- **O que ele grava:** `concluida_em = respondida_em`, `recebida_em`, `resposta_id` e `suspeita`. O `conclusao_id` fica nulo.
- **Idempotência:** se a linha já tem `resposta_id`, nada muda.

Assim, o contrato da Pesquisa não muda, e não há corrida entre o push da resposta e o da conclusão. No aparelho não existe
comando de conclusão para esse tipo.

**Consultas novas da Pesquisa (ADR 0012), usadas pelo Core como opcionais (ADR 0019):**

| Consulta | Lado | Entrada → saída | Para quê |
|---|---|---|---|
| `pesquisa.questionarios_para_tarefa@1` | API | `{ usuario_ids (≤500) }` → `[{ questionario_id, titulo, vigente_ate, fora_do_publico: uuid[] }]` | escolher o questionário no cadastro e recusar quem não pode responder |
| `pesquisa.resposta_local@1` | aparelho | `{ questionario_id, cliente_id \| null, desde }` → `{ resposta_id \| null }` | mostrar "Respondida" antes de sincronizar |

Sem o módulo Pesquisa, o tipo `pesquisa` some do cadastro (RN-CORE-03), e as consultas respondem `ConsultaIndisponivel`.

---

## 5. Sync e offline

| Entidade | Direção | Escopo | Conflito | Janela |
|---|---|---|---|---|
| `tarefa` | pull | `proprio` (só as do usuário) | `servidor_vence` | abertas e não canceladas: **sempre**; concluídas ou canceladas: até 30 dias depois |
| `tarefa_conclusao` | push | — | `somente_insercao` | — |

**Fluxo da conclusão offline:**

1. **No aparelho**, o consultor marca a caixa ou tira as fotos. O app gera o UUID do comando e grava `tarefa_conclusao` na fila:
   - no tipo `foto`, cada foto tem UUID do aparelho e vai para a fila de arquivos (`motor.enfileirarArquivo`);
   - o item da fila leva os `foto_ids`.
2. **Na tela**, a sobreposição (ADR 0009 §3) mostra a tarefa feita, com o aviso de pendência que a tela de sync já usa. O sino
   desce porque a `notificacao_leitura` também vai para a fila.
3. **No servidor**, o `receber` de `tarefa_conclusao`:
   - confere o dono (`usuario_id = sessão`). Linha de outro usuário recebe a mesma resposta de uma linha que não existe:
     `TAREFA_NAO_ENCONTRADA`;
   - no tipo `foto`, confere de 1 a 5 fotos e chama `tx.registrarArquivo` para cada uma, que fica `aguardando` (ADR 0010). O
     arquivo sobe depois dos itens;
   - grava `update … set concluida_em, recebida_em = now(), conclusao_id … where id = $1 and concluida_em is null`;
   - publica `core.tarefa.concluida@1`.
4. **Idempotência:**
   - reenviar o mesmo comando acha `conclusao_id` igual e responde `aceito`, sem novo evento;
   - outro comando para uma linha já concluída também responde `aceito`, sem gravar: vale a primeira conclusão.
5. **Tarefa cancelada antes de a conclusão chegar** (RN-CORE-TAR-08): a resposta é `aceito`, para não travar a fila do consultor
   com um item que ele não tem como corrigir. A conclusão é gravada, mas não entra nos números da tarefa cancelada.
6. **Tipo `pesquisa`:** não há comando. A resposta sobe pela fila da Pesquisa, e o consumidor do §4.3 conclui a tarefa.

**Desfazer:** o consultor pode desmarcar enquanto a conclusão ainda está na fila, sem ter subido. O app descarta o comando, como a
fila já faz. Depois que o servidor aceitou, não há desfazer no app: ver a decisão **D4**.

**Volume:** com tarefas de 30 dias, 20 consultores e 5 tarefas por semana, são cerca de 20 linhas por pessoa no aparelho. O pull
por `(tenant_id, usuario_id, updated_at, id)` segue o índice. O BKO limita cada criação a 500 destinatários, o mesmo limite do
recado.

---

## 6. Permissões, licença e escopo

### 6.1 Ações novas do Core (padrão de fábrica editável, ADR 0033)

| Ação | Perfis | Escopo |
|---|---|---|
| `tarefa.criar` | gerente, analista, admin | destinatários em `usuariosVisiveis()` (RN-CORE-04); fora do escopo → 403 `FORA_DO_ESCOPO` |
| `tarefa.editar` | gerente, analista, admin | só prazo e descrição; a tarefa precisa ser do escopo de quem edita |
| `tarefa.cancelar` | gerente, analista, admin | mesmo escopo de `tarefa.editar` |
| `tarefa.acompanhar` | gerente, analista, assistente (só leitura), admin | o recorte do escopo |
| `tarefa.concluir` | vendedor, promotor | só as próprias (pull `proprio`) |

- A tabela da RN-CORE-35 fica como está: nenhuma das ações acima é travada.
- **Supervisor:** o RN-CORE-33 tira o supervisor do BKO. Se o Alexandre quiser que o supervisor crie tarefas, isso tem de ser pelo
  app Gestão (decisão **D1**).

### 6.2 Licença

- O Core é obrigatório, então criar, ver e concluir tarefas não dependem de licença nova. Toda rota passa pela checagem de licença
  do SDK, como as outras do Core.
- **Tipo `pesquisa`:**
  - precisa da Pesquisa ativa no tenant (ADR 0025);
  - precisa da Pesquisa efetiva para **cada** destinatário. O Core é dono das licenças e confere isso sem consultar ninguém;
  - destinatário sem o módulo ou fora do público do questionário → 422 `RN-CORE-TAR-03`, com a lista de nomes.
- **Pesquisa desligada depois da criação:** a tarefa fica no app com o texto "Pesquisa indisponível" e sem a caixa. No BKO, ela
  aparece como "sem módulo" (RN-CORE-TAR-11).

### 6.3 Carteira

- **Tarefa com cliente:**
  - destino `usuarios`: todo destinatário precisa ter o cliente na carteira. Se não tiver → 422 `RN-CORE-TAR-04`, com os nomes;
  - destino `equipe` ou `todos`: a tarefa vai só para quem tem o cliente na carteira. O BKO mostra quantas pessoas vão receber
    antes de confirmar. Zero pessoas → 422 `DESTINATARIO_VAZIO`.
- **A foto** é lida pela rota de arquivos (ADR 0041), que confere o perfil e a carteira do `cliente_id`. Foto de tarefa sem cliente
  só é lida pelo autor da tarefa, pelo destinatário e por quem tem `tarefa.acompanhar` sobre o destinatário.

### 6.4 Promotor (RN-PRO-01)

- O promotor recebe e conclui tarefas dos três tipos.
- **Nenhum tipo de tarefa cria, abre ou exige pedido.** Não existe o tipo `pedido`, e a tarefa não tem campo de link.
- A tela da tarefa no app não mostra "Novo pedido", mesmo quando a tarefa tem cliente.
- **Guarda no domain** (`tipoPermitidoParaPerfil`, função pura com teste citando RN-PRO-01): um tipo de tarefa que um dia envolva
  pedido é recusado para destinatário com perfil promotor (403), pelo **perfil** e não pelo módulo (doc 03 §1).

---

## 7. O que muda no BKO e no app

### 7.1 BKO: menu "Tarefas" (Core), módulo `modules/core/web`

- **Lista:**
  - filtros de situação (Abertas, Atrasadas, Concluídas, Canceladas), consultor, equipe e período de prazo;
  - colunas: título, tipo, cliente, prazo, destino ("Equipe Norte", "3 pessoas", "Todos") e o andamento "feitas / total";
  - as atrasadas aparecem em destaque.
- **Nova tarefa** (folha ou página):
  - campos do §1;
  - destino em três opções: Pessoas (busca nos usuários do escopo), Equipe ou Todos;
  - com cliente, mostra "Vai para N pessoas" antes de confirmar;
  - o tipo `pesquisa` mostra a lista de questionários publicados;
  - os erros 422 aparecem com os nomes das pessoas.
- **Detalhe da tarefa:**
  - uma linha por consultor, com a situação: feita no prazo, feita com atraso, aberta, atrasada ou sem consultor ativo;
  - a hora da conclusão, a observação, as fotos (miniatura, ADR 0036) e o link para a resposta da pesquisa (tela da Pesquisa);
  - as ações Editar prazo/descrição e Cancelar (com motivo).
- **Aba "Por consultor":** cada consultor com abertas, atrasadas, feitas no prazo, feitas com atraso e % no prazo, no período.
- **Exportação CSV:** P1.

### 7.2 App Campo (e Gestão, para o sino)

- **Sino no cabeçalho de todas as telas:**
  - mostra a soma das notificações não lidas (§2.2);
  - fica escondido com 0 e mostra "9+" acima de 9 (texto final do designer-ux);
  - é um componente do shell (engenheiro-apps), alimentado por uma consulta do Core no aparelho: `core.caixa_resumo@1`, com
    `nao_lidas` e os primeiros itens. Assim o shell não lê as tabelas do Core.
- **Balão:**
  - mostra os itens não lidos e as tarefas abertas, do mais novo para o mais antigo, com no máximo 5;
  - cada item tem a primeira linha cortada com "…" e uma linha curta:
    - tarefa: "Tarefa · até sexta, 14/11";
    - pedido: "Mercadinho São Jorge · ontem";
  - tocar no item abre o recado ou a tarefa e marca como lido;
  - "Ver todos" abre a tela "Recados e tarefas" com o filtro Todos.
- **Tela "Recados e tarefas"** (substitui a caixa de notificações):
  - filtro segmentado Todos, Recados e Tarefas;
  - **linha de tarefa:** caixa de marcar, título, origem e prazo ("Tarefa da supervisão · até hoje"), ponto laranja enquanto for
    nova;
  - **atrasada:** prazo em vermelho, "atrasada desde 13/11";
  - **feita:** caixa preenchida, título riscado, "Feita ontem", no fim da lista;
  - **cancelada:** sai da lista de abertas e fica no fim com "Cancelada";
  - **ordem:** abertas e não lidas do mais novo para o mais antigo; feitas e canceladas no fim.
- **Detalhe da tarefa:**
  - descrição e cliente (abre o Cliente 360 se o cliente estiver na carteira);
  - prazo;
  - a ação do tipo:
    - simples: "Marcar como feita";
    - foto: "Tirar foto", até 5, e depois "Concluir";
    - pesquisa: "Responder pesquisa", que abre a pesquisa da Pesquisa com o questionário e o cliente;
  - observação opcional.

Os textos finais, o visual na marca v1 e a revisão de excesso são do designer-ux, do design-de-marca e do corretor-redundancias. Os
textos acima são indicativos.

---

## 8. RN propostas

Os números são provisórios (`RN-CORE-TAR-nn`). O gerente dá o número final no doc 03 para não colidir com as outras RN da T-0170.

- **RN-CORE-TAR-01 Destinatários.**
  - A tarefa vai a consultores (perfil vendedor ou promotor, ou derivado deles) **ativos** e do escopo de quem cria (RN-CORE-04).
  - Equipe e Todos são expandidos **na criação**: quem entra na equipe depois não recebe, e quem sai continua com a tarefa
    (decisão **D2**).
  - Cada consultor conclui a sua: a tarefa de equipe só fica "feita" quando todos fizeram. Não existe "basta um" (decisão **D3**).
- **RN-CORE-TAR-02 Prazo.**
  - O prazo é uma data civil no fuso do tenant, de hoje em diante na criação.
  - **Atrasada** = hoje no fuso do tenant > prazo, sem conclusão e sem cancelamento.
  - **Feita no prazo** = data local de `concluida_em` ≤ prazo. Fora disso é **feita com atraso**.
  - A tarefa atrasada continua aberta e pode ser concluída.
  - O app calcula a situação offline, com o relógio do aparelho e o fuso do tenant. O servidor recalcula no acompanhamento.
- **RN-CORE-TAR-03 Pesquisa.**
  - A tarefa do tipo pesquisa exige um questionário publicado e vigente, a Pesquisa efetiva para cada destinatário e o
    destinatário dentro do público do questionário.
  - A tarefa conclui-se com a primeira resposta do destinatário a esse questionário (e a esse cliente, se houver), recebida depois
    da criação.
  - Vale a versão que ele respondeu (RN-PES-01).
- **RN-CORE-TAR-04 Cliente.**
  - O cliente da tarefa precisa estar na carteira do destinatário na criação.
  - Se o cliente sair da carteira depois, a tarefa continua: o app mostra o nome guardado, não abre o Cliente 360 e a tarefa pode
    ser concluída.
- **RN-CORE-TAR-05 Foto.** De 1 a 5 fotos, pela câmera, 1600 px, JPEG 80 (RN-PES-06). A conclusão só vale com as fotos
  referenciadas. Se o arquivo ainda não subiu, a tarefa fica "feita" e o BKO mostra "foto chegando".
- **RN-CORE-TAR-06 Hora da conclusão.**
  - Vale a hora do aparelho, e o servidor grava `recebida_em`.
  - Relógio adiantado mais de 24 h em relação ao servidor: a conclusão é aceita e **sinalizada** (`suspeita`), nunca recusada,
    igual à RN-PES-04.
  - Vale a primeira conclusão.
- **RN-CORE-TAR-07 Novo e sino.**
  - A tarefa é "nova" até o consultor abri-la ou concluí-la.
  - O sino conta notificações não lidas, que incluem as tarefas novas.
  - Tarefa atrasada não sobe o sino de novo. O lembrete de prazo fica para depois (decisão **D6**).
- **RN-CORE-TAR-08 Cancelamento.**
  - Só quem tem `tarefa.cancelar` no escopo cancela, com motivo. O cancelamento é auditado (RN-AUD-01).
  - A tarefa cancelada sai das abertas no app e o aviso dela, se não foi lido, expira (`expira_em = now()`) e sai do sino.
  - Conclusão feita offline que chega depois do cancelamento é guardada, mas não conta nos números.
  - Tarefa cancelada não volta: para refazer, cria-se outra.
- **RN-CORE-TAR-09 Edição.**
  - Depois de criada, a tarefa só muda o prazo (de hoje em diante) e a descrição. A mudança é auditada e chega ao app no próximo
    pull.
  - Título, tipo, cliente, questionário e destinatários não mudam: para mudar, cancela-se e cria-se outra.
- **RN-CORE-TAR-10 Consultor desligado.**
  - As tarefas abertas de um usuário desativado saem das contas de abertas e atrasadas e aparecem como "sem consultor ativo". O
    sistema não grava nada para isso: a situação é calculada na consulta.
  - Se ele for reativado, as tarefas voltam a contar.
  - Usuário inativo não pode ser escolhido como destinatário (422).
- **RN-CORE-TAR-11 Módulo desligado.** Se a Pesquisa for desligada (para o tenant ou para o usuário), a tarefa de pesquisa aberta
  fica "sem módulo": não conta como atrasada e não pode ser concluída até a Pesquisa voltar (RN-CORE-03).
- **RN-CORE-TAR-12 Promotor.** O promotor recebe tarefas, mas nenhuma tarefa cria, abre ou exige pedido para ele (RN-PRO-01, pelo
  perfil).

---

## 9. Plano por agente

As estimativas são em horas de agente. Depois das decisões do §10, a ordem é esta:

| # | Agente | Entrega | Depende de | h |
|---|---|---|---|---|
| 1 | gerente-projetos | RF no doc 02, RN no doc 03 com número final, tarefas T-nnnn no quadro | decisões D1–D7 | 1 |
| 2 | engenheiro-software | ADR 0044 "Tarefa no Core e aviso pela notificação" (§2.2), registro em `.coord/contratos/` dos 3 eventos e das 3 consultas | 1 | 2 |
| 3 | designer-ux | `docs/design/recados-e-tarefas.md`: sino, balão, linha de tarefa e situações, detalhe, BKO (lista, nova, detalhe, por consultor); o design-de-marca valida na marca v1 | 1 | 4 |
| 4 | banco-dados | migração `core_tarefa` (§3), RLS, índices, teste de vazamento entre tenants, dicionário e SQLite do aparelho | 2 | 4 |
| 5 | modulo-core | contratos (§4.1), domain puro com testes citando RN (expandir destinatários, situação/atraso, `montarRecadosETarefas`, `tipoPermitidoParaPerfil`), API (rotas BKO, pull/push, consumidor da Pesquisa, cancelamento), consulta `core.caixa_resumo@1` | 2, 4 | 14 |
| 6 | modulo-pesquisa | consultas `pesquisa.questionarios_para_tarefa@1` (API) e `pesquisa.resposta_local@1` (aparelho); abrir a resposta com questionário e cliente vindos da tarefa | 2 | 4 |
| 7 | modulo-core | telas: BKO "Tarefas" e, no app, "Recados e tarefas" e o detalhe | 3, 5, 6 | 10 |
| 8 | engenheiro-apps | sino no cabeçalho do shell (Campo e Gestão) e balão flutuante sobre `core.caixa_resumo@1`; revisão técnica das telas do item 7 | 3, 5 | 6 |
| 9 | modulo-gestor | consumir os 3 eventos: "tarefas cumpridas" na ficha (RF-GES-10) e no painel. Pode ficar para a v1.0.7 | 5 | 3 |
| 10 | testes | integração (criar, editar, cancelar, concluir, idempotência), sync offline (conclusão sem sinal, foto depois, cancelada no meio), permissões por perfil (promotor e RN-PRO-01, supervisor), escopo, isolamento de tenant, Pesquisa desligada, roteiro do aparelho | 5–8 | 6 |
| 11 | corretor-redundancias | parecer das telas e textos (print do aparelho), da lista unificada e dos dois conceitos de "tarefa" | 7, 8 | 2 |
| 12 | engenheiro-software | revisão final (🔴/🟡/🟢) | 10, 11 | 2 |
| | **Total** | | | **≈ 58 h** |

- **Caminho crítico:** 1 → 2 → 4 → 5 → 7 → 10 → 11 → 12.
- **Em paralelo:** o 3 com o 4, o 6 com o 5 e o 8 com o 7.
- Com 7 vagas locais, cabe em 3 a 4 dias úteis de esteira.

**Riscos**

1. **Colisão com o resto da T-0170.** O sino, o Início e a tela de notificações já estão sendo redesenhados no PC. Os itens 7 e 8
   tocam `modules/core/app` e o shell: o gerente tem de pôr esses caminhos em sequência com a frente do Início, e não em
   paralelo.
2. **App antigo no campo.** O aviso de tarefa chega à v1.0.5 como "Aviso do sistema". Se o `tipo` virar `tarefa` por engano, o
   pull da notificação quebra nos aparelhos antigos. O teste de contrato tem de travar isso.
3. **Fotos que não sobem.** A tarefa pode aparecer "feita" no BKO com a foto ainda "chegando" (fila de arquivos). Isso tem de ficar
   claro no acompanhamento, ou vai parecer defeito.
4. **Pesquisa respondida fora da tarefa.** Uma resposta avulsa ao mesmo questionário conclui a tarefa aberta (§4.3). Isso é o
   esperado, mas tem de estar na RN e no roteiro do testes.
5. **Volume do "Todos".** O limite de 500 destinatários por tarefa é o mesmo do recado. Um tenant maior precisa dividir por
   equipe, ou o limite tem de subir com teste de carga.
6. **Redundância.** "Tarefa do consultor" e "tarefa de campanha" convivem até a decisão D7, e o corretor pode segurar o lote.

---

## 10. Decisões para o Alexandre

| # | Pergunta | Recomendação |
|---|---|---|
| **D1** | O supervisor não entra no BKO (RN-CORE-33). Quem cria tarefa? | Gerente, analista e admin no BKO na v1.0.6. O supervisor cria pelo app Gestão numa entrega seguinte (P1). |
| **D2** | Tarefa de equipe ou de todos: quem entra na equipe depois recebe? | Não. Vale a equipe do dia da criação, e os números do acompanhamento não mudam sozinhos. |
| **D3** | Tarefa de equipe: cada um faz a sua, ou basta um? | Cada um faz a sua. "Basta um" pode virar uma opção depois. |
| **D4** | O consultor pode desmarcar uma tarefa já sincronizada? | Não. Ele desmarca só enquanto não sincronizou. Depois, quem criou pode "reabrir para o consultor" no BKO (P1). |
| **D5** | Tarefa com foto e cliente exige check-in aberto no cliente? | Não. A tarefa pode ser feita fora da visita. A foto guarda a hora e o GPS quando houver. |
| **D6** | Lembrete de prazo (push no dia do prazo e quando atrasar)? | Fica para depois da v1.0.6. Na primeira versão, o atraso aparece só na lista e no BKO. |
| **D7** | Tarefa de campanha do Promotor (RF-PRO-10) e tarefa do consultor: juntar ou manter as duas? | Manter as duas na v1.0.6, com nomes distintos no app ("Tarefas" na lista e "Campanha" no checklist da loja), e reavaliar depois do uso. |
