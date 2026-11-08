# Dicionário de dados — schema `core`

Migrações `db/migrations/0002_core.up.sql`, `0003_plataforma_worker` (índice da carteira), `0004_core_sessao` (sessão, aparelho, tentativas) e `0006_core_lote_a` (Sprint 1, no fim deste arquivo); volta: `.down.sql` de cada uma. Drizzle: `modules/core/db/nuvem.ts` (uso interno do Core).
Campos comuns e RLS como em [plataforma.md](plataforma.md). Toda FK entre tabelas do tenant é composta
`(tenant_id, x_id) → (tenant_id, id)`; toda tabela sincronizada tem índice de sync `(tenant_id, updated_at, id)` (`sessao` e `dispositivo` ficam fora do sync) e
`external_id` único por tenant (quando preenchido).

## equipe — árvore de equipes (RN-CORE-04)
| Coluna | Tipo | Regra |
|---|---|---|
| nome | text not null | |
| equipe_pai_id | uuid | FK composta para `equipe`; diferente do próprio id |
| responsavel_id | uuid | FK composta para `usuario` (supervisor da equipe; gerente no nó de cima) |
| ativo | boolean not null | |

Índice `equipe_responsavel_ix (tenant_id, responsavel_id)` (0004): equipes de que o usuário é responsável.
Escopo: supervisor vê a carteira da equipe de que é responsável; gerente vê as equipes abaixo do seu nó (CTE recursiva por `equipe_pai_id`).

## usuario
| Coluna | Tipo | Regra |
|---|---|---|
| nome, nome_curto | text | |
| email | text not null | único **por tenant** em minúsculas `(tenant_id, lower(email))` (Q3); formato validado |
| perfil | text not null | `admin, analista, assistente, supervisor, gerente, vendedor, promotor`. Desde a 0041 (ADR 0033): o perfil **principal** (vai no token); os perfis do usuário (1+, multiperfil) ficam em `plataforma.usuario_perfil` e um deles sempre tem esta base (gatilho `usuario_perfil_principal`, conferência no COMMIT; ver [plataforma.md](plataforma.md) "Perfis de acesso") |
| equipe_id | uuid | FK composta para `equipe` |
| senha_hash | text | só argon2id em PHC (`$argon2id$...`, check) |
| ativo, bloqueado_em, ultimo_login_em | | `bloqueado_em` = bloqueio MANUAL do admin (RF-CORE-01) |
| tentativas_falhas | smallint not null default 0 | (0004) falhas de senha seguidas, `>= 0`; 5 falhas => `bloqueio_ate` = agora + 15 min; login certo zera (regra no domain do Core) |
| bloqueio_ate | timestamptz | (0004) bloqueio TEMPORÁRIO por tentativas |
| telefone | text | (0036) telefone do CSV da Equipe; null ou 1..30 caracteres (CHECK `usuario_telefone_preenchido`; formato no domain do Core). Dado pessoal: a anonimização apaga. Fora do pull |
| trocar_senha | boolean not null default false | (0040, RN-CORE-34) a senha atual é temporária: usada, leva à troca obrigatória ("Crie sua senha") |
| senha_expira_em | timestamptz | (0040) validade da senha atual quando temporária (72 h); nula = não vence. CHECK `usuario_senha_expira_so_trocar`: só com `trocar_senha` |
| senha_temporaria_hash, senha_temporaria_expira_em, senha_temporaria_criada_em | text, timestamptz, timestamptz | (0040) a senha do "Esqueci a senha", **paralela** à atual (P6), argon2id (CHECK); as três juntas (CHECK `usuario_senha_temporaria_completa`) |
| sessao_versao | integer not null default 0 | (0040) sobe a cada troca, redefinição e desativação; o token (claim `sv`) e a sessão do portal só valem com a versão atual. `>= 0` |

Login: código da empresa → `plataforma.tenant_por_codigo` → transação com o tenant → `where lower(email) = lower($1)`.

## produto — cadastro base (ADR-0005)
| Coluna | Tipo | Regra |
|---|---|---|
| sku | text not null | único por tenant |
| ean | text | 8 a 14 dígitos |
| nome, marca, categoria | text | |
| unidade | text not null | padrão `UN` (`PC`, `JG`, ...) |
| ativo | boolean not null | |

Preço, estoque, conteúdo, mídia, sinônimos e embeddings ficam no schema `catalogo` (por contrato, nunca FK cruzada de leitura).

## cliente
| Coluna | Tipo | Regra |
|---|---|---|
| documento | text | CPF (11) ou CNPJ (14) só dígitos; único por tenant |
| razao_social | text not null | |
| nome_fantasia, segmento, telefone, email | text | |
| logradouro, numero, bairro, cidade, uf, cep | text | `uf` com 2 letras maiúsculas |
| latitude, longitude | numeric(9,6) | opcionais (RN-CORE-10: 1º check-in sugere coordenada) |
| ativo | boolean not null | |

## carteira — cliente x usuário (RN-CORE-04)
| Coluna | Tipo | Regra |
|---|---|---|
| cliente_id | uuid not null | FK composta para `cliente` |
| usuario_id | uuid not null | FK composta para `usuario` |
| papel | text not null | `vendedor` \| `promotor` |
| inicio, fim | date | `fim >= inicio` |

Índices: único `(tenant_id, cliente_id, usuario_id, papel)` ativo; `(tenant_id, usuario_id)` (escopo do vendedor/promotor); `(tenant_id, cliente_id)`;
`carteira_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)` **sem** filtro de `deleted_at` (migração 0003): pull
da carteira por usuário inclusive removidas (Q6 de [desempenho-sync.md](desempenho-sync.md)).

## dispositivo — aparelho do usuário (0004; RF-CORE-01 bloqueio remoto). Fora do sync
| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid | gerado NO APARELHO; o login faz upsert `on conflict (id)` |
| usuario_id | uuid not null | FK composta para `usuario` |
| nome, plataforma | text | ex.: `Moto G`, `android` |
| ultimo_acesso_em | timestamptz | atualizado a cada login |
| bloqueado_em | timestamptz | bloqueio remoto: o login e o refresh recusam o aparelho para QUALQUER usuário do tenant (RN-CORE-15, consulta só por `id`; o RLS isola o tenant) |

Índices: PK `id`; `dispositivo_usuario_ix (tenant_id, usuario_id)`; único `(tenant_id, id)` (alvo da FK de `sessao`).
Volume: 1-2 por usuário.

## sessao — refresh token rotativo (0004; doc 04 "Sessão"). Fora do sync
| Coluna | Tipo | Regra |
|---|---|---|
| usuario_id | uuid not null | FK composta para `usuario` |
| familia_id | uuid not null | todos os refresh descendentes de um login; reuso de refresh já usado revoga a família |
| token_hash | text not null | sha256 **hex** do segredo (check `^[0-9a-f]{64}$`); único POR tenant. O cliente recebe `<tenant_id>.<segredo>` |
| dispositivo_id | uuid | FK composta para `dispositivo` (opcional) |
| expira_em | timestamptz not null | 30 dias |
| usado_em | timestamptz | rotação: marca usado e cria o próximo da família |
| revogado_em | timestamptz | logout, reuso (roubo) ou bloqueio remoto |

Índices: `sessao_token_uk (tenant_id, token_hash)` único; `sessao_familia_ix (tenant_id, familia_id)`;
`sessao_usuario_ativa_ix (tenant_id, usuario_id) where revogado_em is null` (revogar tudo do usuário);
`sessao_expira_ix (tenant_id, expira_em)` (limpeza). Volume: ~1 linha por login/refresh por aparelho; limpeza por expiração
(job futuro). EXPLAIN com 6 mil sessões em `db/testes/sessao.test.ts`: todas as consultas usam o índice com o predicado
da RLS (`tenant_id = tenant_atual()`, função SQL inline) na `Index Cond`.

