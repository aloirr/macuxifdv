# Dicionário de dados — schema `plataforma`

Migrações `db/migrations/0001_plataforma.up.sql`, `0003_plataforma_worker`, `0005_plataforma_arquivo` e `0035_plataforma_super_admin` (super-admin, sem tenant_id) e `0038_plataforma_papel_portal` (papel `macuxi_portal` das `sa_*`) (volta: `.down.sql` de cada uma). Drizzle: `db/esquema/plataforma.ts`.
Campos comuns em toda tabela (regra 5): `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null → plataforma.tenant`,
`created_at`, `updated_at` (trigger `definir_updated_at`, cursor do sync), `deleted_at` (exclusão lógica), `external_id text` (código no ERP).
RLS: política `isolamento_tenant` em todas (ver [rls.md](rls.md)).

## tenant — empresa cliente (exceção: sem `tenant_id`)
| Coluna | Tipo | Regra |
|---|---|---|
| codigo | text not null | "código da empresa" do login; `^[a-z0-9][a-z0-9-]{1,39}$`; único (minúsculas) |
| nome | text not null | |
| documento | text | CNPJ só dígitos |
| fuso | text not null | IANA, padrão `America/Sao_Paulo` (exibição no fuso do tenant; dados em UTC) |
| plano | text not null | padrão `piloto` |
| status | text not null | `ativo` \| `suspenso` \| `encerrado` |
| geracao_base | uuid not null | 0022 (T-0079): geração dos dados do tenant, padrão `gen_random_uuid()`. **Gira** em toda operação que apaga ou volta os dados do tenant: seed demo `--recriar`, restauração de backup (`db/backup/restaurar-vm.sh`, todos os tenants) e tenant novo (primeiro seed de servidor novo). **Nunca** no uso normal. Vai no `/me` e no envelope do pull (contrato do engenheiro-software); o aparelho compara com o guardado e, se mudou, reenvia a fila, limpa a cópia local e puxa tudo |

Função `tenant_por_codigo(codigo)` (SECURITY DEFINER) para o login. Aplicação: só `SELECT` (vê o próprio).
Função `girar_geracao_base(p_tenant uuid default null) → integer` (0022, SECURITY INVOKER, sem EXECUTE para `public`,
`macuxi_app` ou `macuxi_worker`): troca `geracao_base` do tenant (null = todos) e devolve quantos girou. Só o dono do banco
(superusuário do seed e do restaurar-vm.sh) roda; a tabela tem FORCE RLS, então papel sem BYPASSRLS gira 0 (o seed trata como erro).
Caminho de volta: `0022_plataforma_geracao_base.down.sql` (apaga coluna e função; app volta ao comportamento sem marcador).
Função `tenants_ativos() → table (id uuid)` (0027, T-0039, ADR 0022; SECURITY DEFINER, `search_path = pg_catalog, plataforma,
pg_temp`, `execute` **só ao `macuxi_worker`**; `macuxi_app` e `public` sem EXECUTE): ids dos tenants com `status = 'ativo'` e
`deleted_at is null`, ordenados por id. Só o id sai; o agendador das tarefas periódicas (`apps/api/src/agendador.ts`) lê
licenças, parâmetros e fuso depois em `comTenant` (macuxi_app, RLS). Caminho de volta: `0027_plataforma_tenants_ativos.down.sql`
(apaga a função; o worker vê `to_regprocedure` nulo e deixa o agendador desligado com warn). Teste: `db/testes/tenants-ativos.test.ts`.
Função `provisionar_tenant(p jsonb) → jsonb` (0029, T-0083, RN-CORE-31; SECURITY INVOKER, `search_path = pg_catalog, plataforma,
pg_temp`, sem EXECUTE para `public`, `macuxi_app` e `macuxi_worker`): porta do comando `pnpm tenant:criar` (conexão de
administração). Entrada `{ codigo, nome, documento?, fuso? (America/Sao_Paulo), plano? (piloto), modulos: [{ modulo, licencas?,
perfis }], admin: { email, nome, senha_hash (argon2id PHC) }, redefinir_senha? }`; saída `{ tenant_id, resultado:
criado|atualizado|sem_mudanca, modulos_adicionados, admin: criado|existente|senha_redefinida, avisos }`. Idempotente pelo código
(`on conflict (lower(codigo)) do nothing`): tenant existente não muda (aviso); só os módulos que faltam entram, com os perfis
pedidos; perfis de módulo existente e módulo desativado não mudam (aviso); admin por `(tenant_id, lower(email))`: cria (perfil
admin, ativo, sem equipe) ou mantém, e só `redefinir_senha = true` troca o `senha_hash`. Nenhuma linha em `parametro` (os
gatilhos `tenant_semear_core` e `tenant_semear_medidas` seguem como em qualquer tenant). Uma linha de `auditoria`
`tenant.provisionar` (módulo `core`, ator nulo) só quando algo muda, sem e-mail, nome ou hash. Entrada inválida = 22023 (sem dado
pessoal na mensagem; o hash é conferido antes do insert para o CHECK não expor a linha); tenant encerrado ou excluído = 55000.
Com superusuário, desliga `log_statement` e `log_min_duration_statement` na transação (o comando também desliga antes da
chamada). Premissa: o admin é superusuário ou BYPASSRLS (como `excluir_tenant`). Caminho de volta:
`0029_plataforma_provisionar_tenant.down.sql` (apaga a função; tenants já criados ficam). Teste: `db/testes/provisionar-tenant.test.ts`.

