# Dicionário de dados — schema `plataforma`

Migrações `db/migrations/0001_plataforma.up.sql`, `0003_plataforma_worker`, `0005_plataforma_arquivo` e `0035_plataforma_super_admin` (super-admin, sem tenant_id) e `0038_plataforma_papel_portal` (papel `macuxi_portal` das `sa_*`) e `0039_plataforma_portal_email_senha` (portal só com e-mail e senha, sessão por empresa) (volta: `.down.sql` de cada uma). Drizzle: `db/esquema/plataforma.ts`.
Campos comuns em toda tabela (regra 5): `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null → plataforma.tenant`,
`created_at`, `updated_at` (trigger `definir_updated_at`, cursor do sync), `deleted_at` (exclusão lógica), `external_id text` (código no ERP).
RLS: política `isolamento_tenant` em todas (ver [rls.md](rls.md)).

## tenant — empresa cliente (exceção: sem `tenant_id`)
| Coluna | Tipo | Regra |
|---|---|---|
| codigo | text not null | "código da empresa" do login; até a 0067 `^[a-z0-9][a-z0-9-]{1,39}$`; **desde a 0068** esse formato (legados: thathyany, demo, teste-macuxi) OU o código da licença `^(UF)[0-9]{4}$` (27 UFs, maiúsculas, ex.: `AM4821`); único sem diferenciar maiúsculas (`tenant_codigo_uk`, `lower(codigo)`) |
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

### 0068 — código da licença (código da empresa; dono do produto, R-20261114-130500, R-20261114-131200 e R-20261114-131500)
"O codigo da licenca e assim: UF0001 onde UF é a UF do cliente. O numero é aleatorio." O código da empresa nasce como
**UF do cliente + 4 dígitos aleatórios**, em maiúsculas (`AM4821`), único na plataforma. Sem sequência.
- **CHECK `tenant_codigo_formato`**: `codigo ~ '^[a-z0-9][a-z0-9-]{1,39}$' or codigo ~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)[0-9]{4}$'`.
  Os legados (`thathyany` em produção, `demo` na demo, `teste-macuxi` nos testes) continuam válidos; a migração não troca código.
- **Caixa**: grava e exibe em maiúsculas; o login compara sem diferenciar (`tenant_por_codigo`: `lower(t.codigo) = lower(p_codigo)`,
  0052). O índice único é por `lower(codigo)`: `am4821` (formato legado) e `AM4821` não convivem.
- `uf_valida(p_uf text) → boolean` (immutable): sigla de uma das 27 UFs, aceita minúscula e espaços nas pontas.
- `sortear_codigo_licenca(p_uf text) → text`: trava consultiva por UF (`pg_advisory_xact_lock`, até o fim da transação), até 20
  sorteios de `UF || lpad(random 0..9999)` livres por `lower(codigo)`; sem sorte, sorteia entre os números livres da UF
  (`generate_series(0, 9999)`); UF esgotada = **54000** ("não há código livre para a UF TO..."); UF inválida = 22023.
- `provisionar_tenant` (mesma assinatura, SECURITY INVOKER) aceita:
  - `id` (opcional, UUID gerado pelo chamador) = id do tenant e **chave de idempotência**: com id de tenant existente, a chamada é
    sobre ele (mesmo tenant, mesmo código, sem sortear); trava consultiva por id antes da busca (chamadas simultâneas com o mesmo
    id não sorteiam dois códigos). Se o código dele não é da UF pedida, não muda (aviso
    `tenant existente: o código X não muda (troca: atribuir_codigo_licenca)`).
  - `uf` (texto; `"am"` vale `AM`): obrigatória sem `codigo`; fora das 27 ou não texto = 22023, mesmo com `codigo`.
  - `codigo` ausente, `null` ou `""` = código da licença sorteado (tenant novo). Sem `codigo`, `id` e `uf` são obrigatórios (22023).
  - `codigo` informado: como antes (minúsculas, idempotente pelo código, sem diferenciar maiúsculas). `id` e `codigo` de tenants
    diferentes = 23505.
  - Saída ganha `codigo` (text): `{ tenant_id, codigo, resultado, modulos_adicionados, parametros_gravados, admin, avisos }`.
- `sa_provisionar_tenant` trata como empresa **nova** (sem admin = 22023, hint RN-CORE-34) também a entrada sem `codigo` cujo `id`
  não é de tenant vivo; a `uf` segue na entrada.
- 0077 (T-0176, RN-CORE-39): a `provisionar_tenant` (create or replace, texto da 0068) dá ao admin que ela **cria** a filial
  padrão do tenant como cadastro e venda (CLI, seeds e portal; a `sa_provisionar_tenant` não muda). Admin existente não muda.
  Detalhes no [core.md](core.md).
- `atribuir_codigo_licenca(p_tenant_id uuid, p_uf text) → jsonb` (SECURITY INVOKER, sem EXECUTE para a aplicação: roda pela
  conexão de administração, como a `provisionar_tenant`): dá o código da licença a um tenant existente.
  `{ tenant_id, codigo_anterior, codigo, resultado: 'atribuido' | 'sem_mudanca' }`. Já com código da mesma UF = o mesmo
  (`sem_mudanca`; `codigo_anterior` = o da última atribuição na auditoria, ou o próprio). Grava `plataforma.auditoria`
  `core / tenant.codigo_licenca` com `antes {codigo}` e `depois {codigo}`. UF inválida ou tenant nulo = 22023; tenant inexistente
  = P0002; encerrado ou excluído = 55000.

**Como dar o código da licença à thathyany** (quando o dono do produto informar a UF; exemplo com RR), na conexão de
administração de produção:
```sql
begin;
select plataforma.atribuir_codigo_licenca(t.id, 'RR') from plataforma.tenant t where t.codigo = 'thathyany';
-- confira o retorno: {"codigo": "RR4821", "codigo_anterior": "thathyany", "resultado": "atribuido", ...}
commit;
```
Rodar de novo com a mesma UF devolve o mesmo código. A partir do commit, o login da empresa é com o código novo (o antigo deixa de
valer): avise o cliente e os aparelhos que guardam o código digitado. Sessões e tokens seguem (são pelo id do tenant).

Caminho de volta: `0068_plataforma_tenant_numero_licenca.down.sql` (funções da 0040/0039, CHECK da 0001 e apaga as 3 funções
novas). **O down falha (55000) se algum tenant tiver código da licença** (o CHECK da 0001 não aceita maiúsculas), sem mudar nada:
devolva antes o código antigo de cada um (`antes` da auditoria `tenant.codigo_licenca`; quem nasceu com o código da licença precisa
de um código no formato antigo, ex.: `lower(codigo)`) e rode de novo. Teste: `db/testes/tenant-numero-licenca.db.test.ts`.

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
| perfil | text not null | até a 0040: CHECK `admin, analista, assistente, supervisor, gerente, vendedor, promotor`. **Desde a 0041** (ADR 0033): CÓDIGO do perfil do tenant, FK `perfil_modulo_perfil_fk (tenant_id, perfil) → plataforma.perfil (tenant_id, codigo)` (de fábrica ou personalizado) |
| modulo | text not null | único `(tenant_id, perfil, modulo)` |

## usuario_modulo — exceção por usuário (RN-CORE-01)
| Coluna | Tipo | Regra |
|---|---|---|
| usuario_id | uuid not null | FK composta `(tenant_id, usuario_id) → core.usuario` (criada na 0002) |
| modulo | text not null | único `(tenant_id, usuario_id, modulo)` |
| efeito | text not null | Sprint 0: só `remover` (exceção nunca acrescenta módulo) |
| motivo | text | |

Módulos efetivos = ativos do tenant ∩ perfil − exceções (calculado no `domain` do Core, revalidado por requisição).
Desde a 0041 (multiperfil, T-0112): (união dos módulos dos perfis do usuário) ∩ ativos do tenant − exceções.

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