Upsert do aparelho (`on conflict (id) do update ... where core.dispositivo.usuario_id = excluded.usuario_id`): se o id
já é de OUTRO usuário (mesmo tenant) ou de outro tenant, o `where` descarta (0 linhas, sem erro) e a linha alheia não muda.

## Volume e consultas principais (para EXPLAIN quando houver dados)
- Sync pull por entidade: `where tenant_id = $t and (updated_at, id) > ($cursor_ts, $cursor_id) order by updated_at, id limit 1000` — índice de sync.
- Carteira do vendedor: `carteira where tenant_id = $t and usuario_id = $u and deleted_at is null` — `carteira_usuario_ix`.
- Volume alvo por tenant: 500 clientes por vendedor, 20 mil SKUs (doc 04).
- Login/refresh (`modules/core/api/repositorio.ts`): `usuario where lower(email) = lower($1)` (`usuario_email_uk`); `sessao where token_hash = $1` (`sessao_token_uk`); revogar família (`sessao_familia_ix`); aparelho por `id` (PK).

---

# Sprint 1 — lote A (migração `0006_core_lote_a`; desenho T-0016 §2 e §7)
Volta: `0006_core_lote_a.down.sql` (apaga as tabelas abaixo, as colunas novas de `carteira`/`dispositivo` e os
parâmetros semeados). Drizzle: `modules/core/db/nuvem.ts`. Todas com campos comuns, RLS forçado (`isolamento_tenant`),
gatilho de `updated_at`, índice de sync `(tenant_id, updated_at, id)`, `external_id` único por tenant quando preenchido e
FKs compostas `(tenant_id, x_id)`. Dinheiro em centavos `bigint` (no `pg` cru o int8 chega como **string**: converta no
provedor). "Vivo" = `deleted_at is null`.

## Alterações
| Tabela | Coluna | Regra |
|---|---|---|
| carteira | frequencia_semanas smallint | `1, 2, 4` ou nulo (agenda por frequência, RF-CORE-05) |
| carteira | dia_semana smallint | 1 (segunda) a 7 (domingo, ISO) ou nulo |
| dispositivo | push_token, push_plataforma, push_atualizado_em | token Expo (T-0019); `push_plataforma in ('android')`; token e plataforma juntos. Fora do sync |

## cliente_contato — contatos do cliente (RF-CORE-04). Pull por carteira
`cliente_id` (FK) · `nome` not null · `cargo`, `telefone`, `whatsapp`, `email` · `principal` boolean.
Índices: `(tenant_id, cliente_id)`; único parcial `cliente_contato_principal_uk (tenant_id, cliente_id) where principal and vivo`.

## cliente_financeiro — um vivo por cliente. Pull por carteira
`cliente_id` (FK) · `limite_cents` ≥ 0 · `saldo_aberto_cents` ≥ 0 · `credito_disponivel_cents` (nulo = o domínio calcula
limite − saldo; pode ser negativo) · `bloqueado`, `motivo_bloqueio` · `atualizado_erp_em`.
Índice: único `cliente_financeiro_cliente_uk (tenant_id, cliente_id)` vivo.

## titulo — títulos a receber (dono: Core). Pull por carteira, janela: abertos + vencimento ≥ hoje − 90
`cliente_id` (FK) · `documento` not null · `parcela` · `emissao`, `vencimento` date · `valor_cents`, `saldo_cents` ≥ 0 ·
`situacao` `aberto | liquidado | cancelado` · `liquidado_em`.
Índices: `titulo_cliente_vencimento_ix (tenant_id, cliente_id, vencimento)`; parcial `titulo_abertos_ix` (mesmas colunas)
`where situacao = 'aberto' and vivo` (filtro "vencidos").

## historico_compra — consolidado mensal. Pull por carteira, janela: `ano_mes` ≥ 12 meses atrás
`cliente_id` (FK) · `ano_mes` text `AAAA-MM` (check) · `valor_cents` · `pedidos`, `itens` ≥ 0 · `ultima_compra_em` date ·
`origem` `erp | macuxi`. Índice: único `historico_compra_mes_uk (tenant_id, cliente_id, ano_mes)` vivo.

## motivo — não venda, cliente fechado, fora do raio. Pull do tenant
`tipo` `nao_venda | cliente_fechado | fora_do_raio` · `codigo` `^[a-z][a-z0-9_]*$` · `descricao` · `exige_foto` · `sistema` ·
`ativo` · `ordem`. Único `motivo_codigo_uk (tenant_id, tipo, codigo)` vivo; único `(tenant_id, id)` (alvo da FK da visita).
Checks: `cliente_fechado ⇒ exige_foto`; **motivo de sistema só pode ser `cliente_fechado` `loja_fechada`/`acesso_negado`,
com foto, ativo e vivo** (RN-CORE-14: não é removido, desativado nem muda de código — 23514; a API responde 422 antes).

**Padrões em todo tenant** (`core.semear_padroes(tenant)`: nos existentes pela migração, nos novos pelo gatilho
`tenant_semear_core` AFTER INSERT em `plataforma.tenant`; `on conflict do nothing`, não sobrescreve edição do tenant):

| tipo | codigo | sistema | exige_foto | ordem |
|---|---|---|---|---|
| cliente_fechado | loja_fechada (Loja fechada) | sim | sim | 1 |
| cliente_fechado | acesso_negado (Acesso negado) | sim | sim | 2 |
| nao_venda | estoque_alto, comprador_ausente, sem_limite_credito, preco_concorrente, outro (os `NO_ORDER_REASONS` da Fase M, sem "Loja fechada") | não (editáveis) | não | 1–4, 9 |

Id determinístico: `plataforma.uuid_de_chave('<tenant_id>:core.motivo:<tipo>:<codigo>')` = `idMotivoPadrao(tenant, codigo)`
de `@macuxi/db/teste` (fixtures e testes referenciam sem consultar). A mesma função semeia em `plataforma.parametro`
(módulo `core`): `checkin.raio_m = 200` e `metas.base_apuracao = "aprovado"` ([plataforma.md](plataforma.md)).

## rota — rota do dia. Pull por usuários visíveis, janela `data ∈ [hoje − 40, hoje + 30]`
`usuario_id` (FK) · `data` date · `situacao` `planejada | publicada | cancelada` · `origem` `bko | frequencia | erp` · `regiao`, `observacao`.
Índices: único `rota_usuario_dia_uk (tenant_id, usuario_id, data)` vivo; `rota_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)`;
único `(tenant_id, id, usuario_id, data)` (alvo da FK da parada).

## rota_parada — cliente na rota. Pull por usuários visíveis (sem join)
`rota_id` · `usuario_id`, `data` (**desnormalizados**) · `cliente_id` (FK) · `sequencia` ≥ 1 · `janela_inicio`, `janela_fim`
`time` (fim > início; formatar `HH:MM` no provedor).
- FK `(tenant_id, rota_id, usuario_id, data) → rota (tenant_id, id, usuario_id, data) on update cascade`: a parada sempre tem o
  usuário e a data da rota (diferente = 23503) e acompanha a mudança da rota (o cascade também move o `updated_at` da parada).
- Sequência única por rota entre as vivas: `exclude ... where (deleted_at is null) deferrable initially deferred` — reordenar
  numa transação; repetição só falha no COMMIT (23P01). Não serve de alvo de `on conflict`.
- Únicos/índices: `rota_parada_cliente_uk (tenant_id, rota_id, cliente_id)` vivo; `rota_parada_usuario_sync_ix
  (tenant_id, usuario_id, updated_at, id)`; `(tenant_id, cliente_id)`.
- Substituir as paradas (PUT do BKO): marque `deleted_at` nas que saem (o pull leva a remoção; visita pode apontar para a parada).