## tenant_modulo — módulos do tenant (RN-CORE-01/02)
| Coluna | Tipo | Regra |
|---|---|---|
| modulo | text not null | id do módulo (`core`, `vendedor`, ..., `teste`); único por tenant |
| ativo | boolean not null | `core` não pode ficar inativo (check) |
| plano, licencas | text, integer | licenças >= 0 |
| parametros | jsonb not null | **legado, sem uso** (T-0016 §7, R-20261031-165647): parâmetros do tenant só em `plataforma.parametro`; `comment` de LEGADO na 0011 (a coluna fica até uma migração que a remova) |
| ativado_em, desativado_em | timestamptz | retenção de 90 dias conta de `desativado_em` (RN-CORE-02) |

Índices: único `(tenant_id, modulo)` ativo; sync `(tenant_id, updated_at, id)`.

## perfil_modulo — módulos por perfil (RN-CORE-01)
| Coluna | Tipo | Regra |
|---|---|---|
| perfil | text not null | `admin, analista, assistente, supervisor, gerente, vendedor, promotor` |
| modulo | text not null | único `(tenant_id, perfil, modulo)` |

## usuario_modulo — exceção por usuário (RN-CORE-01)
| Coluna | Tipo | Regra |
|---|---|---|
| usuario_id | uuid not null | FK composta `(tenant_id, usuario_id) → core.usuario` (criada na 0002) |
| modulo | text not null | único `(tenant_id, usuario_id, modulo)` |
| efeito | text not null | Sprint 0: só `remover` (exceção nunca acrescenta módulo) |
| motivo | text | |

Módulos efetivos = ativos do tenant ∩ perfil − exceções (calculado no `domain` do Core, revalidado por requisição).

## evento — outbox (doc 04 "Comunicação entre módulos")
| Coluna | Tipo | Regra |
|---|---|---|
| nome | text not null | `<modulo>.<entidade>.<fato>@N` (ex.: `core.usuario.modulos_alterados@1`) |
| modulo | text not null | = 1º segmento do nome (check) |
| agregado_id | uuid | entidade de origem |
| payload | jsonb not null | sem dado pessoal desnecessário |
| ocorrido_em | timestamptz not null | |
| publicado_em | timestamptz | NULL = pendente para o pg-boss |
| tentativas, ultimo_erro | integer, text | controle de entrega |
| usuario_id | uuid | autor do fato (envelope do SDK; 0003). Sem FK (o evento pode vir do Hub/sistema) |
| request_id | text | requisição de origem (rastreio ponta a ponta; 0003) |

