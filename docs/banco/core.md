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
| perfil | text not null | `admin, analista, assistente, supervisor, gerente, vendedor, promotor` |
| equipe_id | uuid | FK composta para `equipe` |
| senha_hash | text | só argon2id em PHC (`$argon2id$...`, check) |
| ativo, bloqueado_em, ultimo_login_em | | `bloqueado_em` = bloqueio MANUAL do admin (RF-CORE-01) |
| tentativas_falhas | smallint not null default 0 | (0004) falhas de senha seguidas, `>= 0`; 5 falhas => `bloqueio_ate` = agora + 15 min; login certo zera (regra no domain do Core) |
| bloqueio_ate | timestamptz | (0004) bloqueio TEMPORÁRIO por tentativas |

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

Checks: `checkout_em`, `resultado` e `fechada_por` andam juntos (os três nulos = aberta); **`resultado = 'cliente_fechado' ⇒
motivo_id e foto_fachada_id`** (RN-CORE-14). O tipo do motivo (cliente_fechado) é conferido pela API.
Índices: **único parcial `visita_aberta_uk (tenant_id, usuario_id) where checkout_em is null and deleted_at is null`** (RN-CORE-11,
trava final); `visita_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)`; `visita_cliente_ix (tenant_id, cliente_id, checkin_em desc)`
(últimas visitas do Cliente 360); `visita_usuario_dia_ix (tenant_id, usuario_id, data_local)` (rota do dia, cobertura);
parcial `visita_sugere_coordenada_ix (tenant_id, cliente_id, checkin_em desc) where sugere_coordenada and vivo` (BKO);
`(tenant_id, rota_parada_id)`.

## visita_etapa — etapas do checkout por módulo. Sem pull na Sprint 1
`visita_id` (FK) · `modulo` · `etapa` · `situacao` `concluida | dispensada` · `referencia_id` · `registrada_em`.
Único **constraint** `visita_etapa_uk (tenant_id, visita_id, modulo, etapa)` (serve de alvo de `on conflict`).

## notificacao — caixa do usuário (RF-CORE-09). Pull só do próprio usuário
`usuario_id` (FK) · `tipo` `recado | sistema | pedido | treinamento | trade` · `titulo` 1–120 · `corpo` ≤ 1000 ·
`link` `^/m/[a-z0-9-]+` · `origem_modulo` · `origem_evento_id` · `envio_id` · `autor_id` (FK usuário) · `prioridade`
`normal | alta` · `lida_em` · `expira_em` · `push_enviado_em`.
Índices: `notificacao_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)`; parcial `notificacao_nao_lidas_ix
(tenant_id, usuario_id, created_at desc) where lida_em is null and vivo`; únicos parciais `notificacao_evento_uk
(tenant_id, usuario_id, origem_evento_id)` e `notificacao_envio_uk (tenant_id, usuario_id, envio_id)` quando preenchidos.

## meta — meta mensal (RN-CORE-20..22). Pull por usuários visíveis, `periodo ≥ mês anterior`
`usuario_id` (FK) · `periodo` `AAAA-MM` · `indicador` `venda_cents | positivacao | cobertura_pct | visitas` · `valor` bigint ≥ 0
(`cobertura_pct` em pontos-base, ≤ 10000). Índices: único `meta_uk (tenant_id, usuario_id, periodo, indicador)` vivo; `meta_usuario_sync_ix`.

## indicador_diario — read-model diário de vendas (lote B do §7, criado a pedido do gerente). Sem pull na Sprint 1
`usuario_id` (= vendedor, RN-CORE-21) · `data` (fuso do tenant) · `pedidos`, `vendido_cents`, `cancelado_cents` ≥ 0.
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
  int null (unidades na embalagem): CHECKs `produto_embalagem_completa` (as duas ou nenhuma), `produto_embalagem_quantidade_minima`
  (> 1) e `produto_embalagem_diferente` (embalagem ≠ unidade). Índices `produto_medida_ix (tenant_id, unidade)` e
  `produto_embalagem_medida_ix` (parcial). Antes das FKs a 0018 normaliza `upper(btrim(unidade))`; sigla fora do formato
  **aborta** a migração com a lista.
- **produto_unidade** (0018): FK `produto_unidade_medida_fk (tenant_id, unidade) → medida (tenant_id, sigla)`; índice
  `produto_unidade_medida_ix`. (O CHECK antigo `^[A-Z0-9]{1,6}$` fica; a FK exige uma sigla cadastrada, logo `^[A-Z]{1,4}$`.)
- **Integração**: sigla desconhecida no produto / unidade de venda vinda do ERP agora é recusada pela FK (`23503`
  `produto_medida_fk` / `produto_unidade_medida_fk`): o Hub traduz em `referencia_ausente` (RN-CORE-19, RN-INT-04).
- Fora do banco (pendência): `catalogo.tabela_preco_item.unidade` (0013) **sem FK** para `core.medida` (outro schema; ADR
  0005/0012) — a API do Catálogo valida a sigla.
- Base de demo (`db/seeds/demo/medidas.ts`): ativas UN, CX, FD, LT e BD; PCT, TB, GL, KG, DZ e DP inativas (não ausentes: o
  banco semeia as 11 e medida não se apaga). Embalagem dos produtos = as caixas de embarque do demo.ts (CX c/ 4 a 24).
  Fixture dois-tenants: A tem a sigla própria PC (Peça, usada pelos produtos de A), B tem GF (Garrafa), além das 11.