## visita — check-in/checkout. Push e pull por usuários visíveis, janela `data_local ≥ hoje − 40`
| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid | UUID do aparelho (push idempotente: `on conflict (id) do nothing`) |
| usuario_id, cliente_id | uuid not null | FKs compostas |
| rota_parada_id | uuid | FK composta para `rota_parada` (nulo = visita extra) |
| data_local | date not null | dia do check-in no fuso do tenant |
| checkin_em | timestamptz not null | instante do aparelho |
| checkin_lat, checkin_lng | numeric(9,6) | par (os dois ou nenhum); `sem_gps ⇒` sem coordenada |
| checkin_precisao_m, distancia_m | integer ≥ 0 | |
| sem_gps, fora_do_raio, sugere_coordenada, extra | boolean not null | RN-CORE-13 / RN-CORE-10 |
| justificativa_fora_raio | text | **obrigatória (não vazia) se `fora_do_raio`** (RN-CORE-10) |
| checkout_id | uuid | UUID do comando de checkout; **único** `(tenant_id, checkout_id)` (idempotência) |
| checkout_em, checkout_lat, checkout_lng | | `checkout_em ≥ checkin_em`; par lat/lng |
| resultado | text | `atendido, pedido, sem_pedido, cliente_fechado, nao_finalizado` (`nao_finalizado` só servidor/auto) |
| fechada_por | text | `usuario`, `auto` |
| motivo_id | uuid | FK composta para `motivo` |
| motivo_texto | text | |
| pedido_id | uuid | **sem FK** (schema vendedor: fronteira) |
| foto_fachada_id | uuid | FK composta para `plataforma.arquivo`, **adiável** (inicialmente imediata): para gravar a visita antes do arquivo, `set constraints core.visita_foto_fachada_fk deferred` na transação |
| recebido_em | timestamptz not null | chegada ao servidor (default `now()`) |
| etapas_pendentes | smallint not null default 0 | contagem das etapas `pendente` vivas em `visita_etapa` (0026, T-0039 §2); ≥ 0; mantida pelo Core na mesma transação; vai no pull |

Checks: `checkout_em`, `resultado` e `fechada_por` andam juntos (os três nulos = aberta); **`resultado = 'cliente_fechado' ⇒
motivo_id e foto_fachada_id`** (RN-CORE-14). O tipo do motivo (cliente_fechado) é conferido pela API.
Índices: **único parcial `visita_aberta_uk (tenant_id, usuario_id) where checkout_em is null and deleted_at is null`** (RN-CORE-11,
trava final); `visita_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)`; `visita_cliente_ix (tenant_id, cliente_id, checkin_em desc)`
(últimas visitas do Cliente 360); `visita_usuario_dia_ix (tenant_id, usuario_id, data_local)` (rota do dia, cobertura);
parcial `visita_sugere_coordenada_ix (tenant_id, cliente_id, checkin_em desc) where sugere_coordenada and vivo` (BKO);
`(tenant_id, rota_parada_id)`.

## visita_etapa — etapas do checkout por módulo. Sem pull
`visita_id` (FK) · `modulo` · `etapa` · `situacao` `concluida | dispensada | pendente` · `referencia_id` · `registrada_em` ·
`rotulo` · `pendente_desde` · `resolvida_em` · `alertada_em` (as quatro e o `pendente` desde a 0026 — ver a seção 0026 abaixo).
Único **constraint** `visita_etapa_uk (tenant_id, visita_id, modulo, etapa)` (serve de alvo de `on conflict`).

## notificacao — caixa do usuário (RF-CORE-09). Pull só do próprio usuário
`usuario_id` (FK) · `tipo` `recado | sistema | pedido | treinamento | trade` · `titulo` 1–120 · `corpo` ≤ 1000 ·
`link` `^/m/[a-z0-9-]+` · `origem_modulo` · `origem_evento_id` · `envio_id` · `autor_id` (FK usuário) · `prioridade`
`normal | alta` · `lida_em` · `expira_em` · `push_enviado_em`.
Índices: `notificacao_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)`; parcial `notificacao_nao_lidas_ix
(tenant_id, usuario_id, created_at desc) where lida_em is null and vivo`; únicos parciais `notificacao_evento_uk
(tenant_id, usuario_id, origem_evento_id)` e `notificacao_envio_uk (tenant_id, usuario_id, envio_id)` quando preenchidos.
Recado do dia (0021, T-0073): `recado_do_dia` date · `recado_do_dia_por` (FK usuário) — ver a seção 0021 abaixo.
Subtipo (0030, T-0039): `subtipo` text null, formato `^[a-z_]{1,40}$` — ver a seção 0030 abaixo.

## meta — meta mensal (RN-CORE-20..22). Pull por usuários visíveis, `periodo ≥ mês anterior`
`usuario_id` (FK) · `periodo` `AAAA-MM` · `indicador` `venda_cents | positivacao | cobertura_pct | visitas` · `valor` bigint ≥ 0
(`cobertura_pct` em pontos-base, ≤ 10000). Índices: único `meta_uk (tenant_id, usuario_id, periodo, indicador)` vivo; `meta_usuario_sync_ix`.
`tipo` `pedido | faturamento` (0019, RN-CORE-21; padrão `pedido`, CHECK `meta_tipo_valido`): o realizado conta pedidos aprovados na
data de emissão ou o faturado na data do ERP. O `meta_uk` não inclui o tipo (uma meta por usuário, período e indicador).

## indicador_diario — read-model diário de vendas (lote B do §7, criado a pedido do gerente). Sem pull na Sprint 1
`usuario_id` (= vendedor, RN-CORE-21) · `data` (fuso do tenant) · `pedidos`, `vendido_cents`, `cancelado_cents` ≥ 0 ·
`clientes_positivados` integer null ≥ 0 (0021, T-0073 — ver a seção 0021 abaixo).
Único `indicador_diario_uk (tenant_id, usuario_id, data)` vivo. Alimentado pelo consumidor de `vendedor.pedido.*` quando
houver despachante (T-0021). `venda_apurada` (lote B) continua só especificada.

## Consultas principais da Sprint 1 (índice que atende)
- Pull por usuário (`rota`, `rota_parada`, `visita`, `notificacao`, `meta`): `where tenant_id = $t and usuario_id = any($u)
  and (updated_at, id) > ($c, $i) order by updated_at, id limit 1000` — `*_usuario_sync_ix`.
- Pull por carteira (`cliente_contato`, `cliente_financeiro`, `titulo`, `historico_compra`): `cliente_id = any($carteira)` +
  cursor — índices `(tenant_id, cliente_id, …)` e de sync.
- Check-in: aberta do usuário `where usuario_id = $u and checkout_em is null and deleted_at is null` — `visita_aberta_uk`.
- Checkout idempotente: `where checkout_id = $1` — `visita_checkout_uk`.
- Rota do dia: `rota where usuario_id and data` (`rota_usuario_dia_uk`); visitas do dia `visita_usuario_dia_ix`.
- Volume da Sprint 1 por vendedor (T-0016 §8): 2 mil títulos, 6 mil linhas de histórico, 1 mil paradas, 1,5 mil visitas
  (40 dias). EXPLAIN com volume: pendente, junto da medição P6 da T-0008.

## 0013 — cadastro mínimo do cliente, custo e preço do produto, unidades e endereços (`0013_catalogo_vendedor_prevenda`)
- **cliente** (novas): `inscricao_estadual` (IE ou ISENTO), `observacao` (texto do ERP; a linha automática
  "Cadastro incompleto: falta ..." é montada na exibição), `cadastro_incompleto` bool e `cadastro_campos_faltantes` text[]
  (CHECK: incompleto = lista não vazia; RN-CORE-16/17, RN-INT-14). Índice parcial dos incompletos.
- **produto** (novas, RN-CORE-18 e RN-VEN-11): `custo_cents` (**dado interno: nunca no pull do app nem no PDF do
  cliente**), `preco_venda_cents`, `desconto_maximo_pct` (nulo = parâmetro core `desconto_maximo_produto_pct`, padrão 15).
- **produto_unidade** (RN-VEN-15): produto_id (FK), unidade (`^[A-Z0-9]{1,6}$`), fator int > 0, ean, padrao (1 viva por
  produto), ativo. (tenant, produto, unidade) vivo. Pull escopo tenant.