Índices: `(ocorrido_em) where publicado_em is null` (fila), `(tenant_id, ocorrido_em, id)`, único `(tenant_id, id)`
(`evento_tenant_id_uk`, alvo da FK de `evento_consumo`). Gravado na mesma transação do fato.
Acesso: `macuxi_app` pelo RLS do tenant; `macuxi_worker` (ADR 0007) lê todos os tenants e só atualiza
`publicado_em`, `tentativas`, `ultimo_erro` (ver [rls.md](rls.md)).

**Retenção (0011, T-0032)**: `plataforma.expurgar_outbox(p_agora timestamptz default now(), p_limite int default 10000)`
devolve `(item, quantidade)` para `evento` e `evento_consumo`. Por tenant, apaga os eventos **publicados** há mais de N dias
(até `p_limite` por tenant por chamada) e os consumos deles na mesma transação; evento pendente (`publicado_em` nulo) nunca
sai. N = parâmetro `plataforma.parametro` (`modulo = 'plataforma'`, `chave = 'outbox.retencao_dias'`, número de dias; sem
linha = **30**; limitado a 7..365). `SECURITY DEFINER`, `search_path = pg_catalog, plataforma, pg_temp` (0012), `execute` só ao `macuxi_worker` (agendamento do
engenheiro-software). Índice `evento_publicado_ix (tenant_id, publicado_em) where publicado_em is not null`. Motivo: a carga
inicial do Hub gera ~100 a 200 mil eventos por tenant.

**Resumo para o `/v1/saude` (0024, T-0078)**: `plataforma.resumo_outbox(p_nomes text[], p_max_tentativas integer)` devolve uma
linha `(pendentes integer, parados integer, mais_antigo_s double precision)` com os eventos não publicados de **todos** os
tenants cujo nome está em `p_nomes`: `pendentes` = `tentativas < p_max_tentativas`, `parados` = `tentativas >= p_max_tentativas`,
`mais_antigo_s` = segundos desde o `ocorrido_em` mais antigo dos pendentes (nulo sem pendente). Lista nula ou vazia = 0, 0,
nulo. Só agregados: nenhum id, tenant, payload ou erro sai. `SECURITY DEFINER`, `search_path = pg_catalog, plataforma, pg_temp`,
`execute` só ao `macuxi_app` (a API chama em `apps/api/src/banco.ts`, `resumoOutbox`; o worker conta direto com a política
`despacho_outbox`). Índice `evento_pendente_ix`.

## evento_consumo — consumo idempotente da outbox (ADR 0007, migração 0003)
| Coluna | Tipo | Regra |
|---|---|---|
| consumidor | text not null | `<modulo>.<nome>` (check de formato, minúsculas) |
| evento_id | uuid not null | FK composta `(tenant_id, evento_id)` -> `evento (tenant_id, id)`, `on delete cascade` |
| processado_em | timestamptz not null | default `now()` |

Único `evento_consumo_uk (tenant_id, consumidor, evento_id)` (sem predicado: chave de idempotência absoluta); índice
`(tenant_id, evento_id)`. O handler grava na transação do efeito com
`on conflict (tenant_id, consumidor, evento_id) do nothing` (0 linhas = já processado). RLS por tenant para
`macuxi_app`; nenhum acesso do `macuxi_worker`. Fora do sync do app.

## parametro — parâmetros do tenant (doc 03, tabela de padrões)
| Coluna | Tipo | Regra |
|---|---|---|
| modulo | text not null | dono do parâmetro |
| chave | text not null | `^[a-z][a-z0-9_.]*$`; único `(tenant_id, modulo, chave)` |
| valor | jsonb not null | número, texto, booleano ou objeto |