**Funções da 0035** (histórico: as 14 do convite, do TOTP e do desafio **saem na 0039** e as outras 6 mudam; ver "Portal só com
e-mail e senha" abaixo. Todas `SECURITY DEFINER`, `execute` só ao `macuxi_portal` desde a 0038):

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

## Portal só com e-mail e senha (0039, T-0093, ADR 0031) — super-admin e admin do cliente, sessão por empresa
Migração `0039_plataforma_portal_email_senha` (volta: `.down.sql`, recria as 20 `sa_*` e a interna com o texto exato da 0035 e
os grants da 0038; APAGA as 3 tabelas novas, o índice `core.usuario_admin_email_ix` e as colunas `ator_tipo`/`usuario_id` da
auditoria, cujas linhas ficam). Drizzle: `portalTentativa`, `portalSessao`, `portalSessaoEmpresa` e as 2 colunas novas em
`auditoriaPlataforma`. Contrato com o Core e a API: R-20261107-150432-banco-dados. **Entra no `main` no mesmo commit do Core
(fatia C) e da API (fatia S):** as 14 funções do convite/TOTP/desafio somem e a `sa_sessao_valida` muda o retorno.

O portal passa a ter **dois tipos de acesso** (ADR 0031 §2): `super_admin` (`plataforma.super_admin`; vê todas as empresas) e
`admin_cliente` (`core.usuario` com `perfil = 'admin'`, `ativo`, `bloqueado_em` nulo, `senha_hash` não nulo, sem `deleted_at`,
em `plataforma.tenant` `ativo` e viva — RN-CORE-33; só nas empresas em que a senha conferiu). A senha é conferida **no Node**
(argon2id): o banco só devolve os hashes das contas candidatas do e-mail. O bloqueio é por **chave do e-mail** (HMAC-SHA256 hex
com o segredo da plataforma, calculado no Node): igual para e-mail que existe e que não existe; o e-mail nunca vai à tabela.

| Tabela | Colunas principais | Regras |
|---|---|---|
| `portal_tentativa` | `chave` (64 hex, única), `falhas` (0 a 4), `bloqueado_ate` | sem e-mail; o acerto apaga a linha (bloqueio vivo fica); sem expurgo (1 linha por e-mail que errou) |
| `portal_sessao` | `tipo` (`super_admin`/`admin_cliente`), `super_admin_id` (FK), `tenant_atual_id` e `usuario_atual_id` (a empresa escolhida; nulas = ainda não escolheu), `criada_em`, `ultimo_uso_em`, `expira_em`, `revogada_em` | CHECK do ator (super-admin sem empresa; cliente sem `super_admin_id`, empresa e usuário juntos); teto de 8 h; FK composta `(id, tenant_atual_id, usuario_atual_id)` → `portal_sessao_empresa`: a empresa atual é sempre uma das conferidas |
| `portal_sessao_empresa` | `sessao_id` (FK), `tenant_alvo_id`, `usuario_id` (sem FK) | 1 a 20 por sessão (função); única por `(sessao_id, tenant_alvo_id)`. **`tenant_alvo_id`, não `tenant_id`, de propósito** (como na `auditoria_plataforma`): com `tenant_id` ela viraria tabela de tenant para a conformidade, o vazamento e a `excluir_tenant` |
| `auditoria_plataforma` (+0039) | `ator_tipo` (`super_admin`/`admin_cliente`, CHECK; nulo nas linhas antigas, no login sem conta e nos fatos do deploy), `usuario_id` (`core.usuario.id` do admin do cliente, sem FK) | append-only continua; índice parcial `auditoria_plataforma_usuario_ix` |

As 3 tabelas: sem `tenant_id` (exceção à regra 5; `TABELAS_SEM_TENANT_ID` e `TABELAS_SO_POR_FUNCAO`), RLS ligado e forçado, só a
política `manutencao`, nenhum grant de tabela (app, worker e portal = 42501). Índice novo numa tabela do Core:
`core.usuario_admin_email_ix (lower(email)) where deleted_at is null and perfil = 'admin'` (a busca entre empresas por e-mail).

**Funções** (todas `SECURITY DEFINER`, `search_path = pg_catalog, plataforma, pg_temp`, `revoke` de `PUBLIC`/`macuxi_app`/
`macuxi_worker`, `EXECUTE` **só** ao `macuxi_portal`; a 0039 confere pelo catálogo que são exatamente estas 12):

| Função | Devolve | O que faz |
|---|---|---|
| `sa_tentativa_estado(p_chave text)` | `table (falhas integer, bloqueado_ate timestamptz)`, sempre 1 linha | chave sem registro = `(0, null)`; `bloqueado_ate` só com bloqueio vivo; chave fora de `^[0-9a-f]{64}$` = 22023 |
| `sa_tentativa_falha(p_chave text)` | idem | bloqueio vivo: nada muda; senão +1; a 5ª seguida zera e bloqueia 15 min (grava `sa.bloqueio`) |
| `sa_tentativa_sucesso(p_chave text)` | `void` | apaga o registro da chave se não houver bloqueio vivo |
| `sa_contas_para_login(p_email text)` | `table (tipo text, conta_id uuid, tenant_id uuid, tenant_codigo text, tenant_nome text, senha_hash text)` | até **20 linhas no total**: super-admin ativo primeiro (tenant nulo), depois os admins qualificados por `tenant.nome`, `tenant.id`; e-mail por `lower(btrim())`; vazio ou fora do formato = 0 linhas, sem erro; grava `sa.login.consulta {contas: n}` (sem e-mail) |
| `sa_abrir_sessao_portal(p jsonb)` | `table (sessao_id uuid, expira_em timestamptz)` | `{tipo:'super_admin', super_admin_id}` ou `{tipo:'admin_cliente', empresas:[{tenant_id, usuario_id}]}` (1 a 20, sem repetir tenant); reconfere TODAS as contas (uma que deixou de valer = 0 linhas, nada gravado); 1 empresa = já escolhida; 8 h; grava `sa.sessao.aberta`; formato errado = 22023 |
| `sa_escolher_empresa(p_sid uuid, p_tenant uuid)` | `table (tenant_id uuid, usuario_id uuid, codigo text, nome text)` | só sessão viva de `admin_cliente`, só tenant da lista, reconferindo admin e empresa; troca a empresa atual; grava `sa.empresa.escolher`; senão 0 linhas |
| `sa_sessao_valida(p_sid uuid)` | `table (tipo text, super_admin_id uuid, tenant_id uuid, usuario_id uuid, expira_em timestamptz)` | viva = não revogada e no prazo; super-admin ativo; cliente com empresa: 0 linhas **na hora** se o admin deixou de valer ou a empresa saiu de `ativo`; atualiza `ultimo_uso_em`. As sessões da `super_admin_sessao` (0035) não valem mais |
| `sa_revogar(p_sid uuid)` | `boolean` | revoga (2ª vez = falso); grava `sa.sessao.revogada` com o ator |
| `sa_auditar(p jsonb)` | `uuid` | como na 0035, mais `ator_tipo` (fora da lista = 22023) e `usuario_id` |
| `sa_listar_tenants(p_sid uuid)` | `jsonb` = `ListaEmpresasSchema` (nome em `razao_social`) | super-admin: todas as vivas; cliente: só as conferidas no login; sessão inválida = 28000 |
| `sa_tenant_ativo(p_sid uuid, p_tenant uuid)` | `boolean` | super-admin: tenant ativo; cliente: `p_tenant` é a empresa atual |
| `sa_provisionar_tenant(p_sid uuid, p jsonb)` | `jsonb` (o da `provisionar_tenant`) | só sessão de super-admin (cliente ou inválida = 28000); aceita `admin {email, nome, senha_hash}` (RN-CORE-34; empresa existente: o admin existente fica e a senha não muda, RN-CORE-31); empresa **nova** sem `admin` = 22023 com `hint = 'RN-CORE-34'` (a API traduz em 422); empresa existente sem `admin` = `sem_admin`; `redefinir_senha` ou `sem_admin` na entrada = 22023; `ator_id` = super-admin; o admin criado recebe a filial padrão como cadastro e venda pela `provisionar_tenant` (0077, RN-CORE-39, `docs/banco/core.md`) |

- Interna: `sa_registrar_auditoria(p_ator_tipo, p_super_admin, p_usuario, p_sessao, p_tenant, p_acao, p_detalhes)` (`SECURITY
  INVOKER`, sem `EXECUTE` para ninguém), no lugar da de 5 argumentos.
- **Deploy:** `plataforma.criar_super_admin(p jsonb) → jsonb` (fora do prefixo `sa_`; `SECURITY INVOKER`; sem `EXECUTE` para
  app, worker ou portal: só a conexão de administração, pela CLI `super-admin`). Entrada `{acao: 'criar'|'redefinir'|'desativar',
  email, nome?, senha_hash?}` (chave desconhecida = 22023; só hash argon2id PHC; mensagens sem e-mail nem hash). Saída
  `{resultado, super_admin_id, sessoes_revogadas}`: `criar` → `criado` | `sem_mudanca` (já existe pelo `lower(email)`, ativo ou
  não; nada muda); `redefinir` → `redefinido` (hash novo, zera `falhas`/`bloqueado_ate` da 0035, revoga as sessões) |
  `nao_encontrado`; `desativar` → `desativado` (revoga as sessões) | `sem_mudanca` | `nao_encontrado`; desativar o **último
  ativo** = 22023. Trava consultiva (uma mudança por vez). Grava `sa.super_admin.<acao>`. O bloqueio por chave do e-mail (15 min)
  não é zerado aqui: o banco não conhece a chave.
- **Saem** (o down recria): `sa_existe`, `sa_criar_primeiro`, `sa_para_login`, `sa_por_id`, `sa_registrar_falha`,
  `sa_registrar_sucesso`, `sa_gravar_totp_pendente`, `sa_confirmar_totp`, `sa_marcar_passo`, `sa_usar_recuperacao`,
  `sa_regerar_recuperacao`, `sa_abrir_desafio`, `sa_ver_desafio`, `sa_abrir_sessao`. Ficam as tabelas `super_admin_desafio` e
  `super_admin_sessao` (histórico) e as colunas de TOTP da `super_admin` (TOTP opcional no backlog).

Fatos gravados pelo banco desde a 0039: `sa.login.consulta`, `sa.bloqueio`, `sa.sessao.aberta`, `sa.empresa.escolher`,
`sa.sessao.revogada`, `sa.tenant.provisionar` (com `admin`), `sa.super_admin.criar|redefinir|desativar`. O Core grava pelo
`sa_auditar` o `sa.login.ok` e o `sa.login.falha`; a API, o `sa.requisicao` dos dois tipos, com `ator_tipo` e `usuario_id`.

**Limite registrado (ADR 0031):** quem tiver a senha do `macuxi_portal` abre sessão sem senha também de admin do cliente e lê o
hash dos admins de um e-mail que já conheça; toda consulta e toda sessão ficam na auditoria append-only pelo próprio banco.
Volume: poucas sessões por dia; até 20 empresas por e-mail. Testes: `db/testes/portal-email-senha.test.ts` (estático, banco com a
fixture dois-tenants e up/down num banco efêmero).

### Portal com a versão da conta (0040, T-0094 §8.1)
- `portal_sessao_empresa` ganha `sessao_versao integer not null default 0` (CHECK `>= 0`): a `core.usuario.sessao_versao` da
  conta no login.
- `sa_contas_para_login(p_email)` passa a devolver `table (tipo, conta_id, tenant_id, tenant_codigo, tenant_nome, senha_hash,
  trocar_senha boolean, senha_expira_em timestamptz, sessao_versao integer)` — super-admin com `false`, nula e nula; **nunca** o
  hash temporário (a senha do "Esqueci" não vale no portal). A API tira da lista a conta com `trocar_senha` e, se a senha só
  conferiu nelas, responde 403 `SENHA_A_TROCAR`.
- `sa_abrir_sessao_portal(p)`: cada empresa aceita `sessao_versao` opcional (inteiro `>= 0`; outro tipo = 22023); conta com
  `trocar_senha` ou versão diferente da informada = 0 linhas, nada gravado; grava a versão de agora em `portal_sessao_empresa`.
- `sa_escolher_empresa` e `sa_sessao_valida`: a sessão de `admin_cliente` cai **na hora** se a `sessao_versao` de qualquer conta
  conferida no login mudou ou se ela ficou com `trocar_senha` (a sessão nasceu do conhecimento daquela senha). Super-admin não
  muda.
- Assinaturas (argumentos) iguais às da 0039: `apps/api/test/funcoes-sa.ts`, `db/testes/funcoes-sa.ts` e o `banco-dbaas.sh` não
  mudam. As 4 são recriadas (drop + create) com EXECUTE só ao `macuxi_portal`; a 0040 refaz a conferência das 12 e confere que o
  `macuxi_portal` não tem privilégio na `email_saida`.

### Portal e multiperfil (0046, D-MP2, T-0094/T-0111; RN-CORE-33, RN-CORE-35, ADR 0033)
Migração `0046_plataforma_portal_multiperfil` (em cima da 0045; volta: `.down.sql`, recria as 4 com o texto da 0040 e apaga a
função nova; nenhum dado muda). Até a 0045, o portal decidia a entrada do admin do cliente só pelo perfil **principal**
(`core.usuario.perfil = 'admin'`): com o multiperfil da 0041, admin + vendedor (ou com `acesso.portal` revogado) entrava.
Ficou numa migração nova porque o filtro lê `usuario_perfil`, `perfil` e `perfil_permissao` (0041): a 0040 não pode depender
da 0041.
- `plataforma.usuario_entra_no_portal(p_tenant uuid, p_usuario uuid) -> boolean`: gêmea de `podeEntrar(perfis, 'portal')` do SDK
  sobre os perfis **vivos e ativos** do usuário (os de `perfis_do_usuario`): ao menos um; **todos de base admin** (regra mais
  restritiva: um perfil de qualquer outra base — vendedor, promotor, supervisor, gerente, analista ou assistente — fecha o
  portal); `acesso.portal` pela **união** (sobreposição viva, senão a fábrica: só o admin). Um personalizado de base admin com
  `acesso.portal` revogado, sozinho, fecha; junto do admin de fábrica, não (igual ao SDK e à tela). SECURITY INVOKER, stable,
  `search_path` fixo, **sem EXECUTE** para app, worker, portal e PUBLIC (só as `sa_*`, como dono, a chamam). Sem o prefixo
  `sa_`: as listas `SA_PORTAL`/`SA_INTERNAS` e o `banco-dbaas.sh` não mudam.
- `sa_contas_para_login` (admin do cliente só com a função: quem não entra = 0 linhas, a mesma resposta de e-mail inexistente),
  `sa_abrir_sessao_portal` (reconfere na abertura), `sa_escolher_empresa` (reconfere na troca de empresa) e `sa_sessao_valida`
  (a sessão cai **na hora** quando a conta da empresa atual ganha um perfil de outra base ou perde o `acesso.portal`, sem
  depender da `sessao_versao`): o texto da 0040 + o filtro; `create or replace` com as mesmas assinaturas, retornos e ACLs
  (EXECUTE só ao `macuxi_portal`; continuam 14 `sa_*`).
- Não mudaram na 0046: `sa_admins_da_empresa` e `sa_redefinir_senha_admin` (0042) — são o resgate da senha do admin pelo suporte,
  não a entrada no portal. A 0047 (abaixo) passa as duas para os perfis reais.
- Volume: a função roda por conta candidata (até 20 no login; 1 por chamada de sessão), pelos índices da 0041
  (`usuario_perfil_usuario_ix`, `perfil_tenant_id_uk`, `perfil_permissao_uk`). Teste: `db/testes/portal-multiperfil.test.ts`
  (estático; banco com a fixture dois-tenants: admin só, admin + cada outra base = `podeEntrar` do SDK, dois perfis admin e
  `acesso.portal` revogado, sessão que cai, a mesma pessoa em duas empresas; up/down num banco efêmero).

### Resgate da senha do admin pelos perfis (0047, resto do D-MP2, T-0094/T-0111; RN-CORE-33, RN-CORE-35, ADR 0033)
Migração `0047_plataforma_portal_admin_multiperfil` (em cima da 0046; volta: `.down.sql`, recria as 2 `sa_*` com o texto exato da
0042 e apaga a função nova; nenhum dado muda). Até a 0046, as 2 funções do resgate decidiam "é admin" pelo perfil **principal**:
quem tinha vendedor (ou outra base) como principal e admin como extra não era alcançado nem pelo suporte nem pelo BKO
(`senha.redefinir` nunca alcança alvo com algum perfil de base admin), e a lista não dizia que o admin + vendedor não entra no
portal. Decisão do gerente (08/11, igual ao SDK e à ADR 0033): entre perfis de base admin vale a **soma**; admin + qualquer base
não admin fecha o portal.
- `plataforma.usuario_tem_perfil_admin(p_tenant uuid, p_usuario uuid) -> boolean`: algum perfil **vivo e ativo** de base admin
  entre os do usuário (os mesmos de `perfis_do_usuario` e da `usuario_entra_no_portal`). É o complemento exato do BKO: o suporte
  alcança quem o BKO não alcança, sem buraco nem sobreposição. SECURITY INVOKER, stable, `search_path` fixo, **sem EXECUTE** para
  app, worker, portal e PUBLIC (só as `sa_*`, como dono, a chamam). Sem o prefixo `sa_`: `SA_PORTAL`/`SA_INTERNAS` não mudam.
- `sa_admins_da_empresa`: mesma assinatura; o retorno **ganha a última coluna `entra_no_portal boolean`** (drop + create, ACL
  igual). Lista quem tem algum perfil de base admin (admin principal, admin extra, admin + vendedor, personalizado de base
  admin); `entra_no_portal` = `usuario_entra_no_portal` (0046, a regra mais restritiva): só admin = true; admin + outra base ou
  personalizado sem `acesso.portal`, sozinho = false. A coluna fala só dos perfis: `ativo`, `bloqueado`, `tem_senha` e
  `trocar_senha` completam se a conta entra de fato. O `AdminDaEmpresaSchema` do SDK (z.object) ignora a coluna até expô-la.
- `sa_redefinir_senha_admin`: mesma assinatura e retorno (`create or replace`, ACL igual). O alvo passa a ser quem tem algum
  perfil vivo e ativo de base admin, mesmo que o principal seja outro; o resto é o da 0042. Sem perfil de base admin (ou só com
  um inativo / vínculo apagado) = P0002.
- RN-CORE-35, regra mais restritiva: vale para os **acessos** (BKO, portal), não para as ações. Redefinir é ação do super-admin
  sobre a conta e não dá acesso (admin + vendedor segue sem portal e sem BKO). Aplicada ao alvo, devolveria o buraco; ela entra
  só na coluna `entra_no_portal`.
- Volume: raro (suporte). Semi-join por usuário em `usuario_perfil_usuario_ix` + `perfil_tenant_id_uk`; a `usuario_entra_no_portal`
  só nas até 50 linhas devolvidas. Continuam 14 `sa_*` do portal. Teste: `db/testes/portal-admin-multiperfil.test.ts` (estático:
  o texto da 0042 com as trocas exatas; banco com a fixture dois-tenants: admin principal, admin + vendedor, vendedor + admin
  extra, perfil inativo/vínculo apagado, personalizado sem portal, multi-tenant com a mesma pessoa em A e B, complemento do BKO
  pelo `pode` do SDK; up/down num banco efêmero).

### Redefinir a senha do admin pelo portal (0042, T-0094, padrão de fábrica da T-0111)
> **0047:** a lista e o alvo da redefinição passaram do perfil principal `admin` para "algum perfil vivo e ativo de base admin", e a
> lista ganhou `entra_no_portal` (seção acima). A tabela abaixo é o texto da 0042.
Migração `0042_plataforma_portal_redefinir_senha_admin` (em cima da 0041, mesmo lote; volta: `.down.sql`, só o drop das 2
funções — senhas já redefinidas continuam temporárias, e-mails enfileirados seguem e a auditoria fica). Decisão do dono do
produto R-20261107-185546 (doc 03 §2): o super-admin da Macuxi redefine pelo portal a senha do admin do cliente. Só funções
(nenhuma tabela, coluna ou política nova); SECURITY DEFINER, `search_path = pg_catalog, plataforma, pg_temp`, EXECUTE **só** ao
`macuxi_portal` (app, worker e PUBLIC sem); só com sessão viva de **super-admin** (admin do cliente ou sessão inválida = 28000).
O portal continua sem privilégio direto em `core.usuario` e na `email_saida`. Agora são **14** `sa_*` do portal
(`FUNCOES_SA_ATUAIS` em `db/testes/funcoes-sa.ts`; a 0042 confere pelo catálogo).

| Função | Retorno | Regras |
|---|---|---|
| `sa_admins_da_empresa(p_sid uuid, p_tenant uuid)` | `table (usuario_id uuid, nome text, email text, ativo boolean, bloqueado boolean, tem_senha boolean, trocar_senha boolean, senha_expira_em timestamptz, sessao_versao integer)` | os admins (`core.usuario.perfil = 'admin'`, o perfil principal, mesmo critério do login do portal) **vivos** da empresa, por nome e id, até 50; empresa inexistente/apagada = 0 linhas; nunca hash; grava `sa.admin.listar {admins: n}` |
| `sa_redefinir_senha_admin(p_sid uuid, p_tenant uuid, p_usuario uuid, p_senha_hash text, p_email text, p_email_id uuid, p_carga bytea)` | `table (email_id uuid, chave_idempotencia text, sessao_versao integer, senha_expira_em timestamptz, repetida boolean)` | ver abaixo |

`sa_redefinir_senha_admin`, numa transação só (a da chamada):
1. alvo = admin vivo, **ativo** e sem `bloqueado_em` da empresa `p_tenant`, empresa `ativo` e viva; senão **P0002** (API: 404);
2. `p_email` = e-mail **atual** do alvo (`lower(btrim())`): a API cifrou a carga para ele; diferente = **55000** (API: 409 e
   recarrega a lista) — a senha nunca vai para um endereço antigo;
3. senha temporária como a 0040 (o mesmo `update` do reset do BKO): `senha_hash = p_senha_hash` (argon2id PHC; só o hash),
   `trocar_senha = true`, `senha_expira_em = now() + 72 h` (P4), `senha_temporaria_*` nulas, `tentativas_falhas = 0`,
   `bloqueio_ate` nulo, `sessao_versao + 1` (token, refresh e sessão do portal do admin caem na hora) e refresh revogados;
4. `email_saida` com `id = p_email_id`, `modelo 'nova_senha'`, `carga = p_carga` (já cifrada pela API, AAD `id|tenant|modelo`;
   1 a 16384 bytes), `chave_idempotencia = '<usuario>:redefinida_portal:<versão nova>'`, `expira_em` = validade da senha;
5. auditoria sem dado pessoal: `plataforma.auditoria` do tenant (`core`, `usuario.senha_redefinir`, entidade `usuario`,
   `usuario_id` nulo, `depois {trocar_senha, sessoes_revogadas, origem: 'portal', email: 'enfileirado'}`) e
   `auditoria_plataforma` (`sa.admin.senha_redefinir {alvo, email_id, sessoes_revogadas}`).

Idempotente por `p_email_id`: a retentativa devolve a linha gravada com `repetida = true` e nada muda; o mesmo id com outro
tenant/usuário = 22023. Entrada inválida (nulo, hash fora do PHC argon2id, e-mail fora do formato, carga vazia/grande) = 22023,
sem dado pessoal na mensagem. Volume: raro (suporte). Teste: `db/testes/portal-redefinir-senha.test.ts` (estático; banco com a
fixture dois-tenants; up/down num banco efêmero).

## Outbox de e-mail (0040, T-0094, ADR 0032 §6) — `email_saida`. Fora do sync
Migração `0040_core_senha_email_saida` (volta: `.down.sql`, APAGA a tabela com os e-mails não enviados). Drizzle: `emailSaida`
em `db/esquema/plataforma.ts`. No lugar do pg-boss: a API grava **na mesma transação** da senha (`macuxi_app` no contexto do
tenant), então senha trocada ⇔ e-mail na fila. A porta `ServicoEmail.enfileirar` (SDK, frente N5) faz o `insert ... on conflict
do nothing`; o despachante (`apps/api/src/email/`, papel `macuxi_worker`) lê o lote pendente com `for update skip locked`,
decifra, envia e **zera a carga**.

| Coluna | Tipo | Regra |
|---|---|---|
| usuario_id | uuid not null | destinatário; FK composta `(tenant_id, usuario_id)` → `core.usuario` |
| modelo | text not null | `acesso_inicial` ("Seu acesso ao Macuxi") \| `nova_senha` ("Sua nova senha") |
| chave_idempotencia | text not null | única por tenant (`email_saida_chave_uk`); `^[A-Za-z0-9_.:+-]{1,200}$` (sem `@` nem espaço: nunca o e-mail). Ex.: `<usuario_id>:<sessao_versao>` |
| carga | bytea | o texto **cifrado** (AES-256-GCM; `para` + dados do modelo, com a senha). Só no pendente: CHECK `(enviado_em is null and falhou_em is null) = (carga is not null)`; 1 a 16 KiB |
| tentativas | integer not null default 0 | `>= 0` |
| proxima_tentativa_em | timestamptz not null default now() | espera crescente entre falhas |
| expira_em | timestamptz not null default now() + 72 h | passou = falha final (a senha temporária também venceu) |
| enviado_em, falhou_em | timestamptz | excludentes (CHECK) |
| ultimo_erro | text | só código curto `^[A-Za-z0-9_.:-]{1,60}$` (nada do texto do servidor SMTP, que pode repetir o e-mail); `anonimizado` na LGPD |

Índices: `email_saida_chave_uk (tenant_id, chave_idempotencia)`, `email_saida_pendente_ix (proxima_tentativa_em) where enviado_em
is null and falhou_em is null` (o lote do despachante) e `email_saida_usuario_ix (tenant_id, usuario_id)` (anonimização).
RLS ligado e forçado: `isolamento_tenant` (`macuxi_app`: só `select, insert`; sem `update` nem `delete`), `manutencao`,
`despacho_email` (`for select to macuxi_worker using (true)`: todos os tenants, como a `despacho_outbox`) e
`despacho_email_marcar` (`for update to macuxi_worker using (enviado_em is null and falhou_em is null) with check (true)`:
só linha pendente). `macuxi_worker`: `select` e `update (carga, tentativas, proxima_tentativa_em, enviado_em, falhou_em,
ultimo_erro)`, sem `insert` nem `delete`. `macuxi_portal`: nada. Volume: dezenas por tenant por mês; sem expurgo ainda (as
enviadas ficam sem carga; um expurgo por idade entra com a política de retenção do [lgpd.md](lgpd.md)). Na exclusão do tenant,
a `excluir_tenant` apaga as linhas pela ordem das FKs.

## Perfis de acesso (0041, T-0111/T-0112, ADR 0033) — `perfil`, `perfil_permissao`, `usuario_perfil`. Fora do sync
Migração `0041_plataforma_perfis_de_acesso` (em cima da 0040; volta: `.down.sql`, APAGA perfis personalizados, sobreposições,
multiperfil e as linhas de `perfil_modulo` de perfis personalizados; o perfil volta a ser só `core.usuario.perfil`). Drizzle:
`perfil`, `perfilPermissao`, `usuarioPerfil` em `db/esquema/plataforma.ts`; ids determinísticos `idPerfilFabrica(tenant, base)` e
`idUsuarioPerfil(tenant, usuario, perfil)` em `db/src/ids.ts`. Modelo: o **padrão de fábrica** de cada perfil base mora no SDK
(`packages/platform-sdk/src/permissoes-perfil.ts` + `perfis` das ações dos manifestos); o banco guarda os perfis do tenant, **só o
que o tenant mudou** e os perfis de cada usuário. Registro: `.coord/contratos/permissoes.md`. Regras: RN-CORE-01, RN-CORE-04,
RN-CORE-33, RN-CORE-35, RN-PRO-01.

### perfil — perfil de acesso do tenant
| Coluna | Tipo | Regra |
|---|---|---|
| codigo | text not null | `^[a-z][a-z0-9_]{1,39}$` (= `CODIGO_PERFIL_RE`); único por tenant **entre todos, apagados inclusive** (`perfil_codigo_uk (tenant_id, codigo)`): é a chave da FK de `perfil_modulo`, dos alvos de `senha.redefinir` e da auditoria. Imutável |
| nome | text not null | não vazio, até 80; os de fábrica = `ROTULO_PERFIL` do SDK |
| descricao | text | até 500 |
| base | text not null | um dos 7 `PERFIS` (`perfil_base_valida`); imutável |
| fabrica | boolean not null default false | `fabrica` ⇒ `codigo = base` (`perfil_fabrica_codigo`) e sempre ativo e não apagado (`perfil_fabrica_ativo`); imutável |
| ativo | boolean not null default true | perfil em uso por usuário não desativa (`perfil_em_uso`, no COMMIT) |

Único `perfil_tenant_id_uk (tenant_id, id)` (alvo das FKs compostas). Os 7 de fábrica existem em todo tenant: semeados pela 0041
nos existentes e pelo gatilho `tenant_semear_perfis` (AFTER INSERT em `plataforma.tenant`) nos novos — `provisionar_tenant`,
`sa_provisionar_tenant` e os seeds ganham os perfis sem mudar de texto. Gatilho `perfil_imutavel` (código, base e fábrica, 23514).
`macuxi_app`: `select, insert, update` (sem `delete`: perfil sai por soft delete).

### perfil_permissao — sobreposição do tenant numa chave (tabela vazia = padrão de fábrica)
| Coluna | Tipo | Regra |
|---|---|---|
| perfil_id | uuid not null | FK composta `perfil_permissao_perfil_fk (tenant_id, perfil_id)` → `perfil` |
| chave | text not null | `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` (= `ACAO_RE`), ex.: `usuario.criar`, `senha.redefinir`, `dados.escopo` |
| concedida | boolean not null | `false` = tira a chave que a fábrica dá; revogada não leva `nivel` nem `alvos` |
| nivel | text | `NIVEIS_ESCOPO ∪ NIVEIS_ALCADA` (`proprio, carteira, equipe, equipes_abaixo, tenant, ate_alcada, acima_alcada`); em `dados.escopo`, só os de escopo. Nulo = o da fábrica |
| alvos | text[] | 1 a 50 códigos de perfil ou `*` (todos que não são de base admin); nulo = os da fábrica |

Único vivo `perfil_permissao_uk (tenant_id, perfil_id, chave) where deleted_at is null`. "Restaurar o padrão" = apagar as linhas.
A migração não grava nenhuma linha. Travas no banco (gatilho `perfil_permissao_travas`, 23514, cópia de `travaDaChave` do SDK):
`acesso.bko` concedido a base vendedor/promotor/supervisor e `acesso.portal` a base que não é admin (RN-CORE-33); escrita de
pedido (`pedido*.` menos `ver`) concedida a base promotor (RN-PRO-01); `dados.escopo` acima do da base (RN-CORE-04).

### usuario_perfil — perfis do usuário (multiperfil, RN-CORE-01)
| Coluna | Tipo | Regra |
|---|---|---|
| usuario_id | uuid not null | FK composta `usuario_perfil_usuario_fk` → `core.usuario` (on delete cascade) |
| perfil_id | uuid not null | FK composta `usuario_perfil_perfil_fk` → `perfil` |

Único vivo `usuario_perfil_uk (tenant_id, usuario_id, perfil_id) where deleted_at is null`; índices `usuario_perfil_usuario_ix
(tenant_id, usuario_id)` (a leitura por requisição) e `usuario_perfil_perfil_ix (tenant_id, perfil_id) where deleted_at is null`
(contagem de usuários por perfil na página). Semeadura da 0041: um vínculo por `core.usuario` (ativos, inativos e apagados) com o
perfil de fábrica de `core.usuario.perfil`. Gravar com `on conflict do nothing`.

`core.usuario.perfil` continua (perfil **principal**, vai no token). Garantias:
- gatilho `usuario_perfil_principal` (AFTER INSERT/UPDATE OF perfil, deleted_at em `core.usuario`): sem perfil vivo e ativo da
  base do principal, liga o de fábrica dessa base. Na troca de perfil de quem tem SÓ o vínculo de fábrica do perfil anterior, o
  vínculo anterior é apagado (soft delete): o Core que só grava `core.usuario.perfil` continua certo. Com 2+ perfis, só acrescenta.
- no **COMMIT** (gatilhos de restrição adiáveis, 23514): todo usuário não apagado tem 1+ perfil vivo (`usuario_sem_perfil`),
  nenhum vínculo vivo com perfil inativo/apagado (`usuario_perfil_indisponivel`) e um perfil cuja base = `core.usuario.perfil`
  (`usuario_perfil_principal`).
- **último admin** (`tenant_ultimo_admin`, RN-CORE-35): toda mudança que mexe na condição de admin (desativar/apagar usuário com
  perfil de base admin; tirar o vínculo admin; ligar perfil vendedor/promotor/supervisor a um admin; desativar perfil de base
  admin; sobreposição de `acesso.bko`, `perfil.gerir`, `usuario.criar|editar|desativar`) exige que sobre um usuário ativo com
  perfil de base admin, nenhum perfil que feche o BKO e, pela união dos perfis, `acesso.bko` e a gestão do acesso. Tenant
  provisionado sem admin não é afetado por quem não mexe em admin. A autogestão (o ator não tira a gestão de si) fica no domain
  do Core.

### Leitura da API e funções
- `plataforma.perfis_do_usuario(p_usuario uuid)` → `(perfil_id uuid, codigo text, base text, nome text, fabrica boolean,
  sobreposicoes jsonb, modulos text[])`: os perfis vivos e ativos do usuário **no tenant do contexto** (sem contexto = 0 linhas),
  ordem `fabrica desc, codigo`; `sobreposicoes` = `[{chave, concedida, nivel, alvos}]` por chave (= `SobreposicaoPermissao` do
  SDK); `modulos` = `perfil_modulo` do código. A API chama a cada requisição na transação das licenças
  (`apps/api/src/licencas.ts`) e resolve com `resolverPerfil`/`combinarPerfis`. Plano esperado (sem Postgres local; EXPLAIN a
  confirmar no CI/VM): buscas por índice (`usuario_perfil_usuario_ix`, `perfil_tenant_id_uk`, `perfil_permissao_uk`, único de
  `perfil_modulo`), poucas linhas por usuário.
- `plataforma.usuario_admin_com_gestao(tenant, usuario)` e `plataforma.tenant_tem_admin_com_gestao(tenant)`: gêmeas de
  `ehAdminComGestao` do SDK; o Core pode usar para mensagem antecipada (o COMMIT confere de qualquer jeito).
- Internas: `semear_perfis_fabrica(uuid)`, `conferir_perfis_do_usuario(uuid, uuid)`, `conferir_ultimo_admin(uuid)` e as funções
  de gatilho. SECURITY INVOKER (a RLS vale), `search_path` fixo com `pg_temp` no fim, sem EXECUTE para PUBLIC — **exceto**, desde
  a 0049 (abaixo), as 4 funções dos gatilhos adiáveis, que são SECURITY DEFINER.

### 0049 — conferências do COMMIT como dono (defeito R-20261108-130423-testes)
Migração `0049_plataforma_conferencias_no_commit_definer` (em cima da 0048; só `ALTER FUNCTION`; volta: `.down.sql`, as 4 voltam a
invoker e o defeito volta junto). Gatilho adiado dispara no COMMIT, **fora** da função que escreveu: quando a escrita vinha de
uma `sa_*` (SECURITY DEFINER) chamada pelo `macuxi_portal` — a `sa_provisionar_tenant` cria o admin em `core.usuario` —, a
conferência rodava como `macuxi_portal`, que não tem grant de tabela: `permission denied for table tenant` no COMMIT e 500 em
`POST /v1/plataforma/empresas`. Os testes do banco não pegavam porque rodavam em transação desfeita.
- `usuario_conferir_acesso()`, `usuario_perfil_conferir()`, `perfil_conferir()` e `perfil_permissao_conferir()` passam a
  **SECURITY DEFINER**, mesmo `search_path` (`pg_catalog, plataforma, pg_temp`), EXECUTE só do dono. Rodam como o migrador
  (superusuário no Docker; `macuxi_admin` com a política `manutencao` no DBaaS), a mesma premissa das `sa_*`.
- Por que é o menor privilégio: função `trigger` só é chamada pelo mecanismo de gatilho (nenhum papel ganha função nova); as 4
  só leem, só do tenant da linha escrita, e o resultado é "segue" ou 23514. GRANT ao portal exigiria SELECT **e política** em
  `core.usuario`, `perfil`, `usuario_perfil`, `perfil_permissao` e `tenant` de todos os tenants (só o SELECT, sem política, faria
  a conferência ver 0 linhas e passar em silêncio); `set constraints all immediate` em cada `sa_*` recriaria funções da 0039/0047
  e a próxima `sa_*` que esquecesse a linha repetiria o defeito.
- As auxiliares (`conferir_perfis_do_usuario`, `conferir_ultimo_admin`, `tenant_tem_admin_com_gestao`,
  `usuario_admin_com_gestao`) seguem invoker: chamadas de dentro das 4, rodam como o dono. Nada muda para o `macuxi_app`.
- Prova (COMMIT de verdade, banco efêmero): `db/testes/conferencias-no-commit.test.ts` — na 0048 o COMMIT do portal dá 42501;
  na 0049 a empresa nasce com o admin (autocommit e transação explícita); `usuario_sem_perfil` e `tenant_ultimo_admin` seguem
  barrando no COMMIT do `macuxi_app`.

RLS (como `perfil_modulo`): `isolamento_tenant` do `macuxi_app` e `manutencao`; `macuxi_worker` e `macuxi_portal`: nada. Fora do
sync (o aparelho recebe as chaves efetivas por `GET /v1/me/modulos`). Auditoria das mudanças: `plataforma.auditoria`, pelo Core.
Volume: 7 + poucos perfis por tenant, dezenas de sobreposições, 1 a 3 vínculos por usuário. Na exclusão do tenant, a
`excluir_tenant` apaga pela ordem das FKs; as conferências do COMMIT ignoram tenant que não existe mais e, no `--recriar` da demo,
os ids determinísticos fazem os perfis e vínculos recriados casarem com os apagados.


### 0051 — nome do perfil Assistente (RD-0014, T-0111)
Pedido R-20261108-202329-designer-ux; texto em `docs/design/perfis-de-acesso.md` §0.1. `plataforma.semear_perfis_fabrica(uuid)`
(create or replace; mesmas ACLs, EXECUTE só ao `macuxi_app`) semeia o assistente de fábrica como **"Assistente"** (antes
"Assistente de BKO"); os outros 6 nomes não mudam (Vendedor, Promotor, Supervisor, Gerente, Analista, Admin). Nos tenants que
já existem, só o perfil `fabrica` de base `assistente` com o nome antigo exato passa a "Assistente"; quem renomeou fica. Código,
base, marca de fábrica, ids e permissões não mudam. **Volta**: a função da 0041 e o nome antigo (um nome "Assistente" posto à mão
também volta; o nome é só exibição). Testes: `db/testes/perfil-assistente.test.ts` (texto da função = 0041 com o nome trocado,
update restrito, fixture com os 7 nomes da tela, up/down com tenant antigo, renomeado e novo).

### 0052 — login sem nome do tenant (T-0122 N5)
Pedido R-20261109-000053-engenheiro-software. `plataforma.tenant_por_codigo(text)` (login, SEM contexto, SECURITY DEFINER,
search_path da 0012, EXECUTE só ao `macuxi_app`) devolve só **(id, status)**: o nome e o fuso das empresas não saem antes da
senha (não dá para enumerar empresas pelo código). Função nova **`plataforma.tenant_da_sessao()`** → (id, codigo, nome, fuso)
do tenant da sessão (`app.tenant_id`), SECURITY INVOKER (lê `plataforma.tenant` pela RLS; sem contexto = 0 linhas), EXECUTE só
ao `macuxi_app`: o Core lê o nome e o fuso depois da senha, dentro de `comTenant`. **Sobe no mesmo lote do Core**
(`tenantParaExibicao`). `evento_nome_formato` e `evento_consumo_consumidor_formato` alinhados ao `EVENTO_RE` do SDK (segmento
`[a-z][a-z0-9_]*`, sem hífen; NOT VALID + VALIDATE). **Volta**: a função da 0001 (id, nome, fuso, status) e os CHECKs com hífen;
`tenant_da_sessao` sai. Testes: `db/testes/tenant-por-codigo-minimo.test.ts`.

### 0069 — cargo do perfil e um perfil por usuário (`0069_core_cargo_hierarquia`; decisão do dono do produto de 14/11/2026)
Decisão: [ADR 0049](../decisoes/0049-cargos-fixos-e-um-perfil-por-usuario.md) (R-20261114-153500, -153800, -154000).

**`perfil.cargo`** text NOT NULL, **sem padrão** (`perfil_cargo_valido`: `vendedor`, `promotor`, `supervisor`, `gerente`, `administrativo`;
lista `CARGOS` do `@macuxi/platform-sdk` (ADR 0049 §1), importada pelo espelho). Quem cria perfil personalizado informa o cargo (insert sem cargo = 23502). O
cargo é editável (o domain do Core decide se o BKO deixa trocar o de fábrica; o banco não trava). Mapeamento base → cargo =
`plataforma.cargo_da_base(text)` (SQL imutável, EXECUTE ao `macuxi_app`), usado no backfill (fábrica e personalizados que já
existiam: o cargo da base deles; não existe perfil sem base) e em `semear_perfis_fabrica` (tenant novo):

| base | vendedor | promotor | supervisor | gerente | analista | assistente | admin | outro |
|---|---|---|---|---|---|---|---|---|
| cargo | vendedor | promotor | supervisor | gerente | administrativo | administrativo | administrativo | administrativo |

Mudar o mapeamento depois = migração nova com `create or replace function plataforma.cargo_da_base` + `update` dos perfis.
O cargo `promotor` tem regra no banco (gerente obrigatório): ver [core.md](core.md) "0069"; trocar o cargo de um perfil em uso
(`update ... set cargo`) também é conferido (gatilho `perfil_conferir_promotor`).

**Um perfil por usuário** — restrição de exclusão `usuario_perfil_um_vivo` em `usuario_perfil`: `exclude using btree (tenant_id
with =, usuario_id with =) where (deleted_at is null) deferrable initially deferred`. No máximo **um vínculo vivo** por (tenant,
usuário); conferida no COMMIT (23P01), então a troca pode apagar o antigo e inserir o novo em qualquer ordem na mesma transação; é
índice, segura também contra duas gravações concorrentes. **Não use `on conflict do nothing` sem alvo** em `usuario_perfil`: o
Postgres recusa restrição adiável como árbitro (use `on conflict (id)`). O único `usuario_perfil_uk` da 0041 continua (o mesmo
perfil vivo duas vezes = 23505 na hora).
- Gatilho `usuario_perfil_principal` (função `garantir_perfil_principal`, create or replace): trocar `core.usuario.perfil` para
  uma base que o usuário não tem **substitui** o vínculo (soft delete do vivo + o de fábrica da base nova). Sem o "com 2+ perfis
  só acrescenta" da 0041.
- Limpeza na migração (quem tinha 2+ vínculos vivos): fica **um**, pela ordem — perfil ativo e vivo antes de inativo/apagado;
  base `admin > gerente > supervisor > analista > assistente > vendedor > promotor` (pela **base**: o cargo `promotor` não muda
  a ordem, o promotor já era o último); na mesma base, o personalizado antes do de
  fábrica (foi a escolha do admin), **salvo na base admin**, em que fica o de fábrica (garante a gestão do acesso, RN-CORE-35);
  depois o vínculo mais novo; por fim o id. Os outros: soft delete com `deleted_at` = instante da migração (=
  `public.macuxi_migracao.aplicada_em` da 0069). `core.usuario.perfil` passa à base do que ficou quando era outra (anda o
  `updated_at`). Lista dos afetados (rodar **antes** do deploy): `db/scripts/diagnostico-0069.sql`, consulta 1.
- As conferências da 0041 (`usuario_sem_perfil`, `usuario_perfil_indisponivel`, `usuario_perfil_principal`, `tenant_ultimo_admin`)
  continuam iguais. Na fixture dois-tenants, desde a 0069, ninguém tem 2 perfis (`vendedor_externo` e `vendedor_balcao` ficam sem
  usuário). Os testes de portal da 0046/0047 montam 2+ perfis só **dentro** da transação (sem COMMIT) para provar a regra mais
  restritiva do portal, que fica como defesa.

**Volta** (`.down.sql`): saem os 4 gatilhos do promotor e as 2 funções deles, a view da hierarquia, a exclusão, `perfil.cargo` (o cargo de personalizado se perde;
reaplicar volta ao da base) e `cargo_da_base`; `garantir_perfil_principal` volta ao texto da 0041 e `semear_perfis_fabrica` ao
da 0051; os vínculos apagados pela 0069 (deleted_at = `aplicada_em` da 0069, perfil ainda ativo e sem vínculo vivo igual) voltam
a vivos. `core.usuario.perfil` **não volta** (fica a base mais alta, que continua entre os perfis). Volte antes o Core que grava o
cargo e lê a view. Testes: `db/testes/cargo-hierarquia.db.test.ts` (estático no PC; fixture e up/down no CI); ajustados
`perfis-acesso`, `portal-multiperfil` e `portal-admin-multiperfil`.

## Funções
- `plataforma.tenant_atual()` (0001): contexto do tenant (falha fechada).
- `plataforma.tenant_por_codigo(text)` (0001): login, SECURITY DEFINER revisada; `pg_temp` no fim do `search_path` (0012); só (id, status) desde a 0052.
- `plataforma.tenant_da_sessao()` (0052): id, codigo, nome e fuso do tenant da sessão (INVOKER, pela RLS), depois da senha.
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
  com `sem_admin`, `parametros` e `ator_id`: seção "Super-admin de plataforma" acima. Desde a 0039 (T-0093): as 12 `sa_*` do
  login só com e-mail e senha e a `criar_super_admin` (deploy): seção "Portal só com e-mail e senha" acima.

## 0057 — leitura restrita de arquivo por perfil (`0057_core_foto_pdv`; T-0147, ADR 0041)
Pedido R-20261110-065020-engenheiro-software. `plataforma.arquivo.perfis_leitura text[]`:
- **NULO = regra de hoje** (ADR 0010: licença + perfil do módulo + carteira do `cliente_id`).
- **Lista** = o usuário precisa ter um destes perfis **e** a carteira (o `GET /v1/arquivos/:id` e a miniatura respondem 404
  sem motivo fora disso, `cache-control: private, no-store`). CHECK `arquivo_perfis_leitura_validos`: 1..7 perfis da
  plataforma (`PERFIS` do platform-sdk), sem nulo; lista vazia é recusada (use nulo).
- Quem grava: o módulo dono no `tx.registrarArquivo` (o Core: `PERFIS_DOC_SENSIVEL` = admin, analista, gerente, supervisor nos tipos
  sensíveis) e o `tx.restringirArquivos` quando o tipo muda de sensível. Sem índice (a leitura é pela PK). Fora do sync.
- Os gatilhos `tenant_semear_filial` (0056) e `tenant_semear_foto_tipo` (0057) entram em `plataforma.tenant` como os da 0006,
  0018, 0037 e 0041: o tenant novo nasce com a filial padrão e o tipo "Fachada", sem mudar `provisionar_tenant`.
- Volta: a coluna e o CHECK saem (a leitura dos sensíveis volta à regra da carteira: desfaça antes a regra do GET).

## Diagnóstico do aparelho (0058, T-0158, ADR 0043) — `diagnostico`. Fora do sync
Migração `0058_plataforma_diagnostico` (volta: `.down.sql`, APAGA os diagnósticos e a sequência; os prints em
`plataforma.arquivo` e os bytes ficam). Desenho `docs/desenho/T-0158.md` §4; contrato `packages/platform-sdk/src/diagnostico.ts`.
Drizzle: `diagnostico` em `db/esquema/plataforma.ts`. O botão "Enviar diagnóstico" (v1.0.4) e a queda automática (v1.0.5)
chegam por `POST /v1/diagnosticos`; a API grava no contexto do tenant (`macuxi_app`), o worker manda o recado automático e o
super-admin lê no portal. **Só dado técnico**: empresa e usuário por id, vindos do token.

| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid | gerado no aparelho; repetir o envio = `insert ... on conflict (id) do nothing` e reler o protocolo |
| protocolo | bigint not null | número legível **global** ("nº 0042", `formatarProtocolo` do SDK), default `nextval('plataforma.diagnostico_protocolo_seq')` (sequência `owned by` a coluna, começa em 1). Único (`diagnostico_protocolo_uk`, sem `tenant_id` de propósito: nenhum tenant escolhe o valor). O app não tem INSERT na coluna |
| usuario_id | uuid not null | quem enviou; FK composta `(tenant_id, usuario_id)` → `core.usuario` |
| perfil | text not null | perfil base de quem enviou: os 7 `PERFIS` do SDK (CHECK) |
| origem | text not null | `botao` \| `queda` \| `erro_tela` (`ORIGENS_DIAGNOSTICO`) |
| app | text not null | `campo` \| `gestao` |
| versao_app | text not null | 1..20 (ex.: `1.0.4`) |
| build | text | ≤ 60 (`runtimeVersion`/`nativeBuildVersion`) |
| aparelho_fabricante, aparelho_modelo, android | text | ≤ 60, ≤ 80, ≤ 20. Nunca IMEI, série ou nome do aparelho |
| android_api | integer | 0..1000 |
| tela | text | rota do expo-router, ≤ 200, **sem `?` nem `#`** (CHECK: a query string pode levar dado pessoal; a API corta antes) |
| motivo | text | ≤ 60 (`crash_nativo`, `anr`... ou a origem do erro de tela; nulo no botão) |
| descricao | text | "O que aconteceu?", ≤ 1000, já mascarado pela API (`mascararDadoPessoal`) |
| detalhe | jsonb not null default `{}` | só as chaves `erro`, `saida_android`, `sync`, `ultimas_saidas` (CHECK; a lista tem até 5 saídas do Android, `MAX_SAIDAS_DIAGNOSTICO`), objeto, até 32 KB |
| print_id | uuid | id do print em `plataforma.arquivo` (`modulo = 'plataforma'`, `finalidade = 'print_diagnostico'`, `entidade = 'diagnostico'`). **Sem FK**: o print que não chega sai em 7 dias e a linha fica |
| ocorrido_em | timestamptz not null | instante do aparelho (toque ou `quando` da saída) |
| recebido_em | timestamptz not null default now() | relógio do servidor: ordem da lista, filtros de data e prazo de 90 dias |
| alerta_situacao | text not null default `pendente` | `pendente` \| `enviado` \| `agrupado` \| `falhou` \| `desligado` (recado automático, worker) |
| alerta_tentativas | integer not null default 0 | 0..100 |
| alerta_proxima_em | timestamptz | espera exponencial do worker |
| alerta_recado_id | text | `R-<aaaammdd>-<hhmmss>-<remetente>[-n]` |
| alerta_em | timestamptz | quando o recado foi gravado |
| comuns | | `tenant_id`, `created_at`, `updated_at` (gatilho), `deleted_at` (não usado: o expurgo apaga de fato), `external_id` (sempre nulo) |

Índices: `diagnostico_protocolo_uk (protocolo)`; os da lista do portal, todos com `(recebido_em desc, id desc)` no fim para o
keyset: `diagnostico_recebido_ix` (sem filtro e expurgo), `diagnostico_tenant_ix (tenant_id, ...)`,
`diagnostico_versao_ix (versao_app, ...)`, `diagnostico_modelo_ix (aparelho_modelo, ...)`, `diagnostico_motivo_ix (motivo, ...)`;
`diagnostico_alerta_pendente_ix (alerta_proxima_em) where alerta_situacao = 'pendente'` (lote do worker) e
`diagnostico_usuario_ix (tenant_id, usuario_id)` (FK). Volume: dezenas por dia na plataforma toda; até ~100 mil linhas em 90 dias.

**Acesso** (RLS ligado e forçado):
- `macuxi_app`: `isolamento_tenant`; `select` e `insert` **por coluna** (`id, tenant_id, usuario_id, perfil, origem, app,
  versao_app, build, aparelho_fabricante, aparelho_modelo, android, android_api, tela, motivo, descricao, detalhe, print_id,
  ocorrido_em`) + `usage` na sequência. Sem `update` nem `delete`. O mesmo `id` de outro tenant: o insert não faz nada e a
  releitura não acha (a API responde 409 `DIAGNOSTICO_JA_EXISTE`).
- `macuxi_worker`: `diagnostico_alerta` (`for select using (true)`, todos os tenants) e `diagnostico_alerta_marcar` (`for
  update using (alerta_situacao in ('pendente', 'agrupado')) with check (true)`); `select` por coluna **sem `descricao` e
  `detalhe`** (o recado nunca leva texto livre nem pilha) e `update` só de `alerta_situacao, alerta_tentativas,
  alerta_proxima_em, alerta_recado_id, alerta_em`. Sem `insert` nem `delete` direto.
- `macuxi_portal`: nada na tabela; só as funções abaixo. `manutencao`: a de toda tabela (0031).

**Funções** (SECURITY DEFINER, `search_path = pg_catalog, plataforma, pg_temp`):
- `plataforma.sa_listar_diagnosticos(p_sid uuid, p_filtro jsonb) returns jsonb` — EXECUTE só ao `macuxi_portal`. Sessão
  inválida ou vencida = 28000; admin do cliente = 42501. `p_filtro` (o `DiagnosticoFiltroSchema`, revalidado): `versao`,
  `modelo`, `tenant_id`, `motivo`, `origem` (igualdade), `de` (`recebido_em >=`) e `ate` (`recebido_em <`), `cursor`; chave fora
  do contrato, valor que não é texto ou valor inválido = 22023; texto vazio = sem filtro. Devolve `{ itens: [...], cursor }`
  (`DiagnosticoListaSchema`), 50 por página, do mais novo ao mais antigo; `tenant_nome` = `plataforma.tenant.nome`;
  `tem_print` = há arquivo `recebido`. Cursor opaco `"<recebido_em em UTC com microssegundos>Z|<id>"` (keyset
  `(recebido_em, id) <`); nulo na última página. Audita `sa.diagnostico.listar` com a contagem.
- `plataforma.sa_diagnostico(p_sid uuid, p_id uuid) returns jsonb` — EXECUTE só ao `macuxi_portal`; mesmos códigos de sessão;
  não achou = P0002. Devolve o `DiagnosticoDetalheSchema` (item + `build`, `aparelho_fabricante`, `android_api`, `tela`,
  `descricao`, `erro`, `saida_android`, `ultimas_saidas` (`[]` se ausente), `sync`, `usuario_id`, `perfil`, `alerta {situacao, recado_id, em}`) e mais `print_id`
  e `chave_armazenamento` (do print `recebido`; nulo sem print), que a API usa para ler os bytes e não repassa ao portal.
  Audita `sa.diagnostico.ver` com o id e o protocolo (nunca o texto).
- `plataforma.expurgar_diagnosticos(p_agora timestamptz default now(), p_limite integer default 500) returns table
  (diagnosticos integer, arquivos integer, chaves text[])` — EXECUTE só ao `macuxi_worker` (tarefa diária, desenho §3). Numa
  transação: apaga **de fato** até `p_limite` diagnósticos com `recebido_em < p_agora - 90 dias` (o mais antigo primeiro, `for
  update skip locked`) e o arquivo do print deles; e até `p_limite` prints `aguardando` com mais de 7 dias. Devolve as
  contagens e as chaves do armazenamento para o worker chamar `ArmazenamentoArquivos.remover` **depois do commit** (falhou =
  `warn`; a chave órfã fica sob `<tenant_id>/plataforma/`). `p_limite` 1..5000 (fora = 22023). Repita até `diagnosticos = 0`
  e `arquivos = 0`.

As 2 `sa_*` entram nas listas de conformidade (`db/testes/funcoes-sa.ts` `FUNCOES_SA_0058`; `apps/api/test/funcoes-sa.ts` e
`scripts/deploy/producao/banco-dbaas.sh`, do engenheiro-software): o portal passa a executar **16** `sa_*`. Prova:
`db/testes/diagnostico.test.ts` (estático sempre; banco no CI: RLS entre os 2 tenants, app sem update/delete, worker sem texto
livre, `sa_listar_diagnosticos` recusa o admin do cliente, keyset, expurgo com o print, up/down).

Consultas da API (referência):
```sql
-- POST /v1/diagnosticos (comTenant): grava e relê o protocolo (repetição = 200 com o mesmo protocolo)
insert into plataforma.diagnostico (id, tenant_id, usuario_id, perfil, origem, app, versao_app, build, aparelho_fabricante,
  aparelho_modelo, android, android_api, tela, motivo, descricao, detalhe, print_id, ocorrido_em)
values ($1, plataforma.tenant_atual(), $2, ...) on conflict (id) do nothing returning protocolo;
select usuario_id, protocolo from plataforma.diagnostico where id = $1;   -- 0 linhas = id de outro tenant (409)
-- worker, alerta (60 s)
select id, tenant_id, protocolo, origem, app, versao_app, aparelho_modelo, android, tela, motivo, usuario_id, perfil, print_id, recebido_em
  from plataforma.diagnostico
 where alerta_situacao = 'pendente' and (alerta_proxima_em is null or alerta_proxima_em <= now())
 order by recebido_em limit 10 for update skip locked;
```

## Planos e assinatura (0070, ADR 0047) — `plano` e `assinatura`. Fora do sync
Migração `0070_plataforma_plano_assinatura` (volta: `.down.sql`, APAGA o catálogo e as assinaturas; desfaça antes a 0071 e
desligue `MACUXI_PLANOS` na API). Desenho `docs/desenho/planos-e-licencas.md`; contrato `packages/platform-sdk/src/planos.ts` e
`apps/api/src/planos-portal.ts` (`fontePlanosNoBanco`). Drizzle: `plano` e `assinatura` em `db/esquema/plataforma.ts`. O
catálogo é **dado** (RN-PLA-01): preços, licenças e dias de teste vêm do seed com os números do dono do produto, nunca de código.

### plano — catálogo de planos da plataforma (exceção: sem `tenant_id`; só por função)
| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid | `PlanoSchema.id`; a assinatura aponta para ele |
| codigo | text not null | `^[a-z][a-z0-9_]{1,29}$` (`CodigoPlano` do SDK); único entre os vivos (`plano_codigo_uk`, parcial `deleted_at is null`) |
| nome | text not null | 1..60 (o que a coluna Plano do portal mostra) |
| ordem | integer not null default 0 | ≥ 0; ordem de exibição e de "subir de plano" |
| preco_mensal_centavos | bigint not null | ≥ 0, centavos |
| licenca_vendedor, licenca_gestor, licenca_bko, licenca_promotor | integer | licenças incluídas por tipo (RN-PLA-02); **null = sem limite**; ≥ 0 |
| modulos | text[] not null default `{}` | módulos incluídos; só os 8 `MODULOS` do SDK (CHECK `plano_modulos_validos`); core e integracao entram sempre pela API |
| adicionais | jsonb not null default `[]` | `[{ adicional: promotor \| pesquisa \| treinamento, preco_unitario_centavos, incluidos (null = ilimitado) }]`; lista de até 3 (CHECK) |
| meses_gratis_anual | integer not null default 0 | 0..11 (RN-PLA-06: no anual paga-se 12 − isto) |
| dias_teste | integer not null default 0 | 0..90 (0 = sem teste) |
| ativo | boolean not null default true | fora de venda = false (a `sa_gravar_assinatura` recusa com `PLANO_INATIVO`) |
| comuns | | `created_at`, `updated_at` (gatilho), `deleted_at`, `external_id` (sem `tenant_id`: `TABELAS_SEM_TENANT_ID`) |

Versão nova do plano (preço ou licenças) = **linha nova** com o mesmo código e a antiga com `deleted_at`: as assinaturas antigas
continuam na linha que contrataram. RLS ligado e forçado, só a política `manutencao`; nenhum grant de tabela para `macuxi_app`,
`macuxi_worker` ou `macuxi_portal` (`TABELAS_SO_POR_FUNCAO`). Volume: poucas linhas.

### assinatura — o plano de cada tenant
| Coluna | Tipo | Regra |
|---|---|---|
| plano_id | uuid not null | FK → `plataforma.plano` (a linha contratada; índice `assinatura_plano_ix`) |
| ciclo | text not null default `mensal` | `mensal` \| `anual` |
| adicionais | jsonb not null default `[]` | `[{ adicional, quantidade 1..100000 }]`, até 3, sem repetir (a `sa_*` confere; o CHECK garante a lista) |
| teste_ate | date | último dia do teste grátis, **inclusive**, no fuso do tenant (RN-PLA-06); null = sem teste |
| paga | boolean not null default false | o teste terminou com contratação, ou começou sem teste. CHECK `assinatura_paga_ou_teste`: `paga or teste_ate is not null` |
| pedido_id | uuid not null | UUID do portal que gravou (chave de idempotência do passo "Empresa com plano") |
| comuns | | `tenant_id` (FK `plataforma.tenant`), `created_at`, `updated_at` (gatilho), `deleted_at`, `external_id` |

Uma **viva** por tenant: `assinatura_tenant_uk (tenant_id) where deleted_at is null`. Empresa sem assinatura = legado anterior
aos planos (sem trava, RN-PLA-04). RLS ligado e forçado: `isolamento_tenant` (o `macuxi_app` só **lê** a do próprio tenant) e
`manutencao`; worker e portal sem grant. Escrita só pela `sa_gravar_assinatura`. Fora do sync (`TABELAS_FORA_DO_SYNC`). Volume:
uma linha por tenant. A trava do cadastro de usuários (`plataforma.licencas_do_tenant()`, RN-PLA-04) e a troca de plano
(`sa_trocar_plano`, `assinatura_historico`) entram em migração própria.

### Funções
- `plataforma.sa_gravar_assinatura(p_sid uuid, p_tenant uuid, p jsonb) returns jsonb` — a chamada da API
  (`select plataforma.sa_gravar_assinatura($1, $2, $3::jsonb)`). SECURITY DEFINER, `search_path = pg_catalog, plataforma,
  pg_temp`, EXECUTE só ao `macuxi_portal`. Só super-admin: sessão inválida ou vencida = 28000; admin do cliente = 42501.
  `p` = `EntradaAssinatura` da API: `{ plano (código), ciclo, adicionais, teste_ate ('AAAA-MM-DD' | null), paga, pedido_id }`;
  chave fora dessas, valor fora do formato ou `paga = false` sem `teste_ate` = 22023. Plano que não existe (vivo) = 22023 com
  `hint = 'PLANO_DESCONHECIDO'`; plano inativo = `PLANO_INATIVO`; adicional que o plano não vende = `ADICIONAL_FORA_DO_PLANO` (a
  API devolve 422 com o hint). Tenant que não existe ou excluído = P0002. **Idempotente**: uma por tenant (trava consultiva por
  tenant); se já houver assinatura viva, nada muda e devolve `existente` com o `teste_ate` gravado. Retorno
  `{ resultado: 'criada' | 'existente', teste_ate: 'AAAA-MM-DD' | null }`. Audita `sa.assinatura.gravar` com `plano`, `ciclo`,
  `com_teste` e `resultado` (sem dado pessoal). O portal passa a executar **17** `sa_*` (`db/testes/funcoes-sa.ts`
  `FUNCOES_SA_0070`; as listas de `apps/api/test/funcoes-sa.ts`, `scripts/deploy/producao/banco-dbaas.sh` e
  `tests/integracao/banco/conformidade.test.ts` ganham a função pelos donos).
- `plataforma.sa_listar_tenants(p_sid uuid)` (0071, `0071_plataforma_listar_tenants_plano`; volta: `.down.sql` com o texto da
  0039): tudo o que a 0039 fazia (sessão, super-admin todas as vivas, admin do cliente só as do login, módulos do contrato) e
  cada item ganha, por `left join` na assinatura viva e no plano dela: `plano` (`plano.nome` ou null; o nome fica mesmo com a
  linha do plano trocada por versão nova), `teste_ate` (`to_char(teste_ate, 'YYYY-MM-DD')` ou null) e `paga`
  (`coalesce(paga, false)`). A API tira o `paga` e calcula o `em_teste` no fuso de cada empresa (`EmpresaResumoSchema`).

Prova: `db/testes/plano-assinatura.db.test.ts` (estático sempre; banco no CI: acesso direto por papel, CHECKs, a
`sa_gravar_assinatura` com sessão, perfis, erros, hints, idempotência e auditoria, a lista com e sem assinatura, up/down da 0070
e da 0071). Fixture: `PLANOS_FIXTURE` (fixture_pme ativo, fixture_antigo inativo; fora de `ORDEM_TABELAS`, gravados antes) e
`ASSINATURAS_FIXTURE` (A em teste até 2026-11-27; B paga, anual) em `db/seeds/fixtures/dois-tenants.ts`.

Consultas da API (referência):
```sql
-- POST /v1/plataforma/empresas-com-plano, depois da empresa criada (macuxi_portal)
select plataforma.sa_gravar_assinatura($1, $2, $3::jsonb) as r;   -- { resultado, teste_ate }
-- GET /v1/plataforma/empresas (lista com a coluna Plano)
select plataforma.sa_listar_tenants($1) as r;                      -- itens[].plano, teste_ate, paga
```


## Ações da empresa (0072, ADR 0052) — inativar, backup e excluir. Fora do sync
Migração `0072_plataforma_empresa_acoes` (em cima da 0071; volta: `.down.sql`, que APAGA os registros de backup, exclusão e
empresa excluída e as colunas da inativação; desligue antes `MACUXI_EMPRESA_ACOES` e o worker de backup). Desenho
`docs/desenho/empresa-acoes.md` §4; contrato `packages/platform-sdk/src/empresa-acoes.ts` (RN-PLA-07..11). Drizzle: colunas
novas do `tenant` e `backupEmpresa`, `backupEmpresaParte`, `exclusaoEmpresa`, `empresaExcluida` em `db/esquema/plataforma.ts`.
Teste: `db/testes/empresa-acoes.db.test.ts`.

### tenant — colunas da inativação (RN-PLA-07)
| Coluna | Tipo | Regra |
|---|---|---|
| inativada_em | timestamptz | quando ficou inativa (`status = 'suspenso'`, rótulo "Inativa"); null = ativa |
| motivo_inativacao | text | opcional (a tela envia `{}`; null = sem motivo); `MOTIVOS_INATIVACAO` do SDK (CHECK `tenant_motivo_inativacao_valido`); sem texto livre |

CHECK `tenant_inativacao_coerente`: ativo ⇔ sem data, e o motivo só existe fora de `ativo` (suspenso e encerrado sempre com a
data; o motivo pode ser nulo). Gatilho `tenant_inativacao_preencher` (BEFORE): status `ativo` limpa os dois; status fora de
`ativo` sem data ganha `now()`, sem motivo (o `update ... set status = 'suspenso'` direto continua valendo). Na migração, as
linhas fora de `ativo` ganharam a data do `updated_at` e motivo nulo.

### Tabelas que sobrevivem à exclusão (exceção da regra 5; só por função)
As quatro têm `empresa_id` **sem FK** (ou o próprio id, na `empresa_excluida`) e nenhum `tenant_id`, como a
`auditoria_plataforma`: a `excluir_tenant` não as toca. RLS ligado e forçado, só a política `manutencao`, nenhum grant de tabela
(`macuxi_app`, `macuxi_worker` e `macuxi_portal`: 42501). `TABELAS_SEM_TENANT_ID` e `TABELAS_SO_POR_FUNCAO`.

**backup_empresa** — um job de backup por linha (RN-PLA-08).
| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid | gerado no portal (chave de idempotência do pedido) |
| empresa_id | uuid not null | o tenant (sem FK) |
| codigo | text not null | código da empresa no pedido (vai ao manifesto) |
| situacao | text not null default `em_andamento` | `em_andamento` → `pronto` \| `falhou` → `apagado` (retenção) |
| consistente | boolean not null default false | pedido com a empresa inativa e ela inativa até o fim (a `sa_reativar_tenant` zera o do backup em andamento; a `fechar_backup` reconfere `inativada_em <= iniciado_em`) |
| pedido_em, iniciado_em, concluido_em, expira_em | timestamptz | `iniciado_em` = 1ª vez que o worker pegou; `expira_em` = fim + 30 dias (o da exclusão: fim da exclusão + 90 dias) |
| progresso_pct | integer not null default 0 | 0..100; as partes levam até 90, o fechamento a 100 |
| tamanho_bytes, tabelas, linhas, arquivos | bigint/integer | do fechamento (`tabelas` e `linhas` somados das partes) |
| erro_codigo | text | `^[A-Z][A-Z0-9_]{1,59}$`, só (e sempre) em `falhou` |
| bloqueado_ate | timestamptz | concessão do worker (10 min, renovada a cada página e parte) |
| super_admin_id, sessao_id | uuid | quem pediu |
| comuns | | `created_at`, `updated_at` (gatilho), `deleted_at`, `external_id` |

CHECKs: pronto tem `concluido_em`, `tamanho_bytes` e 100%; em andamento sem `concluido_em`. Índices: um em andamento por
empresa (`backup_empresa_um_em_andamento_uk`), `(empresa_id, pedido_em desc, id)` (lista do portal), fila `(pedido_em, id)` dos
em andamento e `expira_em` dos prontos e falhos (retenção). Volume: poucas linhas por empresa por mês.

**backup_empresa_parte** — parte confirmada no bucket: `backup_id` (FK, `on delete cascade`), `tabela`
(`esquema.tabela`), `ordem` (da `ordem_do_backup`), `linhas`, `bytes`, `sha256` (hex); única por `(backup_id, tabela)` (o worker
retoma da última confirmada; regravar a mesma parte só a atualiza).

**exclusao_empresa** — o job da exclusão (RN-PLA-09): `id` (portal), `empresa_id`, `codigo`, `backup_id` (FK para o backup que
liberou), `situacao` (`em_andamento` \| `concluida` \| `falhou`), `etapa` (`banco` → `arquivos` → `fim`), `pedida_em`,
`concluida_em`, `linhas_apagadas`, `arquivos_apagados`, `contagem` (jsonb: linhas apagadas por tabela, o retorno da
`excluir_tenant`), `erro_codigo` (só e sempre em `falhou`), `bloqueado_ate`, `super_admin_id`, `sessao_id` e os comuns.
Concluída tem `concluida_em` e etapa `fim`. Uma em andamento por empresa (`exclusao_empresa_em_andamento_uk`).

**empresa_excluida** — o registro da empresa apagada (RN-PLA-10): `id` (= o do tenant), `codigo`, `documento` (CNPJ),
`razao_social`, `excluida_em`, `backup_id`, `exclusao_id` (FKs), `super_admin_id` e os comuns. Código único entre as excluídas
(`empresa_excluida_codigo_uk`, `lower(codigo)`). A restauração (operação manual, desenho §3) apaga a linha do id restaurado.

### Código da licença nunca reaproveitado (RN-PLA-10)
- Gatilho `tenant_codigo_nao_reaproveitado` (BEFORE INSERT ou UPDATE OF `codigo` em `plataforma.tenant`): código de empresa
  excluída com **outro** id = 23505. Vale para `provisionar_tenant`, `sa_provisionar_tenant`, `atribuir_codigo_licenca` e
  qualquer insert. O mesmo id (restauração) passa.
- `sortear_codigo_licenca` (create or replace; mesma assinatura e ACL da 0068) não sorteia código de empresa excluída.

### Despachante e e-mail pulam a empresa inativa (RN-PLA-07)
`plataforma.tenant_esta_ativo(p_tenant uuid) returns boolean` (SECURITY DEFINER, EXECUTE só ao `macuxi_worker`): status `ativo` e
não apagado. As políticas do worker passam a usá-la: `despacho_outbox` (`plataforma.evento`, SELECT) =
`nome like 'plataforma.tenant.%' or tenant_esta_ativo(tenant_id)`; `despacho_email` (`plataforma.email_saida`, SELECT) =
`tenant_esta_ativo(tenant_id)`. As consultas do despachante e do worker de e-mail **não mudam**: as linhas da empresa inativa
ficam esperando (sem contar tentativa) e voltam ao reativar. O agendador já parava (`tenants_ativos`, 0027).

### Funções do portal (SECURITY DEFINER; EXECUTE só ao `macuxi_portal`; o portal passa a 25 `sa_*`)
Todas: sessão inválida = 28000; admin do cliente = 42501; o código do contrato vai no `hint` do erro.

| Função | Retorno | Erros |
|---|---|---|
| `sa_inativar_tenant(p_sid uuid, p_tenant uuid, p_motivo text)` | `SituacaoEmpresaResposta` (`resultado` `alterado` \| `sem_mudanca`); grava status, data e motivo (`p_motivo` opcional: null = sem motivo), auditoria `tenant.inativado` e o evento `plataforma.tenant.inativado@1` na outbox, na mesma transação | 22023 (motivo fora da lista); P0002 `TENANT_NAO_ENCONTRADO`; 55000 `EXCLUSAO_EM_ANDAMENTO` |
| `sa_reativar_tenant(p_sid uuid, p_tenant uuid)` | idem; auditoria `tenant.reativado`, evento `plataforma.tenant.reativado@1`; o backup em andamento deixa de ser consistente | P0002; 55000 `EXCLUSAO_EM_ANDAMENTO` |
| `sa_pedir_backup(p_sid uuid, p_tenant uuid, p_id uuid)` | `BackupEmpresa` (o mesmo id devolve o mesmo); auditoria `tenant.backup_pedido` | P0002; 55000 `EXCLUSAO_EM_ANDAMENTO` / `BACKUP_EM_ANDAMENTO`; 23505 (id de backup de outra empresa) |
| `sa_listar_backups(p_sid uuid, p_tenant uuid, p_backup uuid)` | `{ itens: BackupEmpresa[] }` (até 20, do mais novo; `p_backup` = só aquele; vale para a empresa excluída) | P0002 |
| `sa_pedir_exclusao(p_sid uuid, p_tenant uuid, p_id uuid, p_backup uuid, p_codigo text)` | `ExclusaoEmpresa` (`em_andamento`/`banco`; o mesmo id devolve a mesma); auditoria `tenant.exclusao_pedida` | P0002; 55000 `EXCLUSAO_EM_ANDAMENTO`; 22023 `EXCLUSAO_EMPRESA_ATIVA`, `EXCLUSAO_SEM_BACKUP`, `EXCLUSAO_BACKUP_ANTES_DA_INATIVACAO`, `EXCLUSAO_BACKUP_VENCIDO`, `EXCLUSAO_CODIGO_NAO_CONFERE`; 23505 (id de outra empresa) |
| `sa_ler_exclusao(p_sid uuid, p_tenant uuid)` | `ExclusaoEmpresa` mais recente ou null (também depois de concluída) | — |
| `sa_reautenticar(p_sid uuid)` | table `(super_admin_id, email, senha_hash)` do super-admin da sessão (a API confere a senha e conta a falha em `sa_tentativa_falha`); auditoria `sa.reautenticar` | — (0 linhas = conta inativa) |
| `sa_acoes_das_empresas(p_sid uuid)` | `{ itens: [{ tenant_id, inativada_em, motivo_inativacao, ultimo_backup, exclusao, exclusao_bloqueada }] }` das empresas vivas; a API junta no item da `sa_listar_tenants` pelo `tenant_id` (sem ele, é o `AcoesDaEmpresaSchema`) | — |

A senha do super-admin é conferida pela API **antes** da `sa_pedir_exclusao`, que revalida a `conferirExclusao` na transação
(pela interna `exclusao_bloqueada`).

### Funções do worker (SECURITY DEFINER; EXECUTE só ao `macuxi_worker`; o tenant sai sempre da linha do job)
- `pegar_backup() returns jsonb` — próximo backup em andamento sem concessão viva (`for update skip locked`), marca `iniciado_em`
  na 1ª vez e dá 10 min; devolve `BackupEmpresa` + `codigo` + `partes` (tabelas já confirmadas). null = fila vazia.
- `tabelas_do_backup(p_backup uuid) returns table (ordem, tabela, chave text[], adiar text[])` — a `ordem_do_backup` (só com o
  backup em andamento: 55000; inexistente: P0002).
- `exportar_backup_pagina(p_backup uuid, p_tabela text, p_depois jsonb, p_limite integer) returns table (chave jsonb, linha
  jsonb)` — página por keyset da chave primária (`p_depois` = a `chave` da última linha; null = do começo; `p_limite` 1..5000),
  só do tenant da linha do backup; `linha` = `to_jsonb` da linha inteira (a restauração volta com `jsonb_populate_record`).
  Tabela fora da lista = 22023.
- `registrar_parte_backup(p_backup uuid, p_tabela text, p_linhas bigint, p_bytes bigint, p_sha256 text) returns jsonb` —
  idempotente por (backup, tabela); progresso até 90%.
- `fechar_backup(p_backup uuid, p_resultado jsonb) returns jsonb` — `{ situacao: 'pronto', tamanho_bytes, arquivos }` (exige
  todas as partes: 55000 `BACKUP_INCOMPLETO`) ou `{ situacao: 'falhou', erro_codigo }`; reconfere a consistência; expira em 30
  dias; evento `backup_concluido@1` ou `backup_falhou@1` na outbox do tenant; auditoria `tenant.backup_concluido`/`_falhou`.
- `backups_vencidos(p_limite integer)` (1..500) e `marcar_backup_apagado(p_backup uuid)` — retenção (RN-PLA-11): falho vencido;
  pronto vencido com outro pronto mais novo da empresa, ou da empresa excluída (o pronto mais novo de quem existe sempre fica).
- `pegar_exclusao() returns jsonb` — próxima exclusão em andamento sem concessão viva.
- `executar_exclusao(p_exclusao uuid) returns jsonb` — etapa `banco`, na transação do worker: reconfere, `encerrado`,
  `excluir_tenant` (0032), outros backups em andamento da empresa = `falhou`/`EMPRESA_EXCLUIDA`, backup da exclusão guardado 90
  dias, `empresa_excluida`, auditoria `tenant.excluido` (detalhes = payload de `plataforma.tenant.excluido@1`), etapa
  `arquivos`. Conferência que não passa = exclusão `falhou` com o código (empresa intacta). Etapa já passada = devolve.
- `fechar_exclusao(p_exclusao uuid, p_resultado jsonb) returns jsonb` — `{ situacao: 'concluida', arquivos_apagados }` (só na
  etapa `arquivos`) ou `{ situacao: 'falhou', erro_codigo }` (só na etapa `banco`; na `arquivos`, 55000: tente de novo).

### Internas (SECURITY INVOKER; só o dono)
`instante_iso(timestamptz)`, `backup_empresa_json(backup_empresa)`, `exclusao_empresa_json(exclusao_empresa)`,
`exclusao_bloqueada(p_tenant, p_backup, p_exclusao)` (a `conferirExclusao` do SDK, mesma ordem) e `ordem_do_backup()`:
`plataforma.tenant` (ordem 1) e toda tabela com `tenant_id`, mães antes das filhas; ciclo de FK (hoje `core.usuario` ↔
`core.equipe`) e autorreferência anulável viram colunas `adiar` (a restauração grava nulo e completa no fim).

Pendente (fora da 0072): a restauração (`db/backup/restaurar-empresa.mjs`, com o leitor do manifesto, e o ensaio backup →
exclusão → restauração no CI). Os gatilhos de semeadura (`tenant_semear_*` na inserção do tenant, `usuario_perfil_principal`,
`resposta_normalizar`) gravam linhas que o backup também traz: a restauração precisa desligá-los (`alter table ... disable
trigger user` pelo dono, numa janela) ou apagar o semeado antes de cada tabela. Exceção: `core.usuario_codigo_fdv_contador` e os
gatilhos de Código FDV de `core.usuario` ficam ligados (0080; restauração em qualquer ordem, ver core.md). O teste desta migração prova a outra metade: o
que a exclusão apaga é, tabela a tabela, o que o backup exportou.

Consultas da API e do worker (referência):
```sql
select plataforma.sa_inativar_tenant($1, $2, $3) as r;            -- POST …/inativar
select plataforma.sa_reativar_tenant($1, $2) as r;                -- POST …/reativar
select plataforma.sa_pedir_backup($1, $2, $3) as r;               -- POST …/backups (202)
select plataforma.sa_listar_backups($1, $2, $3) as r;             -- GET …/backups[/:backup_id]
select * from plataforma.sa_reautenticar($1);                     -- POST …/exclusao, antes da sa_pedir_exclusao
select plataforma.sa_pedir_exclusao($1, $2, $3, $4, $5) as r;     -- POST …/exclusao (202)
select plataforma.sa_ler_exclusao($1, $2) as r;                   -- GET …/exclusao (null = 404)
select plataforma.sa_acoes_das_empresas($1) as r;                 -- GET /v1/plataforma/empresas (bloco acoes)
select plataforma.pegar_backup() as r;                            -- worker (macuxi_worker)
select * from plataforma.exportar_backup_pagina($1, $2, $3::jsonb, 5000);
```

### 0074 — pacote pronto da primeira carga (`0074_plataforma_sync_pacote`; ADR 0054)
`plataforma.sync_pacote` e `plataforma.sync_pacote_pedido`: dicionário completo, RLS, grants, índices e ciclo de vida em
[sync-pacote.md](sync-pacote.md).

## 0079 — arquivos do lote de fotos e trabalho sob demanda (`0079_catalogo_foto_lote`; T-0174, ADR 0054)
Mesma migração das tabelas do lote ([catalogo.md](catalogo.md), "0079"). Teste: `db/testes/foto-lote.db.test.ts`.

**`arquivo`**: `arquivo_tipo_valido` = `image/jpeg` \| `image/png` \| `image/webp` \| `application/zip`
(`TIPOS_ARQUIVO_BANCO` em `db/esquema/plataforma.ts`; o `TIPOS_ARQUIVO` do SDK fica contido nele). `arquivo_tamanho_faixa` por
tipo: imagem 1..8388608 (8 MiB), ZIP 1..524288000 (500 MiB). A rota antiga de foto continua com 2 MB no código (teto por
categoria da API). `arquivo_recebido_completo`: o ZIP fica `recebido` no `concluir` **sem** `sha256` (o SHA é calculado no
trabalho e fica em `catalogo.foto_lote.sha256`); a `chave_armazenamento` do ZIP é a da parte 1 (`<id>.p001.zip`); a imagem
recebida continua exigindo o `sha256`. Volta: o down devolve os CHECKs da 0005 e **falha (55000)** se houver PNG, WEBP, ZIP ou arquivo acima de 2 MiB.

### trabalho — trabalho sob demanda de um módulo. Fora do sync
Disparado por evento da outbox (o consumidor da plataforma grava em `comTenant`, `macuxi_app`), executado em fatias pelo laço
do worker. Um vivo por `(tenant_id, modulo, nome, alvo_id)` (`trabalho_alvo_uk`): grave com `insert ... on conflict do nothing`.

| Coluna | Tipo | Regra |
|---|---|---|
| modulo | text not null | `^[a-z][a-z0-9-]*$` |
| nome | text not null | `^[a-z][a-z0-9_]*$`, ≤ 100 (ex.: `processar_foto_lote`) |
| alvo_id | uuid not null | entidade do módulo (ex.: `catalogo.foto_lote.id`); sem FK |
| evento_id | uuid | evento da outbox que disparou; sem FK (a outbox tem retenção) |
| situacao | text not null default `pendente` | `pendente` \| `em_execucao` \| `concluido` \| `falhou` |
| tentativas, fatias | integer not null default 0 | >= 0 |
| proxima_em | timestamptz not null default now() | quando pode rodar de novo |
| travado_ate, travado_por | timestamptz, text | juntos (`trabalho_trava_par`); obrigatórios no `em_execucao`; processo 1..200 |
| ultimo_erro | text | **só código** `^[A-Za-z0-9_.:-]{1,100}$` (nunca mensagem nem dado pessoal) |
| concluido_em | timestamptz | só e sempre no `concluido` e no `falhou` |

Índice `trabalho_fila_ix (situacao, proxima_em)`. **macuxi_app**: select e insert no próprio tenant (RLS), sem UPDATE/DELETE.
**macuxi_worker**: nenhum privilégio de tabela; só EXECUTE nas funções (SECURITY DEFINER, `search_path = pg_catalog, plataforma,
pg_temp`, só tenants `ativo` e vivos):

| Função | O que faz |
|---|---|
| `trabalho_reservar(p_processo text, p_trava_s integer)` → `table(id, tenant_id, modulo, nome, alvo_id, tentativas, fatias)` | 0 ou 1 linha: o vencido mais antigo (`pendente` com `proxima_em <= now()` ou `em_execucao` com trava vencida), `for update skip locked`; marca `em_execucao`, `travado_ate = now() + p_trava_s`, `travado_por`. p_processo 1..200, p_trava_s 1..3600 (senão 22023) |
| `trabalho_devolver(p_id uuid, p_processo text, p_resultado text, p_erro text, p_espera_s integer)` → boolean | só com a trava do processo (false = perdeu a trava; nada muda). `continua` → `pendente` agora, `fatias + 1`; `concluido` → `concluido`, `fatias + 1`; `adiar` → `pendente` daqui a `p_espera_s`, sem contar tentativa (licença inativa); `erro` (com `p_erro`) → `tentativas + 1`, `ultimo_erro`, `pendente` daqui a `p_espera_s` ou, com `p_espera_s` nulo, `falhou` (definitivo). Solta a trava |
| `trabalho_renovar(p_id uuid, p_processo text, p_trava_s integer)` → boolean | estende a trava entre os itens; false = não é mais deste processo |