- **cliente_endereco** (RF-CORE-12, RN-VEN-17): cliente_id (FK), tipo principal|entrega|cobranca, descricao,
  logradouro, numero, complemento, bairro, cidade, uf, cep (8 dígitos), latitude, longitude, principal (1 vivo por
  cliente), ativo. Índice (tenant, cliente). Pull escopo carteira.
- Base de demo: os 30 clientes com CNPJ fictício gerado (dígito verificador correto) e IE (um ISENTO); o **Atacado Boto
  Rosa sem CEP** (cadastro incompleto); endereço principal de todos e um de entrega em 5.

## 0018 — medidas do produto (`0018_medidas`; T-0063, RN-CORE-19, RF-CORE-14)
- **medida** (nova): `sigla` text (`^[A-Z]{1,4}$`, CHECK `medida_sigla_formato`), `descricao` text (não vazia,
  `medida_descricao_preenchida`), `ativo` bool (padrão true) + campos comuns. **Único TOTAL** `medida_sigla_uk (tenant_id,
  sigla)` (não parcial: é o alvo das FKs). Índice de sync `medida_sync_ix (tenant_id, updated_at, id)`, `medida_external_uk`
  (vivo), gatilho `medida_updated_at`, RLS forçado `isolamento_tenant`, grant **select, insert, update** ao `macuxi_app`
  (sem DELETE). Pull escopo tenant. Volume: ~10–30 por tenant.
  - **Não apaga em uso**: o gatilho `medida_em_uso` (BEFORE UPDATE) recusa `deleted_at` em medida usada por produto vivo
    (`unidade` ou `embalagem_medida`) ou por `produto_unidade` viva — SQLSTATE `23503`, constraint `medida_em_uso`. Troca de
    `sigla` em uso: a FK recusa (`23503`). DELETE físico: sem grant (e a FK recusaria). **Inativar** (`ativo = false`) e editar a
    descrição são livres. A API do Core decide se produto pode apontar para medida inativa (o banco só exige cadastrada).
  - **Lista inicial** em todo tenant: UN Unidade, CX Caixa, PCT Pacote, FD Fardo, LT Lata, BD Balde, TB Tubo, GL Galão,
    KG Quilograma, DZ Dúzia, DP Display (`MEDIDAS_INICIAIS` em `db/src/ids.ts`). Ids determinísticos
    `plataforma.uuid_de_chave('<tenant>:core.medida:<sigla>')` = `idMedida(tenant, sigla)`. Semeadura por
    `core.semear_medidas(tenant)` (comum, NÃO SECURITY DEFINER; liga `app.tenant_id` só durante a semeadura, como a 0006):
    nos tenants existentes na 0018 também as siglas já usadas em produto/produto_unidade (descrição = sigla); tenant novo pelo
    gatilho `tenant_semear_medidas` (AFTER INSERT em `plataforma.tenant`). `on conflict do nothing`: não sobrescreve edição.
- **produto** (0018): `unidade` (existente) = **sigla da medida da unidade**, FK `produto_medida_fk (tenant_id, unidade) →
  medida (tenant_id, sigla)`. Novas `embalagem_medida` text null (FK `produto_embalagem_medida_fk`) e `embalagem_quantidade`
  int null (unidades na embalagem): CHECKs `produto_embalagem_completa` (as duas ou nenhuma), `produto_embalagem_quantidade_faixa`
  (**2 a 9999**; o mesmo teto vale no domain do Core e no contrato da Integração — sem ele, valor acima do `integer` virava
  22003/500) e `produto_embalagem_diferente` (embalagem ≠ unidade). Índices `produto_medida_ix (tenant_id, unidade)` e
  `produto_embalagem_medida_ix` (parcial). Antes das FKs a 0018 normaliza `upper(btrim(unidade))`; sigla fora do formato
  **aborta** a migração (`23514`) com mensagem clara por linha: `tenant <codigo> (<id>): core.produto|core.produto_unidade
  '<sigla>'` e a dica de corrigir a unidade para 1 a 4 letras (nada é adivinhado). Item de pedido antigo NÃO aborta (ver
  [vendedor.md](vendedor.md) 0018).
- **produto_unidade** (0018): FK `produto_unidade_medida_fk (tenant_id, unidade) → medida (tenant_id, sigla)`; índice
  `produto_unidade_medida_ix`. (O CHECK antigo `^[A-Z0-9]{1,6}$` fica; a FK exige uma sigla cadastrada, logo `^[A-Z]{1,4}$`.)
- **Integração**: sigla desconhecida no produto / unidade de venda vinda do ERP agora é recusada pela FK (`23503`
  `produto_medida_fk` / `produto_unidade_medida_fk`): o Hub traduz em `referencia_ausente` (RN-CORE-19, RN-INT-04).
- Fora do banco (pendência): `catalogo.tabela_preco_item.unidade` (0013) **sem FK** para `core.medida` (outro schema; ADR
  0005/0012) — a API do Catálogo valida a sigla.
- Base de demo (`db/seeds/demo/medidas.ts`): ativas UN, CX, FD, LT e BD; PCT, TB, GL, KG, DZ e DP inativas (não ausentes: o
  banco semeia as 11 e medida não se apaga). Embalagem dos produtos = as caixas de embarque do demo.ts (CX c/ 4 a 24).
  Fixture dois-tenants: A tem a sigla própria PC (Peça, usada pelos produtos de A), B tem GF (Garrafa), além das 11.

## 0019 — notas do ERP e tipo da meta (`0019_core_nota_erp_meta_tipo`; T-0066 e T-0065, RN-CORE-21)
- **nota_erp** (nova, dono: Core; escrita só pelo consumidor de `integracao.nota.atualizado@1`): uma linha por nota de
  `faturamento` ou `devolucao` (CHECK `nota_erp_tipo_valido`). Colunas: `cliente_id` uuid (FK composta `nota_erp_cliente_fk
  (tenant_id, cliente_id) → cliente (tenant_id, id)`) · `tipo` · `numero` text (não vazio, `nota_erp_numero_preenchido`) ·
  `serie` text null · `emitida_em` timestamptz · `ano_mes` text `AAAA-MM` (`nota_erp_ano_mes_formato`; **calculado pelo
  consumidor no fuso do tenant** a partir de `emitida_em` — o banco só confere o formato) · `total_cents` bigint ≥ 0 ·
  `quantidade_itens` int ≥ 0 (padrão 0) · `pedido_uuid` uuid null (**retrato sem FK**: o pedido é do schema vendedor; ADR
  0005/0012) · `cancelada` bool (padrão false) + campos comuns. `external_id` **obrigatório** (chave da nota no ERP,
  `nota_erp_external_id_preenchido`).
  - Índices: único vivo `nota_erp_external_uk (tenant_id, external_id) where deleted_at is null` (idempotência: reentrega e
    nota alterada/cancelada fazem `insert ... on conflict (tenant_id, external_id) where deleted_at is null do update`);
    `nota_erp_cliente_mes_ix (tenant_id, cliente_id, ano_mes)` (recálculo do `historico_compra` do cliente no mês);
    `nota_erp_mes_ix (tenant_id, ano_mes)` (somas do mês). Único `(tenant_id, id)`. Gatilho `nota_erp_updated_at`.
  - RLS forçado `isolamento_tenant`; grant **select, insert, update** ao `macuxi_app` (sem DELETE: soft delete ou
    `cancelada = true`). **Fora do pull do app** (`TABELAS_FORA_DO_SYNC`; só o resumo `historico_compra` vai ao aparelho).
  - Recálculo (consulta principal): `select coalesce(sum(case tipo when 'faturamento' then total_cents else -total_cents end),
    0), ... from core.nota_erp where tenant_id = $t and cliente_id = $c and ano_mes = $m and not cancelada and deleted_at is
    null` — `nota_erp_cliente_mes_ix`. Volume: ~30 notas/ano por cliente.
  - Fixture dois-tenants: A/c1 com faturamento do mês (pedido p1 como retrato), faturamento cancelado e devolução do mês
    anterior; B/c1 com um faturamento. Demo: sem notas (vêm do ERP simulado).