## auditoria — RN-AUD-01 (quem, quando, antes/depois)
| Coluna | Tipo | Regra |
|---|---|---|
| usuario_id | uuid | autor (NULL = sistema/integração) |
| modulo, acao, entidade | text not null | ex.: `core`, `licenca.alterar`, `usuario_modulo` |
| entidade_id | uuid | |
| antes, depois | jsonb | |
| request_id | text | correlação com o log |
| ocorrido_em | timestamptz not null | |

Aplicação só faz `SELECT` e `INSERT`. Índices `(tenant_id, ocorrido_em, id)` e `(tenant_id, entidade, entidade_id)`.

**Parâmetros padrão do Core** (0006): `core.semear_padroes` grava em todo tenant (existentes e novos, gatilho
`tenant_semear_core`) `core / checkin.raio_m = 200` (RN-CORE-10) e `core / metas.base_apuracao = "aprovado"` (RN-CORE-21),
com id `uuid_de_chave('<tenant_id>:plataforma.parametro:core:<chave>')` e `on conflict do nothing` (valor editado pelo
tenant é mantido). As chaves antigas `raio_checkin_m` / `base_apuracao_metas` do seed Fase M e da fixture ficam como legado
(não são lidas pelo Core novo).

## arquivo — fotos/arquivos enviados pelo aparelho (0005, ADR 0010). Fora do sync
| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid | UUID do aparelho (o mesmo gravado na coluna que referencia, ex.: `core.visita.foto_fachada_id`) |
| modulo | text not null | dono (licença checada no GET) |
| finalidade | text not null | ex.: `fachada`, `gondola_antes` |
| entidade, entidade_id | text, uuid not null | dono lógico (ex.: `visita` / id) |
| cliente_id | uuid | FK composta para `core.cliente` (escopo de carteira do GET) |
| enviado_por | uuid not null | FK composta para `core.usuario` (o upload só completa linha do mesmo usuário) |
| tipo | text not null | só `image/jpeg` |
| tamanho_bytes | integer | 1 a 2.097.152 (2 MB) |
| sha256 | text | hex 64 (idempotência do upload) |
| largura_px, altura_px | integer | > 0 |
| situacao | text not null | `aguardando` (criada pelo módulo na transação do comando) → `recebido` (rota `PUT /v1/arquivos/:id`) |
| recebido_em, chave_armazenamento | | `recebido` exige `recebido_em`, `sha256`, `tamanho_bytes` e `chave_armazenamento` (`<tenant_id>/<modulo>/<aaaa-mm>/<id>.jpg`) |

Índices: `arquivo_entidade_ix (tenant_id, entidade, entidade_id)`; parcial `arquivo_aguardando_ix (tenant_id, situacao) where
situacao = 'aguardando'` (monitor de fotos que não chegaram); `(tenant_id, cliente_id)`; único `(tenant_id, id)` (alvo de FK).
Os bytes NUNCA ficam no banco (porta `ArmazenamentoArquivos`); o down da 0005 deixa os bytes órfãos.

## Super-admin de plataforma (0035, T-0087, ADR 0029) — fora dos tenants, só por função
Migração `0035_plataforma_super_admin` (volta: `.down.sql`, APAGA as 4 tabelas com a auditoria e devolve a `provisionar_tenant`
da 0029). Drizzle: `superAdmin`, `superAdminDesafio`, `superAdminSessao`, `auditoriaPlataforma` em `db/esquema/plataforma.ts`
(só para tipar; a aplicação nunca consulta as tabelas direto).