- **meta.tipo** (nova coluna): `text not null default 'pedido'` + CHECK `meta_tipo_valido (tipo in ('pedido', 'faturamento'))`.
  Default constante: sem reescrita da tabela; as metas existentes (e as da demo) ficam `pedido`. Espelho Drizzle
  `meta.tipo` / `TIPOS_META_BANCO`. A entidade `meta` do sync leva o campo (contrato do Core).
- Caminho de volta: `0019_core_nota_erp_meta_tipo.down.sql` — **apaga** `nota_erp` com os dados (reconstruível pela
  reentrega do ERP; `historico_compra` não é tocado) e a coluna `meta.tipo` (metas de faturamento voltam a ser lidas como
  pedido).

## 0021 — recado do dia e positivação diária (`0021_core_recado_do_dia`; T-0073, desenho docs/desenho/T-0073.md §3.4 e §1.1)
- **notificacao.recado_do_dia** `date` null: dia **civil do tenant** (a API calcula com o fuso de `plataforma.tenant`) em que o
  recado aparece como "recado do dia" no Início do destinatário; null = não marcado. Só em recado: CHECK
  `notificacao_recado_do_dia_so_recado (recado_do_dia is null or tipo = 'recado')`.
- **notificacao.recado_do_dia_por** `uuid` null: quem marcou (supervisor ou gerente; permissão e escopo da equipe ficam na API
  do Core). Preenchido junto com a data: CHECK `notificacao_recado_do_dia_par ((recado_do_dia is null) = (recado_do_dia_por is
  null))`. Do próprio tenant: FK composta `notificacao_recado_do_dia_por_fk (tenant_id, recado_do_dia_por) → usuario (tenant_id, id)`.
- Índices: único parcial `notificacao_recado_do_dia_uk (tenant_id, usuario_id, recado_do_dia) where recado_do_dia is not null
  and deleted_at is null` (um recado do dia por pessoa por dia: para trocar, a API desmarca o anterior na mesma transação);
  `notificacao_envio_ix (tenant_id, envio_id) where envio_id is not null` (marcar/desmarcar todas as cópias de um envio; o
  `notificacao_envio_uk` começa por `usuario_id` e não serve a essa busca).
- Consultas principais: marcar por envio `update core.notificacao set recado_do_dia = $d, recado_do_dia_por = $u where
  tenant_id = $t and envio_id = $e and deleted_at is null` (`notificacao_envio_ix`); recado do dia da pessoa `where tenant_id
  = $t and usuario_id = $p and recado_do_dia = $hoje and deleted_at is null` (`notificacao_recado_do_dia_uk`). No aparelho, o
  pull de `notificacao` (índices de sync da 0006) leva as colunas novas. Volume: 1 marcação por pessoa por dia.
- RLS: a política `isolamento_tenant` (0006) já cobre as colunas; nenhuma política nova, grants iguais. Espelho Drizzle
  `notificacao.recado_do_dia` / `notificacao.recado_do_dia_por`. Sem seed: na demo, a marcação é feita ao vivo no BKO.
- **indicador_diario.clientes_positivados** `integer` null (pedido R-20261103-235827-gerente-projetos; desenho T-0073 §1.1):
  clientes **distintos** com pedido que conta para a meta (RN-CORE-21) do usuário naquele dia civil do tenant. É o fallback da
  positivação do Início quando o Vendedor está desligado (`vendedor.pedidos_da_meta@1` → `ConsultaIndisponivel`). null = não
  apurado (linhas anteriores à 0021 e consumidor que ainda não conta): **sem backfill**, sem padrão; o Core trata null como
  "sem fonte" (`positivacao = null`), não como zero. CHECK `indicador_diario_clientes_positivados_nao_negativo
  (clientes_positivados is null or clientes_positivados >= 0)`. Atenção: a contagem é distinta **no dia**; somar os dias dá
  um teto da positivação do mês (o mesmo cliente em dois dias conta duas vezes) — a deduplicação mensal fica no consumidor do
  Core. Consulta: `where tenant_id = $t and usuario_id = any($u) and data between $ini and $fim and deleted_at is null`
  (`indicador_diario_uk`). Volume: 1 linha por vendedor por dia com venda. Espelho Drizzle `indicadorDiario.clientes_positivados`.
- Caminho de volta: `0021_core_recado_do_dia.down.sql` — **apaga** as marcações (os recados continuam; o Início volta à
  frase padrão `inicio.recado_do_dia_padrao`) e a coluna `indicador_diario.clientes_positivados` (pedidos e valores ficam;
  o Início sem o Vendedor volta a `positivacao = null`).

## 0023 — positivação acumulada do mês (`0023_core_positivacao_mes`; opção 3 do dono do produto, 04/11, pendência do PR #84)
- **indicador_diario.clientes_positivados_ids** `uuid[]` null: **quais** clientes (`core.cliente.id` do próprio tenant) o
  usuário positivou naquele dia civil do tenant, sem repetição. null = não apurado (linhas anteriores à 0023 e consumidor que
  ainda não grava): **sem backfill**, sem padrão. Gravada junto com `clientes_positivados` (0021): CHECK
  `indicador_diario_clientes_positivados_ids_coerente` (lista de 1 dimensão, sem elemento nulo e `clientes_positivados =
  cardinality(lista)`). Cancelamento/devolução que tira o cliente do dia: o consumidor regrava a lista e a contagem do dia.
  Sem FK por elemento (array); a API só grava id de cliente do próprio tenant. Volume: dezenas de ids por linha (1 linha
  por vendedor por dia com venda). Espelho Drizzle `indicadorDiario.clientes_positivados_ids`. Fora do pull hoje (o
  `TABELAS_SYNC.indicador_diario` do Core lista as colunas).
- **core.positivacao_do_mes(p_usuario_ids uuid[], p_periodo text 'AAAA-MM', p_hoje date default null)** →
  `table (usuario_id uuid, ate_ontem integer, hoje integer, mes integer)`, uma linha por usuário pedido (ordem por
  `usuario_id`). Cada cliente conta **uma vez no mês**, no **primeiro** dia civil em que o usuário o positivou
  (RN-CORE-20): `ate_ontem` = clientes com primeiro dia < `p_hoje`; `hoje` = clientes com primeiro dia = `p_hoje` (os
  **novos** hoje, RN-CORE-26, igual ao `realizadoPartido` do domain do Core); `mes` = todos do mês. `p_hoje` nulo = hoje
  no fuso do tenant do contexto. **null nos três = sem fonte** (o usuário não tem nenhuma linha com lista até o fim do mês);
  com fonte e sem cliente no mês = 0 (mês novo zera). SECURITY INVOKER (RLS da tabela vale; sem contexto = tudo sem
  fonte), `search_path` fixo, EXECUTE só para o `macuxi_app`. Índice: `indicador_diario_uk (tenant_id, usuario_id, data)`
  vivo. Consumidor: `core.inicio@1` com o Vendedor desligado (campos `positivacao.ate_ontem` / `positivacao.hoje`).
- RLS: a política `isolamento_tenant` (0006) já cobre a coluna; nenhuma política nova, grants da tabela iguais.
- Caminho de volta: `0023_core_positivacao_mes.down.sql` — **apaga** a função e as listas (pedidos, valores e
  `clientes_positivados` do dia ficam; o Início sem o Vendedor volta a `positivacao = null`).

## 0025 — vendedor da nota do ERP (`0025_core_nota_erp_vendedor`; T-0080, RN-CORE-27, desenho docs/desenho/T-0080.md §2)
- **nota_erp.vendedor_external_id** `text` null: chave do vendedor no ERP como veio no `NotaPayload`
  (`integracao.nota.atualizado@1`, contrato sem mudança), **aparada pelo consumidor; vazio = null**. CHECK
  `nota_erp_vendedor_external_id_preenchido (vendedor_external_id is null or (btrim(vendedor_external_id) <> '' and
  char_length(vendedor_external_id) <= 200))` (200 = `EXTERNAL_ID_MAX` do contrato). Guarda a chave para completar o
  `usuario_id` quando o vendedor chegar depois da nota.
- **nota_erp.usuario_id** `uuid` null: vendedor da nota, usuário do **próprio tenant** — FK composta `nota_erp_usuario_fk
  (tenant_id, usuario_id) → usuario (tenant_id, id)`. null = nota sem vendedor ou vendedor ainda não recebido do ERP (não é
  erro: a nota continua valendo para o `historico_compra`; não conta para a positivação de ninguém, RN-CORE-27).
- Índices: `nota_erp_usuario_mes_ix (tenant_id, usuario_id, ano_mes) where deleted_at is null and usuario_id is not null`
  (positivação do mês no Início com o Vendedor desligado e o teste "existe fonte ERP no tenant"); parcial
  `nota_erp_vendedor_orfa_ix (tenant_id, vendedor_external_id) where usuario_id is null and deleted_at is null and
  vendedor_external_id is not null` (completar as órfãs; fica pequeno).
- Consultas principais: Início `select usuario_id, cliente_id, min(emitida_em) from core.nota_erp where deleted_at is null and
  usuario_id = any($u) and ano_mes = $m and tipo = 'faturamento' and not cancelada group by usuario_id, cliente_id`
  (`nota_erp_usuario_mes_ix`); consumidor de `integracao.vendedor.atualizado@1` `update core.nota_erp set usuario_id = $id
  where vendedor_external_id = $ext and usuario_id is null and deleted_at is null` (`nota_erp_vendedor_orfa_ix`;
  idempotente). Volume: ~30 notas/ano por cliente; órfãs só enquanto o vendedor não chega.
- **Sem backfill**: as notas gravadas antes da 0025 ficam com as duas colunas **nulas** (sem mexer em `updated_at`) até a
  próxima carga completa do ERP regravá-las pelo upsert. RLS: a política `isolamento_tenant` (0019) já cobre as colunas;
  nenhuma política nova, grants iguais; continua fora do pull do app. `indicador_diario` e `positivacao_do_mes` não mudam.
  Espelho Drizzle `notaErp.vendedor_external_id` / `notaErp.usuario_id`. Fixture e demo: sem notas com vendedor (a demo
  não tem notas; os testes de banco inserem as suas, `db/testes/nota-erp-vendedor.test.ts`).
- Caminho de volta: `0025_core_nota_erp_vendedor.down.sql` — **apaga** os índices e as duas colunas (a atribuição das notas
  se perde e volta na próxima carga do ERP depois de reaplicar; notas e `historico_compra` ficam; o Início sem o Vendedor
  volta à fonte `core.positivacao_do_mes`).

## 0026 — pendência de etapa do checkout (`0026_core_visita_etapa_pendente`; T-0039 §2, complemento da RN-CORE-12, desenho docs/desenho/T-0039.md §2.2)
- **visita_etapa.situacao** aceita `'pendente'` (CHECK `visita_etapa_situacao_valida`: `concluida | dispensada | pendente`;
  lista igual a `SITUACOES_VISITA_ETAPA` de `modules/core/contracts/etapas-pendencia.ts`, conferida no teste). `pendente` =
  etapa obrigatória de **outro módulo** (consulta `<modulo>.etapas_checkout@1`) não concluída no servidor quando o checkout
  chegou: o checkout é aceito. A baixa troca para `concluida`. Cliente fechado continua `dispensada` (RN-CORE-14).
- Colunas novas, todas `null` (sem backfill): **rotulo** `text` (texto da consulta, para BKO e notificação; CHECK
  `visita_etapa_rotulo_preenchido`: null ou não vazio, até 120 = `EtapaCheckoutSchema.rotulo`); **pendente_desde**
  `timestamptz` (instante do servidor no checkout; obrigatório em `pendente`, CHECK `visita_etapa_pendente_tem_desde`;
  continua preenchido depois da baixa); **resolvida_em** `timestamptz` (baixa pelo evento `pesquisa.resposta.registrada@1`
  com reconsulta; só fora de `pendente` e com `pendente_desde`, CHECK `visita_etapa_resolvida_coerente`); **alertada_em**
  `timestamptz` (job do alerta, uma vez por pendência; só com `pendente_desde`, CHECK `visita_etapa_alertada_coerente`).
- **visita.etapas_pendentes** `smallint not null default 0` (CHECK `visita_etapas_pendentes_nao_negativa`): contagem das linhas
  `pendente` vivas da visita, **mantida pelo Core** na mesma transação que mexe em `visita_etapa` (o banco não recalcula). Vai
  no pull da visita; `visita_etapa` continua sem pull.
- Índices: parcial `visita_etapa_pendente_ix (tenant_id, pendente_desde) where situacao = 'pendente' and deleted_at is null`
  (varredura do alerta por tenant e idade; lista de pendências abertas; fica pequeno); parcial `visita_etapas_pendentes_ix
  (tenant_id, checkin_em desc) where etapas_pendentes > 0 and deleted_at is null` (filtro "Com etapa pendente" do BKO). A
  baixa por visita usa o único `visita_etapa_uk`.
- Consultas principais: checkout `insert … on conflict on constraint visita_etapa_uk do update … where
  core.visita_etapa.situacao <> 'concluida'` (nunca rebaixa) + `update core.visita set etapas_pendentes = (select count(*) …
  situacao = 'pendente' and vivo)`; baixa `update core.visita_etapa set situacao = 'concluida', resolvida_em, referencia_id
  where visita_id and modulo and etapa and situacao = 'pendente'` (idempotente); alerta `select … where tenant_id = $t and
  situacao = 'pendente' and deleted_at is null and pendente_desde < $limite and alertada_em is null`
  (`visita_etapa_pendente_ix`); BKO `select … from core.visita where tenant_id = $t and etapas_pendentes > 0 and vivo order by
  checkin_em desc` (`visita_etapas_pendentes_ix`). Volume: no máximo poucas pendências por visita, só enquanto a resposta
  não chega.
- **Parâmetro do prazo**: `plataforma.parametro` (módulo `core`, chave `checkout_pendencia_alerta_h`, inteiro 1..168 horas).
  **Sem linha semeada**: ausente = padrão **24** (`CHECKOUT_PENDENCIA_ALERTA_H_PADRAO` do contrato do Core), mesma convenção de
  `inicio.parado_min` (0021). O BKO grava a linha quando o admin muda; nada novo no banco (tabela, único e RLS da 0001).
- RLS: as políticas `isolamento_tenant` (0006) das duas tabelas cobrem as colunas; nenhuma política nova, grants iguais. A FK
  `visita_etapa_visita_fk (tenant_id, visita_id)` prende a etapa à visita do próprio tenant. Espelho Drizzle
  `visita.etapas_pendentes`, `visitaEtapa.{rotulo, pendente_desde, resolvida_em, alertada_em}` e
  `SITUACOES_VISITA_ETAPA_BANCO`. Fixture e demo sem pendências (os testes inserem as suas,
  `db/testes/visita-etapa-pendente.test.ts`). Aplicar no ambiente só quando o gerente liberar a §2 da T-0039.
- Caminho de volta: `0026_core_visita_etapa_pendente.down.sql` — **apaga** as linhas `pendente` de `visita_etapa` (a visita
  continua concluída, sem a marca), as quatro colunas, `visita.etapas_pendentes` e os dois índices; volta o CHECK
  `concluida | dispensada`. Linhas `checkout_pendencia_alerta_h` do BKO ficam, sem efeito.