**Exceção à regra 5 (justificativa).** O super-admin (o operador da Macuxi no portal `config.`) não é usuário de nenhum tenant:
enxerga todos e cria tenant novo. Por isso as 4 tabelas **não têm `tenant_id`** (como `plataforma.tenant`), estão em
`TABELAS_SEM_TENANT_ID` e em `TABELAS_SO_POR_FUNCAO` (`db/src/excecoes.ts`). O isolamento é outro: **RLS ligado e forçado SEM
política e SEM grant de tabela** para `macuxi_app` e `macuxi_worker` (42501 direto; com um grant indevido, 0 linhas), só a política
`manutencao` (0031) para o migrador; a aplicação chega aos dados **só** pelas funções `SECURITY DEFINER` abaixo (`search_path`
fixo com `pg_temp` por último, `revoke all from public`, `execute` só ao **`macuxi_portal`** desde a 0038, T-0091 — na 0035 era o
`macuxi_app`; app e worker recebem 42501). Os campos comuns
(`id`, `created_at`, `updated_at`, `deleted_at`, `external_id`) existem em todas. Nenhum `ALTER ROLE` (plano B do DBaaS).

| Tabela | Colunas principais | Regras |
|---|---|---|
| `super_admin` | `email`, `nome`, `senha_hash` (argon2id, CHECK como `core.usuario`), `totp_segredo_cifrado`, `totp_pendente_cifrado` (`v1.<iv>.<tag>.<cifra>`, AES-256-GCM, AAD = id; a chave `MACUXI_CHAVE_TOTP` fica fora do banco), `totp_confirmado_em`, `totp_ultimo_passo bigint`, `recuperacao_hashes text[]` (SHA-256 hex, até 20), `falhas`, `bloqueado_ate`, `ativo` | único `lower(email)` entre os vivos; `totp_confirmado_em` existe se e só se há segredo; os hashes de recuperação nunca saem do banco (as funções devolvem a contagem) |
| `super_admin_desafio` | `super_admin_id`, `desafio_hash` (SHA-256 hex, único), `etapa` (`segundo_fator` ou `cadastrar_totp`), `expira_em`, `consumido_em` | prazo de até 5 min (CHECK); uso único; abrir um novo invalida o anterior aberto |
| `super_admin_sessao` | `super_admin_id`, `criada_em`, `ultimo_uso_em`, `expira_em`, `revogada_em` | teto de até 8 h (CHECK); viva = não revogada, `expira_em > now()`, super-admin vivo, ativo e com TOTP confirmado |
| `auditoria_plataforma` | `super_admin_id` (nulo na falha com e-mail inexistente), `sessao_id`, `tenant_alvo_id` (nulo fora de tenant), `acao`, `metodo`, `rota` (modelo, sem query), `status`, `request_id`, `ip_prefixo` (/24 ou /48), `detalhes jsonb` (objeto de até 4 KB), `ocorrido_em` | **append-only**: gatilho recusa `update`, `delete` e `truncate` para todos (42501), inclusive o dono; sem dado pessoal |

**Retenção (pedido item 6):** o tenant da ação fica em `tenant_alvo_id`, **sem FK** e de propósito **sem o nome `tenant_id`**: a
`excluir_tenant` (0024/0032) apaga toda tabela com coluna `tenant_id`, e a auditoria da plataforma sobrevive à exclusão (provado em
`db/testes/super-admin.test.ts`). Sem expurgo por ora (como `plataforma.auditoria`). `super_admin_id` tem FK (super-admin só é
apagado logicamente); `sessao_id` não tem (a sessão pode ser expurgada no futuro sem tocar a auditoria).

**Funções** (contrato com o modulo-core e a API; todas `SECURITY DEFINER`, `execute` só ao `macuxi_portal` desde a 0038):