## 0028 — plano de RV (`0028_core_plano_rv`; T-0082, RN-CORE-29/30, desenho docs/desenho/T-0082.md §5)
## plano_rv — plano de remuneração variável do tenant, versionado por mês de início. Sem pull (fora de `TABELAS_SYNC`)
| Coluna | Tipo | Regra |
|---|---|---|
| comuns da regra 5 | | `id`, `tenant_id` (FK `plataforma.tenant`), `created_at`, `updated_at` (gatilho `plano_rv_updated_at`), `deleted_at`, `external_id` |
| nome | `text not null` | 1..80, não vazio (CHECK `plano_rv_nome_preenchido`) |
| vigencia_inicio | `text not null` | `AAAA-MM` (CHECK `plano_rv_vigencia_formato`, o mesmo de `core.meta.periodo`). Vale até o mês anterior ao próximo plano vivo |
| perfis | `text[] not null` | não vazio, 1 dimensão, sem nulo, ⊆ {`vendedor`, `promotor`} (CHECK `plano_rv_perfis_validos`; Drizzle `PERFIS_PLANO_RV_BANCO`) |
| valor_maximo_cents | `bigint not null` | > 0, centavos (CHECK `plano_rv_valor_maximo_positivo`) |
| regras | `jsonb not null` | array JSON (CHECK `plano_rv_regras_array`); cada item `{ indicador, peso_pct, gatilho, faixas: [{ de_pct, modo, pagamento_pct }] }` = `RegraRvSchema` de `modules/core/contracts/plano-rv.ts`. Pesos e faixas: `validarPlanoRv` (domain) e a API, não o banco |
| atualizado_por | `uuid null` | quem gravou a versão (analista/admin); FK composta `plano_rv_atualizado_por_fk (tenant_id, atualizado_por) → core.usuario`; null = carga (seed) |
- Índices: único parcial `plano_rv_vigencia_uk (tenant_id, vigencia_inicio) where deleted_at is null` (um plano vivo por mês de
  início; o soft delete libera o mês); `plano_rv_sync_ix (tenant_id, updated_at, id)` (regra; sem pull nesta tarefa);
  `plano_rv_external_uk (tenant_id, external_id)` parcial; `plano_rv_tenant_id_uk unique (tenant_id, id)` para FK composta futura.
- Regras que ficam na API (não no banco): plano que já valeu para mês fechado não muda (RN-CORE-30, depende do fechamento da
  RN-CORE-21); exclusão = soft delete; edição na auditoria com antes/depois (RN-AUD-01). RV é calculada na consulta (nada gravado).
- Consultas principais: `select … from core.plano_rv where tenant_id = $t and deleted_at is null order by vigencia_inicio`
  (vigente + versões; poucas linhas por tenant, `plano_rv_vigencia_uk`); upsert do PUT por `id` (UUID do cliente) dentro do
  contexto do tenant. Volume: poucas versões por ano por tenant.
- RLS: enable + force + `isolamento_tenant`; `macuxi_app` com select/insert/update/delete; `macuxi_worker` sem acesso.
- Fixture dois-tenants: A com um plano vivo do mês da fixture (vendedor e promotor, autor analista) + uma versão apagada do
  mesmo mês; B com um plano sem autor (grupo de UUID `0x39`). Demo (`db/seeds/demo/plano-rv.ts`): plano do vendedor desde o
  mês do primeiro seed (o mês não anda nas recargas), R$ 2.000,00, venda 50% / positivação 30% / visitas 20% com faixas
  0: zero · 80: proporcional · 100: fixo 100 · 110: fixo 120, cobertura como gatilho; banco sem a 0028 = o seed não grava.
- Caminho de volta: `0028_core_plano_rv.down.sql` (APAGA a tabela e os planos). Teste: `db/testes/plano-rv.test.ts`.

## 0030 — subtipo da notificação (`0030_core_notificacao_subtipo`; T-0039 §2.3, pedido R-20261105-071918-modulo-core)
- **notificacao.subtipo** `text` null, sem padrão: marcador **estável** dentro do `tipo` (a categoria larga da caixa), para o
  app reconhecer a notificação sem depender do título. CHECK `notificacao_subtipo_formato (subtipo is null or subtipo ~
  '^[a-z_]{1,40}$')`. A lista de valores é do Core (contrato `NotificacaoSyncSchema`, campo aditivo e opcional), não do banco:
  subtipo novo não pede migração. Conhecido hoje (Drizzle `SUBTIPOS_NOTIFICACAO_CONHECIDOS`): `etapa_pendente_checkout` =
  alerta da etapa obrigatória pendente no checkout, gravado pelo job do alerta (`modules/core/api/etapas-pendencia.ts`).
- Sem índice: a leitura é o pull da caixa do usuário (`notificacao_usuario_sync_ix`, 0006), que leva a coluna; o Gestão filtra
  em memória. Volume: o mesmo da notificação.
- Backfill na migração: as notificações do alerta já gravadas (`tipo = 'sistema'`, `origem_modulo = 'core'`, título
  `Etapa pendente na visita…` e `envio_id` = `visita_etapa` do mesmo tenant com `pendente_desde`) ganham
  `etapa_pendente_checkout`; o gatilho `notificacao_updated_at` avança o `updated_at` delas (voltam no próximo pull). Com dono
  das tabelas sem superusuário (DBaaS), o FORCE RLS faz o backfill não ver linha: as antigas ficam null e o Gestão usa o
  fallback pelo título.
- RLS: a mesma de `notificacao` (enable/force, `isolamento_tenant`); nenhuma política nova, grants iguais.
- Caminho de volta: `0030_core_notificacao_subtipo.down.sql` (APAGA a coluna e o CHECK; as notificações ficam). Teste:
  `db/testes/notificacao-subtipo.test.ts`.

## 0036 — convite de 1º acesso e telefone do usuário (`0036_core_usuario_convite`; T-0087 fatia E, RN-CORE-31, desenho docs/modulos/core/equipe-csv.md)
## usuario_convite — convite de 1º acesso, de uso único, entregue por link (sem e-mail). Fora do sync
| Coluna | Tipo | Regra |
|---|---|---|
| comuns da regra 5 | | `id`, `tenant_id` (FK `plataforma.tenant`), `created_at`, `updated_at` (gatilho `usuario_convite_updated_at`), `deleted_at`, `external_id` |
| usuario_id | uuid not null | FK composta `usuario_convite_usuario_fk (tenant_id, usuario_id) → core.usuario` |
| token_hash | text not null | sha256 **hex** (minúsculas) do segredo (CHECK `usuario_convite_token_hash_sha256`); **único por tenant** (`usuario_convite_token_uk (tenant_id, token_hash)`, como o `sessao_token_uk`; regra 5 do S0-023). O admin recebe uma vez o token `<tenant_id>.<segredo>` (32 bytes base64url), como o refresh da `sessao`; o banco nunca vê o segredo |
| expira_em | timestamptz not null | prazo da API (7 dias, RN-CORE-31); o banco não amarra ao `created_at` |
| usado_em | timestamptz | aceite (senha definida). Exclusivo com `revogado_em` (CHECK `usuario_convite_usado_ou_revogado`) |
| revogado_em | timestamptz | renovação (o link anterior deixa de valer) ou anonimização |
| criado_por_id | uuid | quem gerou, SEM FK: `core.usuario` do tenant ou `plataforma.super_admin` (0035), conforme o tipo (como o `ator_id` da 0035) |
| criado_por_tipo | text | `usuario` \| `super_admin` (CHECK `usuario_convite_criado_por_tipo_valido`; Drizzle `CRIADO_POR_CONVITE`); com o id, os dois ou nenhum (CHECK `usuario_convite_criado_por_par`; nenhum = carga/seed) |
- Pendente = `usado_em is null and revogado_em is null and deleted_at is null` (vencido sem uso continua pendente até ser
  revogado). **No máximo 1 pendente por usuário** (`usuario_convite_pendente_uk`, único parcial `(tenant_id, usuario_id)`):
  renovar = revogar o pendente e DEPOIS inserir o novo, na mesma transação.
- Aceite (rota pública `POST /v1/auth/convite/aceitar`): a API tira o tenant do token, abre o contexto do tenant e faz
  `select … where token_hash = $1 for update` + `update … set usado_em` na mesma transação, sob RLS. **Sem função SECURITY
  DEFINER** (nada novo em `DEFINER_REVISADAS`).
- Índices: `usuario_convite_token_uk (tenant_id, token_hash)` único (aceite: o `tenant_id` vem da política RLS), `usuario_convite_pendente_uk` (lista de pendentes, renovação),
  `usuario_convite_usuario_ix (tenant_id, usuario_id)` (histórico do usuário, FK, revogação). Volume: centenas por tenant.
- RLS: enable + force, `isolamento_tenant` e `manutencao` (0031); `macuxi_app` com select/insert/update (**sem delete**:
  convite se revoga); `macuxi_worker` sem acesso. Fora de `TABELAS_SYNC` (`TABELAS_FORA_DO_SYNC`).
- LGPD: `plataforma.anonimizar_usuario` apaga `usuario.telefone` e revoga os convites pendentes (item `core.usuario_convite`,
  logo depois de `core.dispositivo`); ver [lgpd.md](lgpd.md).
- Fixture dois-tenants (grupo de UUID `0x08`, `CONVITES_FIXTURE`): A pendente e revogado do vendedor-2 e usado do promotor;
  B pendente do vendedor-B (autor super_admin). Demo: sem convites (os usuários da demo já têm senha).
- `codigo_erp` do CSV = `core.usuario.external_id` (único vivo por tenant); superior = árvore `core.equipe`: nenhuma coluna nova.
- Caminho de volta: `0036_core_usuario_convite.down.sql` (anonimizar_usuario volta ao corpo da 0024; APAGA a tabela com os
  convites e a coluna telefone). Teste: `db/testes/usuario-convite.test.ts`.

## 0037 — prazo médio máximo e formas de pagamento do cliente (`0037_forma_prazo_escalonada`; T-0089, RN-VEN-25, desenho docs/desenho/T-0089.md §3 e §8)
**cliente** (novas, nulas, sem padrão e sem índice; lidas junto do cliente no pull e no `core.cadastro_resumo@1`):
| Coluna | Tipo | Regra |
|---|---|---|
| prazo_medio_max_dias | integer | 0..365 (`cliente_prazo_medio_max_faixa`). Nulo = **sem teto** (P1): todos os prazos ativos habilitados |
| formas_pagamento | text[] | **códigos** de `vendedor.forma_pagamento.codigo`, **sem FK** (a forma é do Vendedor; regra 1, ADR 0027). `core.codigos_forma_validos`: até 20, 1 dimensão, cada um 1..20 caracteres, não vazio, sem repetir. Nulo ou `{}` = **todas as ativas** (P1); código sem forma = ignorado pelo Vendedor |

Vêm do ERP no `integracao.cliente.atualizado@1` (ausente = não altera; nulo/`[]` = limpa) e da ficha do cliente no BKO. Volta: o
down da 0037 apaga as duas colunas com os valores. Base de demo: 45 dias em todos, 30 na Panificadora Pão Dourado, Conveniência
Rota 10 sem boleto (`PIX`, `DINHEIRO`, `CARTAO`). Fixture: c1 de A com 45 e `{PIX,BOLETO}`; c1 de B com 30 e nulo.

## 0039, seção T-0095 — guarda de ordem do ERP e vendedor desligado no BKO (`0039_plataforma_portal_email_senha`, seção "T-0095"; RN-INT-02/04, pedido R-20261107-175135-modulo-core)
Viaja no fim da 0039 (seção separada e comentada no up e no down) porque a 0039 ainda não estava no `main` quando a T-0095
entrou e o executor só aceita `NNNN_nome`. Colunas novas, **nulas, sem padrão, sem backfill e sem índice** (o consumidor lê e
grava na mesma linha que já acha por `(tenant_id, external_id)`); RLS e grants herdados da tabela; **fora do pull** (o
`TABELAS_SYNC` lista as colunas e estas não entram) e fora do aparelho.
| Tabela.coluna | Tipo | Regra |
|---|---|---|
| cliente.erp_alterado_em, usuario.erp_alterado_em, produto.erp_alterado_em | timestamptz(3) | último `alterado_em` do ERP **já aplicado** à linha; nulo = nunca veio do ERP. O consumidor do Core (`modules/core/api/consumidores-erp*.ts`, `decidirOrdemErp`) ignora a reentrega com `alterado_em` menor (fora de ordem pela outbox); igual reaplica (idempotente) |
| usuario.desligado_no_bko_em | timestamptz(3) | a API do BKO (`modules/core/api/usuarios.ts`) grava `now()` ao desativar e limpa ao reativar; preenchida, a carga do ERP **não reativa** o vendedor (`decidirReativacaoDoErp`) e o monitor avisa |

Volta: o down da 0039 (seção T-0095) faz `drop column if exists` das 4 — perde só as marcas; a próxima carga do ERP aplica
tudo de novo e um vendedor desligado no BKO pode voltar ativo (desfaça junto o Core da T-0095). Teste: `db/testes/erp-ordem.test.ts`.

## 0040 — estado da senha e versão da sessão (`0040_core_senha_email_saida`; T-0094 fatia B, ADR 0032, RN-CORE-32/33/34, desenho docs/desenho/T-0094.md §2 e §13)
Colunas novas em `usuario` (tabela acima): `trocar_senha`, `senha_expira_em`, `senha_temporaria_hash`, `senha_temporaria_expira_em`,
`senha_temporaria_criada_em` e `sessao_versao`. Padrões que não reescrevem linha (`false` e `0`): quem já tinha senha continua
com ela, definitiva (RN-CORE-32 vale na criação e na troca). Nenhum índice novo (lidas pela chave do usuário no login e no
`autenticar`). Fora do pull (o Core seleciona as colunas do sync). Drizzle: `usuario` em `modules/core/db/nuvem.ts`.

| Estado | `senha_hash` | `trocar_senha` | `senha_expira_em` | `senha_temporaria_*` |
|---|---|---|---|---|
| definitiva | a do usuário | false | nula | nulas |
| temporária (BKO cria/redefine, Equipe por CSV) | a temporária | true | agora + 72 h | nulas |
| master do admin inicial (portal ou `tenant:criar`, P5) | a master | true | **nula** (não vence) | nulas |
| "Esqueci a senha" pendente (P6) | a atual, intacta | como estava | como estava | hash, +72 h, agora |

Regras no Core (domain e API): `avaliarSenhaDoLogin` confere sempre as duas senhas; usar a temporária ou a de `trocar_senha` leva
a `SENHA_A_TROCAR`; a troca grava a nova, zera `trocar_senha`/validade/temporárias e faz `sessao_versao + 1` (com os refresh
revogados) na mesma transação do e-mail (`plataforma.email_saida`, ver [plataforma.md](plataforma.md)). Volume: 1 linha por
usuário (já existente). Consultas: por `(tenant_id, lower(email))` no login (`usuario_email_uk`) e por `(tenant_id, id)` no
`autenticar` (PK).

Também na 0040: a `plataforma.provisionar_tenant` cria o admin inicial com `trocar_senha = true` e sem validade (P5) e, com
`redefinir_senha`, volta a pedir a troca, limpa a temporária, sobe a `sessao_versao` e revoga os refresh; a
`plataforma.anonimizar_usuario` limpa também o estado da senha e sobe a versão ([lgpd.md](lgpd.md)); os convites **pendentes** de
`usuario_convite` saem revogados (o convite sai do Core; a tabela fica de histórico). Caminho de volta: o `.down.sql` apaga as
6 colunas (quem estava com senha temporária fica com ela como definitiva; o "Esqueci" pendente se perde); os convites revogados
continuam revogados. Testes: `db/testes/senha-email-saida.test.ts`.