| Função | Devolve | O que faz |
|---|---|---|
| `sa_existe()` | `boolean` | já houve super-admin (qualquer linha, mesmo apagada): o primeiro acesso responde 410 para sempre |
| `sa_criar_primeiro(p_email text, p_nome text, p_senha_hash text)` | `uuid` ou nulo | trava consultiva; cria só com **zero** linhas, senão nulo; 22023 sem dado pessoal na entrada inválida |
| `sa_para_login(p_email text)` e `sa_por_id(p_id uuid)` | `table (id, email, nome, senha_hash, ativo, falhas, bloqueado_ate, totp_confirmado_em, totp_segredo_cifrado, totp_pendente_cifrado, totp_ultimo_passo bigint, recuperacao_restantes integer)` | linha viva (0 linhas = não existe). O `bigint` chega como texto no node-pg |
| `sa_registrar_falha(p_id uuid)` | `table (falhas integer, bloqueado_ate timestamptz)` | +1 falha; a 5ª seguida bloqueia por 15 min e zera; bloqueado = nada muda (devolve o estado) |
| `sa_registrar_sucesso(p_id uuid)` | `void` | zera falhas e bloqueio vencido; bloqueio vigente não é desfeito |
| `sa_gravar_totp_pendente(p_id uuid, p_cifrado text)` | `boolean` | só antes do TOTP confirmado (redefinir = comando de administração) |
| `sa_confirmar_totp(p_id uuid, p_passo bigint, p_recuperacao_hashes text[])` | `boolean` | pendente vira segredo, grava o passo usado e os 1 a 20 hashes distintos, numa só vez |
| `sa_marcar_passo(p_id uuid, p_passo bigint)` | `boolean` | só avança (mesmo passo ou anterior = falso: sem reuso) |
| `sa_usar_recuperacao(p_id uuid, p_hash text)` | `integer` ou nulo | remove o hash e devolve quantos restam; inexistente ou já usado = nulo |
| `sa_regerar_recuperacao(p_id uuid, p_hashes text[])` | `integer` ou nulo | troca todos (exige TOTP confirmado) |
| `sa_abrir_desafio(p_id uuid, p_desafio_hash text)` | `table (etapa text, expira_em timestamptz)` | 0 linhas se inativo, apagado ou bloqueado; etapa calculada aqui (sem TOTP = `cadastrar_totp`) |
| `sa_ver_desafio(p_desafio_hash text)` | `table (super_admin_id uuid, etapa text, expira_em timestamptz)` | desafio aberto, no prazo, de super-admin ativo e sem bloqueio; não consome |
| `sa_abrir_sessao(p_desafio_hash text)` | `table (sessao_id uuid, super_admin_id uuid, expira_em timestamptz)` | **consome** o desafio; abre sessão de 8 h só com TOTP confirmado, ativo e sem bloqueio |
| `sa_sessao_valida(p_sid uuid)` | `table (super_admin_id uuid, expira_em timestamptz)` | 0 linhas = inválida; atualiza `ultimo_uso_em` (serve também de "renovar") |
| `sa_revogar(p_sid uuid)` | `boolean` | revoga (2ª vez = falso) |
| `sa_auditar(p jsonb)` | `uuid` | `{ super_admin_id, sessao_id, tenant_id (vai para tenant_alvo_id), acao, metodo, rota, status, request_id, ip_prefixo, detalhes? }`; a query da rota cai; IP fora do formato de prefixo não é gravado |
| `sa_listar_tenants(p_sid uuid)` | `jsonb` `{ itens: [{ id, codigo, razao_social, cnpj, fuso, status, criada_em, modulos: [{ modulo, licencas }] }] }` | = `ListaEmpresasSchema`; só módulos vivos, ativos e do contrato (`MODULOS`); sessão inválida = 28000 |
| `sa_tenant_ativo(p_sid uuid, p_tenant uuid)` | `boolean` | sessão viva **e** tenant `ativo` e vivo |
| `sa_provisionar_tenant(p_sid uuid, p jsonb)` | `jsonb` (o da `provisionar_tenant`) | sessão viva (senão 28000); recusa `admin` e `redefinir_senha` (22023); chama a `provisionar_tenant` com `sem_admin = true` e `ator_id` = super-admin da sessão |

Fatos gravados **pelo próprio banco** na auditoria (`detalhes.origem = 'banco'`, pela `sa_registrar_auditoria`, interna, sem
`execute` para ninguém): `sa.primeiro_acesso`, `sa.totp.confirmado`, `sa.bloqueio`, `sa.sessao.aberta`, `sa.sessao.revogada`,
`sa.recuperacao.usada`, `sa.recuperacao.regerada`, `sa.tenant.provisionar`. O Core grava pelo `sa_auditar` os de login (com o
prefixo do IP); a API grava `sa.requisicao` de toda requisição do super-admin.

**Papel `macuxi_portal` (0038, T-0091; condição do aceite da ADR 0029, R-20261106-182000 item 3; desenho
`docs/desenho/T-0091.md` §2).** Só o 2º pool da API (rotas `plataforma/*`, sessão viva a cada requisição, `sa_tenant_ativo` e a
auditoria `sa.requisicao`) conecta com ele; o dado do tenant segue no `macuxi_app` com RLS.
- Atributos: `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`; não é membro de papel nenhum (a 0038 aborta
  com 42501 se for), não é dono de nada, **nenhum grant de tabela/coluna/sequência**; só `USAGE` no schema `plataforma` e
  `EXECUTE` nas 20 `sa_*`. Direto em qualquer tabela (as 4 do super-admin, `tenant`, `parametro`, `core.*`) = 42501.
- `macuxi_app`, `macuxi_worker` e `PUBLIC` **sem** `EXECUTE` em nenhuma `sa_*` (a 0038 confere pelo catálogo e aborta se sobrar).
  `sa_registrar_auditoria` (interna) e `provisionar_tenant` (só a conexão de administração) seguem sem `EXECUTE` para ninguém.
- Nasce pela 0038 (`NOLOGIN`, só se falta) ou antes, pelo passo de papéis: `garantirPapelPortal` (`@macuxi/db`, B0 do plano B do
  DBaaS, ADR 0024: papel novo = `CREATE ROLE` com os atributos; existente = só `ALTER ROLE ... LOGIN PASSWORD <verificador SCRAM>`,
  atributos conferidos em `pg_roles`), com `MACUXI_PG_PORTAL_SENHA` (local: `macuxi_portal_local`, recusada fora do local; fora do
  local é opcional: sem ela o papel fica `NOLOGIN`, `urlPortal(cfg)` lança e o portal responde 503). `banco migrar up` e `banco
  papeis` (`db/scripts/banco.ts`) rodam o passo antes das migrações. A senha fica no `portal.env` da VM, só no contêiner `api` e no
  serviço de ferramenta `banco`, nunca no worker.
- **Regra para migrações novas:** toda função `plataforma.sa_*` nasce com `revoke all ... from public` e `EXECUTE` **só** ao
  `macuxi_portal` (nunca ao `macuxi_app` nem ao `macuxi_worker`). `db/testes/papel-portal.test.ts` e
  `tests/integracao/banco/conformidade.test.ts` conferem pelo catálogo (toda `sa_*` do `pg_proc`), não por lista fixa.
- **Horizonte do pull (risco do desenho §3.5):** a `sa_provisionar_tenant` grava `plataforma.parametro` (entidade de sync) numa
  sessão que o cálculo do horizonte (`pg_stat_activity` do `macuxi_app`) não enxerga. A API roda essa chamada com `set local
  statement_timeout = '1500ms'` (abaixo da margem de 2 s), numa transação de um comando; as demais `sa_*` não gravam tabela de sync.
- Down da 0038: `EXECUTE` de volta ao `macuxi_app` (estado da 0035), o portal perde `EXECUTE` e `USAGE`; o papel fica (do cluster).

**Limite registrado:** a conferência da senha e do TOTP é no Node (a chave do TOTP fica fora do banco), então quem tiver a
credencial do `macuxi_portal` consegue abrir desafio e sessão pelas funções (até a 0037, a do `macuxi_app`, presente também no
worker e nas ferramentas). Cada sessão aberta fica em `sa.sessao.aberta`, que ninguém apaga; a barreira é a credencial do
`macuxi_portal` (só no `portal.env` da VM).

**`provisionar_tenant` (0035, aditiva):** chaves novas opcionais `sem_admin` (não cria admin; com ele, `admin` ou
`redefinir_senha = true` = 22023; sem ele, o admin continua obrigatório), `parametros` (`[{ modulo, chave, valor }]` em
`plataforma.parametro` com `on conflict do nothing`; o módulo tem de ser do tenant; sem repetição; valor não nulo) e `ator_id`
(vai para `plataforma.auditoria.usuario_id`). A saída ganha `parametros_gravados` (chaves inseridas nesta chamada) e
`admin = 'sem_admin'`. 2x a mesma entrada = mesmas linhas.

Volume: 1 a 3 super-admins, poucas sessões e desafios por dia; auditoria na casa dos milhares de linhas por dia de implantação.
Índices: `super_admin_email_uk`, `super_admin_desafio_hash_uk`, `super_admin_desafio_aberto_ix`, `super_admin_sessao_viva_ix`,
`auditoria_plataforma_ocorrido_ix`, `auditoria_plataforma_super_admin_ix`, `auditoria_plataforma_tenant_alvo_ix` (parcial).

## Funções
- `plataforma.tenant_atual()` (0001): contexto do tenant (falha fechada).
- `plataforma.tenant_por_codigo(text)` (0001): login, SECURITY DEFINER revisada; `pg_temp` no fim do `search_path` (0012).
- `plataforma.uuid_de_chave(text)` (0005): UUID determinístico (md5 de `macuxi:<chave>` com versão 5 e variante RFC 4122),
  gêmeo de `idDeChave` em `db/src/ids.ts`. Usado nas linhas padrão semeadas em todo tenant.
- `plataforma.resumo_outbox(text[], integer)` (0024): contagens da outbox para o `/v1/saude` (seção evento).
- `plataforma.tenants_ativos()` (0027): ids dos tenants ativos para o agendador do worker (seção tenant); só `macuxi_worker`.
- `plataforma.provisionar_tenant(jsonb)` (0029): onboarding de tenant pelo comando `pnpm tenant:criar` (seção tenant); SECURITY
  INVOKER, só o dono/admin do banco executa.
- LGPD (0024, T-0078; roteiro [lgpd.md](lgpd.md)): `anonimizar_usuario(p_tenant, p_usuario)`, `anonimizar_cliente(p_tenant,
  p_cliente)`, `anonimizar_contato(p_tenant, p_contato)` e `excluir_tenant(p_tenant, p_codigo)`. Todas `SECURITY INVOKER`,
  `search_path` fixo, sem `execute` para `public`, `macuxi_app` ou `macuxi_worker`: só o dono do banco roda, à mão. Devolvem
  `(item|tabela, quantidade)`. `excluir_tenant` exige o código do tenant e `status = 'encerrado'` e apaga toda tabela com
  `tenant_id` (descoberta pelo catálogo). Desde a 0032 (T-0075, B2 do DBaaS; mesma assinatura e retorno) apaga em ordem de
  FK calculada no catálogo, com o ciclo `core.usuario` <-> `core.equipe` quebrado por `update ... = null`, sem
  `session_replication_role` e com gatilhos ligados: roda sem superusuário, pela política `manutencao` (0031). O down da 0032
  volta ao corpo da 0024 (`session_replication_role = replica`, só superusuário).
- Papel `macuxi_manutencao` e política `manutencao` (0031, T-0075, B1 do DBaaS): ver [rls.md](rls.md), "Papel de manutenção".
- Super-admin (0035, T-0087): as 20 funções `sa_*` (EXECUTE só ao `macuxi_portal` desde a 0038, T-0091) e a `provisionar_tenant`
  com `sem_admin`, `parametros` e `ator_id`: seção "Super-admin de plataforma" acima.
