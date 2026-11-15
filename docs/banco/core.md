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
| perfil | text not null | `admin, analista, assistente, supervisor, gerente, vendedor, promotor`. Desde a 0041 (ADR 0033): o perfil **principal** (vai no token); desde a 0069, **um** perfil por usuário em `plataforma.usuario_perfil`, sempre desta base (gatilho `usuario_perfil_principal`, conferência no COMMIT; ver [plataforma.md](plataforma.md) "Perfis de acesso") |
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
| marca_codigo | varchar(30) | código da marca no ERP (ex.: 980); nulo = sem código; card do Catálogo (0076) |
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
Link do seed e das fixtures (T-0140): o `link` é `/m/<caminho>` de uma tela que existe nas `paginas` dos módulos
(`modules/<m>/app`, ex.: `/m/rota`, nunca `/m/core-rota`); `db/testes/links-seed.test.ts` (estático) confere todo link
gravado pelos seeds contra o formato e a lista de telas, lida do texto dos módulos sem importar o app.

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
  mês do primeiro seed (o mês não anda nas recargas), R$ 2.000,00, venda 50% / positivação 30% / visitas 20% (só `INDICADORES_RV`; itens_por_pedido é só meta) com faixas
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

## 0053 — canal do cliente (`0053_core_cliente_canal`; T-0115, RN-PES-05)
Pedido R-20261109-010010-modulo-core. `core.cliente.canal` text **nulo** (nulo = sem canal), vindo do ERP pelo consumidor do Core
(ausente = não altera; nulo ou em branco = limpa), devolvido no pull de cliente e em `core.cadastro_resumo@1`; a Pesquisa filtra
o público por ele. CHECK `cliente_canal_tamanho` (1..60 caracteres). Índice parcial `cliente_canal_ix` (tenant_id, canal) where
deleted_at is null and canal is not null (filtro por canal). RLS, políticas, grants e índice de sync não mudam; sem backfill.
Espelho Drizzle `cliente.canal`. **Volta**: apaga índice, CHECK e coluna (os canais se perdem; volte antes o Core).
A view-modelo do Conector (`vw_macuxi_cliente`) ganha `canal` quando o `ClientePayload` da Integração tiver o campo (o teste das
views recusa coluna fora do contrato). Testes: `db/testes/cliente-canal.test.ts`.

## 0056 — filial (`0056_core_filial`; T-0149, RN-CORE-39, RF-CORE-16, ADR 0040, desenho docs/desenho/T-0149.md §3.1)
Pedido R-20261110-064112-engenheiro-software (origem R-20261110-062236-alexandre).

### filial — unidade de onde saem as entregas. Pull escopo **tenant**
| Coluna | Tipo | Regra |
|---|---|---|
| colunas comuns | | `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id` (chave do ERP, única viva: `filial_external_uk`) |
| `codigo` | text not null | 1..20, único vivo no tenant (`filial_codigo_uk`) |
| `nome` | text not null | 1..80 |
| `cidade` | text | 1..80; **nula só na padrão recém-nascida** (o obrigatório é do domain, `validarFilial`, no BKO) |
| `uf` | text | `^[A-Z]{2}$`; nula como a cidade |
| `padrao` | boolean not null default false | **uma** viva por tenant (`filial_padrao_uk`, único parcial) |
| `ativo` | boolean not null default true | `filial_padrao_ativa`: a padrão é sempre ativa e viva (não inativa nem apaga) |

- **Nascimento**: gatilho `tenant_semear_filial` (AFTER INSERT em `plataforma.tenant`, função `core.semear_filial(uuid)`)
  cria a padrão `0001` "Filial padrão" (cidade/UF nulas, sem `external_id`), id `uuid_de_chave('<tenant>:core.filial:padrao')`
  (`idFilialPadrao` em `db/src/ids.ts`). Vale para `plataforma.provisionar_tenant` e `sa_provisionar_tenant` sem mudar as
  funções (mesmo padrão das medidas e da forma "À vista"). Idempotente: só cria se não há padrão viva. A migração semeou os
  tenants existentes.
- **Trocar a padrão** (BKO, `padrao: true` na edição): na MESMA transação, `update ... set padrao = false` na atual **antes** de
  marcar a nova (o único parcial não é adiável: a ordem inversa dá 23505).
- **ERP**: a primeira carga com o mesmo `codigo` "adota" a padrão (grava o `external_id`; desenho §4.4).
- `core.filial_padrao_id(tenant uuid) returns uuid`: id da padrão viva (RLS de quem chama; nulo se não houver). EXECUTE ao
  `macuxi_app`.
- RLS enable + force, `isolamento_tenant` e `manutencao`; `macuxi_app`: select, insert, update, delete.
- Volume: unidades a dezenas por tenant. Consultas: lista do BKO por tenant, `core.filiais@1` por ids (PK) e por
  `external_id` (`filial_external_uk`).

### cliente.filial_id
- `uuid not null`, FK composta `cliente_filial_fk (tenant_id, filial_id) -> core.filial (tenant_id, id)`.
- Gatilho `cliente_filial_padrao` (BEFORE INSERT OR UPDATE OF filial_id, função `core.preencher_filial_padrao()`): **nulo vira a
  padrão** do tenant em todo caminho de escrita (ERP com `filial_external_id: null`, BKO, seed, fixture); sem padrão viva = 23502.
- Índice `cliente_filial_ix (tenant_id, filial_id)`: clientes da filial (BKO, trava "filial com cliente ativo não inativa").
- Backfill: todos os clientes na padrão. **Anda o `updated_at` de todo cliente uma vez** (o pull repuxa a carteira com o
  `filial_id`). Pull: o Core acrescenta `filial_id` às colunas de `TABELAS_SYNC.cliente`; entidade nova `filial` (escopo tenant):
  `codigo, nome, cidade, uf, padrao, ativo` (dados fiscais desde a 0059, abaixo).
- Filial **efetiva** (RN-CORE-39, `filialEfetiva` no domain do Core): a do cliente se viva e ativa; senão a padrão.

Caminho de volta (`0056_core_filial.down.sql`, junto com Catálogo, Vendedor e Integração — ver catalogo.md, vendedor.md e
integracao.md): apaga gatilhos, funções, a coluna e `core.filial` (as filiais cadastradas se perdem). Testes:
`db/testes/filial.test.ts`.

## 0057 — fotos do PDV (`0057_core_foto_pdv`; T-0147, RN-CORE-38, RF-CORE-15, ADR 0041, desenho docs/desenho/T-0147.md §3 e §7)
Pedido R-20261110-065020-engenheiro-software (origem R-20261110-062234/062242-alexandre).

### foto_tipo — tipos de foto do PDV do tenant. Pull escopo **tenant**
| Coluna | Tipo | Regra |
|---|---|---|
| colunas comuns | | `external_id` único vivo (`foto_tipo_external_uk`) |
| `nome` | text not null | 1..60, único vivo **sem diferenciar maiúsculas** (`foto_tipo_nome_uk` sobre `lower(nome)`) |
| `obrigatorio` | boolean not null default false | entra no "faltam N obrigatórias" |
| `sensivel` | boolean not null default false | documento: só admin, analista, gerente e supervisor da carteira abrem (ADR 0041; o gerente desde R-20261110-084206) |
| `fachada` | boolean not null default false | o tipo do "Ver foto do PDV": **um** vivo por tenant (`foto_tipo_fachada_uk`), nunca sensível (`foto_tipo_fachada_nao_sensivel`), nunca apagado (`foto_tipo_fachada_viva`) |
| `ordem` | integer not null default 0 | ordem do resumo |
| `ativo` | boolean not null default true | |

- **Nascimento**: gatilho `tenant_semear_foto_tipo` (função `core.semear_foto_tipo(uuid)`) cria "Fachada" (fachada,
  obrigatória, ordem 0), id `uuid_de_chave('<tenant>:core.foto_tipo:fachada')` (`idFotoTipoFachada`). Idempotente (não cria se
  já há tipo fachada vivo ou tipo vivo chamado "fachada"). A migração semeou os tenants existentes.
- Mudar `sensivel` de um tipo: o Core toca o `updated_at` das fotos dele na mesma transação (o aparelho repuxa com o
  `arquivo_id` certo) e chama `tx.restringirArquivos` (SDK) para os `perfis_leitura` dos arquivos.

### cliente_foto — a foto vigente de cada tipo de cada cliente. Pull escopo **carteira**; push pelo aparelho
| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid | gerado no aparelho (escrita idempotente) |
| `cliente_id` | uuid not null | FK composta `cliente_foto_cliente_fk` |
| `foto_tipo_id` | uuid not null | FK composta `cliente_foto_tipo_fk` |
| `arquivo_id` | uuid not null | id de `plataforma.arquivo` (SEM FK: outro schema, ADR 0010); único no tenant entre todas as linhas (`cliente_foto_arquivo_uk`) |
| `origem` | text not null default 'camera' | `camera` ou `galeria` (`cliente_foto_origem_valida`) |
| `enviado_por` | uuid not null | FK composta `cliente_foto_enviado_por_fk` -> `core.usuario` |
| `tirada_em` | timestamptz | instante do aparelho (UTC) |

- **Uma viva** por (cliente, tipo) (`cliente_foto_vigente_uk`). Substituir (admin, analista, supervisor) = apagar a antiga
  logicamente e gravar a nova **na mesma transação**; o vendedor e o promotor só enviam o que falta (`podeEnviarFoto`).
- Índices: `cliente_foto_cliente_ix (tenant_id, cliente_id)` (pull por carteira e ficha), `cliente_foto_tipo_ix
  (tenant_id, foto_tipo_id)` (tocar as fotos de um tipo), `cliente_foto_sync_ix`.
- **Pull** (consulta de referência, conferida em `db/testes/foto-pdv.test.ts`): `arquivo_id` **nulo** quando o tipo é sensível —
  ```sql
  cliente_id, foto_tipo_id,
  case when (select t.sensivel from core.foto_tipo t
              where t.tenant_id = core.cliente_foto.tenant_id and t.id = core.cliente_foto.foto_tipo_id)
       then null else arquivo_id end as arquivo_id,
  origem, to_char(tirada_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as tirada_em
  ```
  (a subconsulta usa a PK de `foto_tipo`; o filtro da carteira é o `colunaCliente: 'cliente_id'` de hoje).
- Volume: até 1 por tipo por cliente (~500 clientes × 3 tipos por vendedor).

### cliente.inativado_em
- `timestamptz` nulo. Gatilho `cliente_inativado_em` (BEFORE INSERT OR UPDATE OF ativo, `core.marcar_cliente_inativado()`):
  `ativo` vira falso → `now()` (mantém o valor se já estava inativo); volta a verdadeiro → nulo. Backfill: inativos =
  `updated_at`. Fora do pull. É o relógio da retenção das fotos do PDV (cliente inativo + 5 anos, [lgpd.md](lgpd.md)).

RLS das 2 tabelas: enable + force, `isolamento_tenant` e `manutencao`; `macuxi_app`: select, insert, update, delete.
Caminho de volta (`0057_core_foto_pdv.down.sql`): apaga as 2 tabelas, os gatilhos, as funções, `inativado_em` e
`plataforma.arquivo.perfis_leitura` (os metadados e os bytes das fotos ficam; sem `perfis_leitura` a leitura volta à regra da
carteira — volte antes a rota de arquivos). Testes: `db/testes/foto-pdv.test.ts`.

## 0059 — dados fiscais da filial (`0059_core_filial_dados_fiscais`; T-0159, RN-CORE-39)
Pedidos R-20261110-215816 e R-20261110-220007 do dono do produto: o cabeçalho do PDF de pedido e de orçamento mostra CNPJ,
endereço e telefone da **filial de faturamento**. Migração aditiva: 7 colunas **nulas** em `core.filial`, sem backfill (o
`updated_at` das filiais não anda).

| Coluna | Tipo | Regra |
|---|---|---|
| `cnpj` | text | só dígitos, 14 (`filial_cnpj_formato`); **único vivo no tenant** quando preenchido (`filial_cnpj_uk`, 23505). O dígito verificador é do domain (`validarFilial`) e da carga do Hub |
| `logradouro` | text | 1..160 (`filial_logradouro_tamanho`) |
| `numero` | text | 1..20 (`filial_numero_tamanho`; "S/N" vale) |
| `complemento` | text | 1..80 (`filial_complemento_tamanho`); opcional na regra |
| `bairro` | text | 1..80 (`filial_bairro_tamanho`) |
| `cep` | text | só dígitos, 8 (`filial_cep_formato`, igual a `cliente_endereco`) |
| `telefone` | text | 1..30 (`filial_telefone_tamanho`, igual a `usuario.telefone`); opcional na regra |

- **Obrigatoriedade** ("sem CNPJ e endereço a filial não é cadastrada", R-20261110-220007): no domain do Core (BKO) e na carga
  do Hub (registro recusado no monitor). O banco aceita nulo porque a padrão nasce sem esses dados (gatilho
  `tenant_semear_filial`) e as filiais existentes ainda não os têm. O **NOT NULL** de `cnpj`, `logradouro`, `numero`,
  `bairro`, `cidade`, `uf` e `cep` fica para uma migração futura, depois de preenchidas as filiais da demo e da produção, com a
  semeadura da padrão ajustada junto. Conferência antes de ligar: `select codigo from core.filial where deleted_at is null and
  (cnpj is null or logradouro is null or numero is null or bairro is null or cidade is null or uf is null or cep is null)`.
- RLS, políticas e grants: os da 0056 (tabela inteira). `ent_filial` no aparelho é JSON (sem DDL); o Core decide se as colunas
  vão no pull da filial. O PDF usa o **retrato no pedido** (`vendedor.pedido.filial`, mesmos nomes; vendedor.md, "0059").
- Conector: `vw_macuxi_filial` devolve as 7 colunas (CNPJ e CEP sem máscara; integracao.md, "0059").
- Seed da demo (`db/seeds/demo/filial.ts`, `DADOS_FISCAIS_DEMO`), dados **fictícios**: Manaus 0001 — CNPJ 11.222.333/0001-81,
  Av. Torquato Tapajós, 5000, Galpão 3, Flores, 69058-830, (92) 3000-1001; Boa Vista 0002 — 11.222.333/0002-62, Av. Ville Roy,
  1200, São Pedro, 69306-405, (95) 3000-2002. Banco sem a 0059: a seed grava as filiais sem esses campos.

Caminho de volta (`0059_core_filial_dados_fiscais.down.sql`): apaga o índice, os 7 CHECKs e as 7 colunas (os dados fiscais se
perdem; o retrato já gravado nos pedidos fica). Volte antes o Core, o Hub e o pull que leem as colunas. Testes:
`db/testes/filial-dados-fiscais.test.ts` e `db/testes/seed-demo-filial.test.ts`.

## 0062 — guarda de ordem do ERP no resto do Core e "desligado no BKO" na filial (`0062_core_catalogo_erp_ordem`; T-0095, RN-INT-02/04/06)
Continua a seção T-0095 da 0039. Colunas **nulas, sem padrão, sem backfill** (nada muda em `updated_at`), RLS e grants herdados,
**fora do pull** e fora do aparelho. A parte do Catálogo está no [catalogo.md](catalogo.md) ("0062").
| Tabela.coluna | Tipo | Regra |
|---|---|---|
| cliente_endereco, produto_unidade, titulo, nota_erp, rota, filial `.erp_alterado_em` | timestamptz(3) | `alterado_em` do registro do ERP (relógio do ERP, nunca o `ocorrido_em` do Hub) aplicado à linha; nulo = nunca veio do ERP. O consumidor grava em **toda** escrita do ERP, inclusive inativação e apagamento, quando o evento traz o registro; sem registro, não avança (`coalesce`). Na rota, cada dia (`<rota>@<data>`) guarda a versão da rota inteira |
| filial.desligado_no_bko_em | timestamptz(3) | a API do BKO (`PUT /filiais/:id`) grava `now()` ao desativar e limpa ao reativar, no mesmo update do `ativo`; preenchida, a carga do ERP não reativa a filial |

**Gatilhos** (rede de segurança; o consumidor decide antes e avisa o monitor):
- `<tabela>_versao_erp` (BEFORE UPDATE, `when (new.erp_alterado_em < old.erp_alterado_em)`, função `plataforma.manter_versao_erp()`):
  versão recebida **mais antiga** que a aplicada não grava; a linha fica como estava e o `returning` ainda devolve a linha (o
  consumidor não cai no "não achei, insere"). Igual reaplica (idempotente). Ordena depois de `<tabela>_updated_at`: o no-op não
  sobe o `updated_at`. Em `cliente`, `usuario`, `produto` (colunas da 0039) e nas 6 tabelas acima.
- `<tabela>_desligado_no_bko` (BEFORE UPDATE OF ativo, quando a marca continua preenchida e o update tenta reativar, função
  `plataforma.manter_desligado_no_bko()`): mantém `ativo = false`; o resto do update vale (nome, endereço...). Em `usuario` e
  `filial`. **Reativar no BKO = `ativo = true` e `desligado_no_bko_em = null` no mesmo update.**
- O gatilho só protege a linha **viva**. Onde o ERP apaga (`deleted_at`) e o mesmo `external_id` volta como linha nova
  (`titulo`, `nota_erp`), o consumidor confere antes a maior versão, **apagadas inclusive**, pelo índice `<tabela>_erp_versao_ix`
  `(tenant_id, external_id, erp_alterado_em) where external_id is not null and erp_alterado_em is not null`:
  `select erp_alterado_em from core.titulo where external_id = $1 and erp_alterado_em is not null order by erp_alterado_em desc limit 1`
  (index-only; o RLS acrescenta o `tenant_id`). As tabelas que só inativam (`ativo = false`) acham a linha viva pelo único vivo
  `(tenant_id, external_id)`; a rota é pequena e o consumidor já varre `starts_with(external_id, '<rota>@')`.

Volta: `0062_core_catalogo_erp_ordem.down.sql` apaga índices, gatilhos, as 2 funções e as 11 colunas (as da 0039 ficam). Perde só as
marcas; a próxima carga aplica tudo de novo e a filial desligada no BKO pode voltar ativa. Volte antes o código que lê ou grava as
colunas (senão 42703). Teste: `db/testes/erp-ordem.test.ts` (estático; banco e up/down no CI).

## 0063 — limite de desconto do usuário (`0063_core_usuario_limite_desconto`; T-0168, RN-VEN-11a, desenho docs/desenho/T-0168.md §1)
Pedido R-20261112-151014-engenheiro-software. Aditiva: 3 colunas em `core.usuario` e 2 CHECKs; RLS, políticas e grants herdados;
nenhum índice novo (as leituras são por PK: BKO do usuário, `core.cadastro_resumo@1`, sync `usuario`).
| Coluna | Tipo | Padrão | Regra |
|---|---|---|---|
| desconto_limita_item | boolean not null | `true` | "Limitar desconto por item": RN-VEN-11 ligada (o item respeita o desconto máximo do produto) |
| desconto_limita_pedido | boolean not null | `false` | "Limitar desconto por pedido" |
| desconto_maximo_pedido_permil | integer, nulo | — | desconto máximo do pedido em **décimos de %** (‰): 8,0% = 80; 7,5% = 75. Nome `_permil` de propósito: `_pct` no repositório é % decimal |

CHECKs: `usuario_desconto_pedido_permil_faixa` (nulo ou 0..1000) e `usuario_desconto_pedido_com_limite` ("por pedido" ligada
exige o número). Desligar "por pedido" **mantém** o número (religar devolve o valor). Usuário que já existe fica com o padrão pelo
`default` (comportamento de hoje), sem reescrever a tabela e sem andar o `updated_at`; usuário novo nasce com o padrão. Quem
grava é só o BKO do Core; a carga do ERP e o CSV da Equipe não tocam nas colunas. Toda edição sobe o `updated_at` pelo gatilho
`usuario_updated_at` (o sync puxa a linha de novo). Seed da demo e views do Conector sem mudança.

Volta: `0063_core_usuario_limite_desconto.down.sql` apaga os 2 CHECKs e as 3 colunas (os limites gravados se perdem; reaplicar a
0063 volta todos ao padrão). Volte antes o código do Core e do Vendedor que lê ou grava as colunas (senão 42703). Teste:
`db/testes/usuario-limite-desconto.db.test.ts` (estático; banco e up/down no CI).

## 0064 — tarefas do consultor (`0064_core_tarefa`; T-0170, RN-CORE-TAR-01..12, desenho docs/desenho/tarefas-consultor.md §3 e §5)
Aditiva: 2 tabelas, 1 coluna em `core.notificacao` e 1 gatilho. RLS enable + force, `isolamento_tenant` e `manutencao`;
`macuxi_app` com select, insert e update, **sem delete** (remover = `deleted_at`). Fotos da conclusão: `plataforma.arquivo`
(`modulo = 'core'`, `finalidade = 'tarefa'`, `entidade = 'tarefa_destinatario'`); nenhuma tabela de fotos nova.

### tarefa — a tarefa como foi cadastrada no BKO. Vai ao aparelho só pela linha do destinatário
| Coluna | Tipo | Regra |
|---|---|---|
| colunas comuns | | `id` gerado no BKO (idempotência do POST); `external_id` único vivo (`tarefa_external_uk`) |
| `autor_id` | uuid not null | FK composta `tarefa_autor_fk` -> `core.usuario` |
| `titulo` | text not null | não vazio e ≤ 120 (`tarefa_titulo_tamanho`) |
| `descricao` | text | ≤ 1000 (`tarefa_descricao_tamanho`) |
| `prazo` | date not null | data civil no fuso do tenant |
| `cliente_id` | uuid | FK composta `tarefa_cliente_fk`; nulo = sem cliente |
| `tipo` | text not null | `simples`, `foto` ou `pesquisa` (`tarefa_tipo_valido`) |
| `questionario_id` | uuid | **sem FK** (schema `pesquisa`, regra 1); só e sempre no tipo `pesquisa` (`tarefa_questionario_coerente`) |
| `alvo` | text not null | `usuarios`, `equipe` ou `todos` (`tarefa_alvo_valido`); só para o BKO mostrar |
| `equipe_id` | uuid | FK composta `tarefa_equipe_fk`; só e sempre no alvo `equipe` (`tarefa_equipe_coerente`, no gatilho `tarefa_conferir_coerencia`) |
| `cancelada_em`, `cancelada_por` | timestamptz, uuid | juntos (`tarefa_cancelamento_par`, no gatilho `tarefa_conferir_coerencia`); `cancelada_por` FK composta -> `core.usuario` |
| `motivo_cancelamento` | text | ≤ 300 (`tarefa_motivo_tamanho`), só na cancelada (`tarefa_motivo_so_cancelada`) |

Índices: `tarefa_sync_ix`, `tarefa_autor_ix (tenant_id, autor_id, created_at desc)` (lista do BKO),
`tarefa_prazo_abertas_ix (tenant_id, prazo) where cancelada_em is null and deleted_at is null` (atrasadas).
**Gatilho `tarefa_tocar_destinatarios`** (AFTER UPDATE, função `core.tocar_destinatarios_tarefa()`): quando muda `titulo`,
`descricao`, `prazo`, `tipo`, `cliente_id`, `questionario_id`, `cancelada_em` ou `deleted_at`, o `updated_at` das linhas de
`tarefa_destinatario` da tarefa anda (o pull lê pelo destinatário). `external_id` e o próprio `updated_at` não disparam.
**Gatilho de restrição `tarefa_conferir_coerencia`** (AFTER INSERT/UPDATE de `alvo`, `equipe_id`, `cancelada_em`, `cancelada_por`;
função `core.tarefa_conferir_coerencia()`): as duas coerências que amarram coluna de FK (`tarefa_equipe_coerente` e
`tarefa_cancelamento_par`) ficam aqui e não em CHECK. O CHECK roda na escrita da linha, antes da FK (gatilho no fim do
comando): apontar para equipe ou usuário de outro tenant seria recusado pela coerência (23514) e não pela FK (23503), que é
quem prova o isolamento (S0-025). Recusa com 23514, `CONSTRAINT` = nome da regra e a mesma mensagem do CHECK; o nome em
minúsculas ordena o gatilho depois dos da FK (`RI_ConstraintTrigger_*`).

### tarefa_destinatario — uma linha por consultor (a que vai ao aparelho). Pull `tarefa`, escopo **proprio**
| Coluna | Tipo | Regra |
|---|---|---|
| `tarefa_id` | uuid not null | FK composta `tarefa_dest_tarefa_fk` |
| `usuario_id` | uuid not null | FK composta `tarefa_dest_usuario_fk` |
| `concluida_em`, `recebida_em` | timestamptz | juntos (`tarefa_dest_conclusao_par`): hora do aparelho e hora do servidor (RN-CORE-TAR-06) |
| `conclusao_id` | uuid | UUID do comando `tarefa_conclusao`; único no tenant (`tarefa_dest_conclusao_uk`): idempotência |
| `observacao` | text | ≤ 500 (`tarefa_dest_observacao_tamanho`) |
| `resposta_id` | uuid | resposta da Pesquisa (sem FK); gravada pelo consumidor de `pesquisa.resposta.registrada@1` |
| `suspeita` | boolean not null default false | relógio do aparelho adiantado (RN-CORE-TAR-06) |

- **Um vivo** por (tarefa, usuário) (`tarefa_dest_usuario_uk ... where deleted_at is null`; o `on conflict` da API leva o mesmo
  predicado).
- Conclusão (servidor): `update … set concluida_em, recebida_em = now(), conclusao_id … where id = $1 and concluida_em is null`
  (vale a primeira).
- Índices: `tarefa_dest_sync_ix`, `tarefa_dest_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)` (pull `proprio`),
  `tarefa_dest_abertas_ix (tenant_id, usuario_id) where concluida_em is null and deleted_at is null`,
  `tarefa_dest_tarefa_ix (tenant_id, tarefa_id)` (acompanhamento).
- Volume: ~20 linhas por consultor na janela de 30 dias; até 500 por tarefa.

### notificacao.tarefa_id
`uuid` nulo; FK composta `notificacao_tarefa_fk` -> `core.tarefa`; só com `subtipo = 'tarefa'` (gatilho de restrição `notificacao_tarefa_subtipo`, AFTER INSERT/UPDATE de `tarefa_id`/`subtipo` com `tarefa_id` preenchido, função `core.notificacao_conferir_tarefa()`: subtipo nulo também recusa; 23514 depois da FK, como em `tarefa_conferir_coerencia`);
um aviso por (usuário, tarefa) (`notificacao_tarefa_uk ... where tarefa_id is not null`): criar a mesma tarefa de novo não
duplica. O aviso usa `tipo = 'sistema'` (RN-CORE-TAR-07).

Volta: `0064_core_tarefa.down.sql` apaga as tabelas, as 3 funções, o gatilho de coerência da notificação e a coluna `notificacao.tarefa_id` (os avisos ficam, sem vínculo;
fotos e bytes ficam). Teste: `db/testes/t0170-tarefa.db.test.ts`.

## 0065 — frase do dia e foto ou avatar (`0065_core_frase_avatar`; T-0170, RN-CORE-41 e RN-CORE-42, desenho docs/desenho/inicio-frase-avatar-pedidos.md §1)
Aditiva: 2 tabelas e a carga das 30 frases padrão. RLS enable + force, `isolamento_tenant` e `manutencao`; `macuxi_app` com
select, insert e update, **sem delete**.

### frase_dia — frases do rodízio do Início. Pull `frase_dia`, escopo **tenant** (inclui removidas)
| Coluna | Tipo | Regra |
|---|---|---|
| `texto` | text not null | 1..120 depois do trim (`frase_dia_texto_tamanho`); único vivo sem diferenciar maiúsculas nem espaços nas pontas (`frase_dia_texto_uk` sobre `lower(btrim(texto))`) |
| `ativa` | boolean not null default true | inativa fica no BKO e sai do rodízio |
| `ordem` | integer not null | ordem do rodízio; empate pelo `id` |
| `padrao_codigo` | text | `P01`…`P30` nas que vieram com o FDV (`frase_dia_padrao_codigo_formato`, `^P[0-9]{2,3}$`); nulo nas do tenant. Único por tenant **sem** filtro de `deleted_at` (`frase_dia_padrao_uk`): a padrão removida não volta |

- **Carga das 30** (texto de `modules/core/domain/frase-avatar/frases-padrao.ts`, conferido pelo teste): função
  `core.semear_frase_dia(uuid)`, id `uuid_de_chave('<tenant>:core.frase_dia:<código>')` (no TS:
  `idDeChave(\`${tenant}:core.frase_dia:${codigo}\`)`), ordem 1..30, `on conflict do nothing`. Tenant novo: gatilho
  `tenant_semear_frase_dia` (AFTER INSERT em `plataforma.tenant`), na mesma transação do `plataforma.provisionar_tenant` e da
  `sa_provisionar_tenant`, **sem recriar** as funções (padrão da 0006/0018/0037/0056/0057). Tenants existentes: backfill na
  migração. A frase padrão editada mantém o código (o texto do tenant vale).
- Limite de 366 vivas por tenant: domain e API (422 `RN-CORE-41`).
- Volume: 30 a 366 por tenant. Pull pelo `frase_dia_sync_ix`.

### usuario_avatar — foto ou avatar do usuário, uma linha por troca. Pull `usuario_avatar`, escopo **usuários visíveis**; push pelo aparelho
| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid | UUID da troca (aparelho ou navegador): idempotência |
| `usuario_id` | uuid not null | FK composta `usuario_avatar_usuario_fk` |
| `tipo` | text not null | `iniciais`, `avatar` ou `foto` (`usuario_avatar_tipo_valido`) |
| `avatar_codigo` | text | `m1`..`m3`, `f1`..`f3` (`usuario_avatar_codigo_valido`); só e sempre no `avatar` (`usuario_avatar_codigo_coerente`) |
| `arquivo_id` | uuid | id de `plataforma.arquivo` (sem FK, ADR 0010; `finalidade = 'avatar'`); só e sempre na `foto` (`usuario_avatar_arquivo_coerente`); único no tenant entre todas as linhas (`usuario_avatar_arquivo_uk`) |
| `alterado_em` | timestamptz not null | instante da troca; decide quem vence (RN-CORE-42) |
| `alterado_por` | uuid not null | FK composta `usuario_avatar_alterado_por_fk` -> `core.usuario` |

- **Uma viva** por usuário (`usuario_avatar_vivo_uk`); sem viva = iniciais. Trocar = apagar a viva logicamente e gravar a nova
  na mesma transação; troca superada (offline) é gravada já apagada.
- Índices: `usuario_avatar_sync_ix`, `usuario_avatar_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)` (pull por
  usuários visíveis).

Volta: `0065_core_frase_avatar.down.sql` apaga as tabelas, o gatilho e as funções (as frases editadas pelo tenant e as trocas se
perdem; reaplicar recarrega só as 30 padrão; fotos e bytes ficam). Teste: `db/testes/t0170-frase-avatar.db.test.ts`.

## 0066 — metas de produtividade, km do dia e meta de itens por pedido (`0066_core_meta_produtividade`; T-0170, desenho docs/desenho/performance-produtividade.md §5, §6.1 e §7.4)
Aditiva: 2 tabelas e 1 valor no CHECK de `core.meta`. RLS enable + force, `isolamento_tenant` e `manutencao`; `macuxi_app` com
select, insert e update, **sem delete**.

### meta_produtividade — meta de produtividade por escopo. Pull `meta_produtividade`: todas as vivas do tenant, sem janela
| Coluna | Tipo | Regra |
|---|---|---|
| `escopo` | text not null | `tenant`, `equipe` ou `usuario` (`meta_produtividade_escopo_valido`) |
| `equipe_id` | uuid | FK composta `meta_produtividade_equipe_fk`; só e sempre no escopo `equipe` (`meta_produtividade_equipe_coerente`, no gatilho `meta_produtividade_conferir_alvo`) |
| `usuario_id` | uuid | FK composta `meta_produtividade_usuario_fk`; só e sempre no escopo `usuario` (`meta_produtividade_usuario_coerente`, no gatilho `meta_produtividade_conferir_alvo`) |
| `indicador` | text not null | um dos 12 de `INDICADORES_PRODUTIVIDADE` (`meta_produtividade_indicador_valido`) |
| `valor` | integer not null | ≥ 0 (`meta_produtividade_valor_nao_negativo`), na unidade do indicador; a faixa é do domain/API |
| `vigencia_inicio` | text not null | `AAAA-MM` (`meta_produtividade_vigencia_formato`) |
| `atualizado_por` | uuid | FK composta -> `core.usuario`; nulo = carga |

- **Único vivo** `meta_produtividade_vigencia_uk (tenant_id, escopo, coalesce(equipe_id, usuario_id, '0000…'::uuid),
  indicador, vigencia_inicio) where deleted_at is null` (o `on conflict` da API repete a expressão e o predicado).
- Índices: `meta_produtividade_indicador_ix (tenant_id, indicador, escopo)`, `meta_produtividade_sync_ix`.
- **Gatilho de restrição `meta_produtividade_conferir_alvo`** (AFTER INSERT/UPDATE de `escopo`, `equipe_id`, `usuario_id`;
  função `core.meta_produtividade_conferir_alvo()`): as duas coerências do alvo, fora do CHECK para a FK cruzada decidir antes
  (23503; S0-025), como em `tarefa_conferir_coerencia`. Recusa com 23514 e o nome da regra.
- Sentido e padrão do FDV ficam no contrato (`SENTIDO_PRODUTIVIDADE`, `META_PRODUTIVIDADE_PADRAO`): tenant novo sem seed.
- Volume: ~12 por alvo.

### deslocamento_dia — resumo diário do km. Pull `deslocamento_dia`, janela das visitas, escopo de usuário
**Vazia até o rastreamento (T-0156)**; mantida só pelo servidor (recalcula o dia inteiro: update da mesma linha).
| Coluna | Tipo | Regra |
|---|---|---|
| `usuario_id`, `data` | uuid not null, date not null | FK composta `deslocamento_dia_usuario_fk`; único vivo `deslocamento_dia_uk (tenant_id, usuario_id, data)` |
| `metros`, `pontos` | integer not null default 0 | ≥ 0 |
| `primeiro_ponto_em`, `ultimo_ponto_em` | timestamptz | juntos (`deslocamento_dia_pontos_par`), último ≥ primeiro (`deslocamento_dia_pontos_ordem`) |
| `origem` | text not null default 'rastreamento' | só `rastreamento` (`deslocamento_dia_origem_valida`); `manual` pede migração nova |

Sem coordenada (dado pessoal derivado; retenção do resumo: 5 anos, T-0145 §5). Índices: `deslocamento_dia_sync_ix`,
`deslocamento_dia_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)`. Volume: 1 por usuário por dia útil.

### meta.indicador
`meta_indicador_valido` passa a aceitar `itens_por_pedido` (valor em **centésimos**: 3,50 itens = 350). As metas que existem não
mudam. O `INDICADORES_META_BANCO` do espelho Drizzle tem o valor (v1.0.6), em par com o `INDICADORES_META` do contrato.

Demo (`db/seeds/demo/tarefas-produtividade.ts`, chamado pelo `demo.ts`; banco sem a 0066 = nada): 4 tarefas da supervisora
(foto, **pesquisa** com o questionário de exposição para a Equipe Manaus, simples concluída pelo Lucas e uma vencida para
todos) com o aviso de cada destinatário; metas de produtividade da Equipe Manaus, do Lucas e da Camila; `itens_por_pedido`
de Lucas e Camila (mês corrente e anterior); km dos 5 dias antes do "hoje". As 30 frases padrão não são do seed: nascem com
o tenant (gatilho da 0065). O ensaio é respeitado (cancelamento, conclusão, leitura e meta viva do BKO na mesma chave ficam).

Volta: `0066_core_meta_produtividade.down.sql` apaga as 2 tabelas, a função do gatilho de alvo e, em `core.meta`, as metas `itens_por_pedido` (DELETE
físico; reaplicar não as devolve) e volta o CHECK aos 4 indicadores da 0006. Teste: `db/testes/t0170-meta-produtividade.db.test.ts`.

## 0067 — resumo de visitas por cliente (`0067_core_cliente_visita_resumo`; Oficial, decisão do dono do produto de 14/11/2026, aba Performance da ficha do cliente)
Aditiva: 1 view e 2 índices em `core.visita`; nenhuma tabela nem coluna nova. A view é `security_invoker = true` (pg15+): roda
com o papel de quem consulta, então valem as políticas `isolamento_tenant` (FORCE RLS) de `core.visita` e `core.usuario`.
`macuxi_app`: só select. `macuxi_worker`: sem acesso.

### v_cliente_visita_resumo — total de visitas e última visita do cliente. Uma linha por (tenant, cliente) com ao menos uma visita
| Coluna | Tipo | Regra |
|---|---|---|
| `cliente_id`, `tenant_id` | uuid | o cliente da visita |
| `total_visitas` | integer | visitas **concluídas**: `deleted_at` nulo, `checkout_em` não nulo e `resultado <> 'nao_finalizado'` (o fechamento automático da virada do dia, RN-CORE-11, não é check-out real). `cliente_fechado` conta |
| `ultima_visita_em` | timestamptz (UTC) | `checkin_em` da concluída mais recente (empate: maior `id`); nulo sem concluída |
| `ultima_visita_usuario_id` | uuid | quem fez essa visita |
| `ultima_visita_usuario_nome` | text | `core.usuario.nome` dele (anonimizado pela LGPD aparece anonimizado) |
| `updated_at` | timestamptz | cursor do sync: o maior entre o `updated_at` de **todas** as visitas do cliente (inclusive apagadas e abertas, para o apagamento chegar ao aparelho) e o do usuário da última visita (troca de nome) |

- Cliente cuja única visita foi apagada (ou só tem visita aberta / `nao_finalizado`) fica com `total_visitas = 0` e a última nula;
  cliente sem visita nenhuma **não tem linha** (o app lê como 0).
- Índices: `visita_cliente_resumo_ix (tenant_id, cliente_id, checkin_em desc, id desc) include (usuario_id)` parcial nas
  concluídas (contagem e última visita) e `visita_cliente_sync_ix (tenant_id, cliente_id, updated_at)` (o `max(updated_at)`
  por cliente).
- **Consulta recomendada para o pull** (sempre com a carteira; nunca a view inteira do tenant):
  `select cliente_id, total_visitas, ultima_visita_em, ultima_visita_usuario_id, ultima_visita_usuario_nome, updated_at
  from core.v_cliente_visita_resumo where cliente_id = any($carteira) and updated_at > $cursor order by updated_at, cliente_id`.
  Linha sem `id` próprio: a chave no aparelho é `cliente_id`; o desempate do cursor é `cliente_id`.
- Volume: o de `core.visita` (~1 por cliente por semana); a view devolve no máximo 1 linha por cliente.

Demo (`db/seeds/demo/demo.ts`): todo cliente ganha a visita histórica `v-hist:<n>` do dono da carteira (`sem_pedido`, motivo
padrão `estoque_alto`/`comprador_ausente`), entre 54 e 60 dias úteis atrás (antes do mês anterior: metas e realizados não mudam).

Volta: `0067_core_cliente_visita_resumo.down.sql` apaga a view e os 2 índices (nenhum dado se perde). Volte antes o Core que lê
a view (senão 42P01). Teste: `db/testes/cliente-visita-resumo.db.test.ts`.

## 0069 — cargo e hierarquia do cadastro de usuário (`0069_core_cargo_hierarquia`; decisão do dono do produto de 14/11/2026)
Decisão: [ADR 0049](../decisoes/0049-cargos-fixos-e-um-perfil-por-usuario.md) (R-20261114-153500, -153800, -154000).

**Hierarquia: reaproveita `core.equipe`, sem coluna nova em `core.usuario`** (uma informação, um lugar: a árvore de equipes já é
a base do escopo RN-CORE-04 do Gestor, do alerta ao supervisor e do nome da equipe no Início; colunas `supervisor_id`/
`gerente_id`/`nome_equipe` no usuário duplicariam a árvore e divergiriam dela). O cadastro grava:

| Cargo | O que o Core grava |
|---|---|
| vendedor | `core.usuario.equipe_id` = a equipe viva cujo `responsavel_id` é o supervisor (índice `equipe_responsavel_ix`, 0004) |
| supervisor | a equipe dele em `core.equipe` (`responsavel_id` = ele, `nome` = nome da equipe, `equipe_pai_id` = a equipe do gerente) e `core.usuario.equipe_id` = essa equipe |
| promotor | com supervisor: `equipe_id` = a equipe do supervisor (como o vendedor); sem supervisor: `equipe_id` = a equipe do gerente (`responsavel_id` = o gerente) |
| gerente | a equipe dele (`responsavel_id` = ele; raiz) e `equipe_id` = essa equipe |
| administrativo | nada (`equipe_id` nulo) |

O que o cadastro pede: ADR 0049 §4.

O **gerente do vendedor não é gravado no vendedor**: é o responsável da equipe-pai da equipe do supervisor. Trocar o supervisor
do vendedor = trocar o `equipe_id` dele; trocar o gerente do supervisor = trocar o `equipe_pai_id` da equipe dele.

**Promotor** (R-20261114-154000): os 2 casos se separam pelo **cargo do responsável da equipe dele** — equipe de um supervisor
(supervisor = esse responsável; gerente = o responsável da equipe-pai) ou equipe de um gerente (sem supervisor; gerente = o
responsável da própria equipe). Nenhuma coluna nova: `supervisor_id`/`gerente_id` no promotor duplicariam a árvore e poderiam
divergir dela, que é justamente o que a regra proíbe. **A consistência gerente × supervisor é garantida pela própria árvore**:
com supervisor, o gerente do promotor é sempre o responsável da equipe-pai da equipe do supervisor, nada gravado no promotor pode
apontar para outro gerente. Sobra um caso, o supervisor membro (`core.usuario.equipe_id`) de outra equipe que não a que lidera,
em que o "gerente do supervisor" na view seria outro; esse é recusado.

**Garantia no banco (gatilhos de restrição adiados, conferidos no COMMIT; RN-CORE-56, ADR 0049)**: função
`core.conferir_promotores(tenant, usuarios[], equipes[])` (SECURITY INVOKER), que lê a view, e a função de gatilho
`core.promotor_conferir()` (**SECURITY DEFINER**, `search_path = pg_catalog, core, plataforma, pg_temp`) em 4 gatilhos. Nenhuma
das 2 tem EXECUTE para papel da aplicação. Por que DEFINER: gatilho adiado dispara no COMMIT, fora da `sa_*` (DEFINER) que
escreveu; a `sa_provisionar_tenant` cria o admin em `core.usuario` pelo `macuxi_portal`, sem USAGE em `core` — como invoker, o
COMMIT dava "permission denied for schema core" (500 ao criar empresa pelo portal). Mesmo desenho da 0049 para as conferências
da 0041 (ver [plataforma.md](plataforma.md), "0049"). O banco confere só o promotor **com equipe** (`core.usuario.equipe_id` não
nulo): o promotor sem equipe (ainda não alocado: carga do ERP ou CSV, cadastro antigo) é recusado pelo domain/API do Core
(RN-CORE-56, 422), como o vendedor sem supervisor, e aparece na consulta 3 do diagnóstico.

| Gatilho | Quando | Promotores conferidos |
|---|---|---|
| `usuario_conferir_promotor` | `core.usuario`: insert; update de `perfil`, `equipe_id`, `ativo`, `deleted_at` | o próprio (se promotor) e os das equipes que ele lidera e das filhas delas |
| `equipe_conferir_promotor` | `core.equipe`: update de `responsavel_id`, `equipe_pai_id`, `deleted_at` | os da equipe, das filhas e das equipes lideradas por membros dela |
| `usuario_perfil_conferir_promotor` | `plataforma.usuario_perfil`: insert; update de `perfil_id`, `deleted_at` | o usuário (se virou promotor) e os que ele lidera |
| `perfil_conferir_promotor` | `plataforma.perfil`: update de `cargo` | os usuários do perfil e os que eles lideram |

Erros (23514, `hint` RN-CORE-56, `detail` só com o `usuario_id`): `promotor_sem_gerente` (promotor vivo, **ativo** e com equipe
sem `gerente_id` na view, ou com `gerente_id` de cargo diferente de `gerente`: equipe apagada, equipe sem responsável, equipe de um
vendedor/administrativo, equipe de supervisor sem equipe-pai de gerente) e `promotor_gerente_do_supervisor` (com supervisor cujo
`gerente_id` na view não é o do promotor). Adiados: a ordem das gravações na transação não importa (ex.: mover o promotor para
a equipe e só depois dar o supervisor à equipe). Promotor inativo não é conferido (desligado). **Legado**: os gatilhos só valem
para gravações novas ou alteradas que alcançam o promotor; a 0069 não recusa promotor que já está fora da regra, e gravação que
não o alcança (ex.: `nome`, `ultimo_login_em`) passa. Lista: consulta 3 de `db/scripts/diagnostico-0069.sql`
(`promotor_sem_gerente`, `promotor_gerente_do_supervisor`); corrija a equipe dele antes de tocar no cadastro. Custo: por
gravação, uma leitura da view restrita aos promotores alcançados (índices `usuario_equipe_ix`, `equipe_pai_ix`,
`equipe_responsavel_ix`, `usuario_perfil_usuario_ix`); nenhum índice novo.

### v_usuario_hierarquia — leitura pronta (security_invoker; `macuxi_app` só select; worker e portal sem acesso)
| Coluna | Tipo | Regra |
|---|---|---|
| `tenant_id`, `usuario_id` | uuid | usuários não apagados |
| `perfil_id`, `cargo` | uuid, text | o perfil vivo do usuário (um só) e o cargo dele |
| `equipe_id`, `equipe_nome` | uuid, text | a equipe viva do usuário (`core.usuario.equipe_id`) e o nome — é o "nome da equipe" do Início |
| `supervisor_id` | uuid | cargo `vendedor`: o responsável da equipe dele (nulo se for ele mesmo ou se a equipe não tem responsável); cargo `promotor`: o responsável da equipe dele quando tem cargo `supervisor` (**nulo** no promotor sem supervisor) |
| `gerente_id` | uuid | cargos `vendedor` e `supervisor`: o responsável da equipe-pai; cargo `promotor`: o responsável da equipe-pai (equipe de supervisor) ou o da própria equipe (equipe de gerente) |
| `updated_at` | timestamptz | o maior entre usuário, vínculo, perfil, equipe, equipe-pai e (promotor) o perfil do responsável da equipe (cursor, se o app puxar) |

Roda com o papel de quem consulta: valem as políticas `isolamento_tenant` de `core.usuario`, `core.equipe`,
`plataforma.usuario_perfil` e `plataforma.perfil`. Consulta típica: `where usuario_id = $1` (PK de usuário, índices
`usuario_perfil_usuario_ix` e PK de equipe). Volume: o de `core.usuario`.

**Regras cargo × hierarquia do vendedor e do supervisor** (vendedor com equipe de um supervisor; supervisor responsável pela
própria equipe, com nome e equipe-pai de um gerente): **validadas no domain/API do Core** (o promotor tem a garantia no banco,
acima), não por restrição no banco — dados de hoje (ex.: equipe com
responsável administrativo na fixture B, equipe sem responsável) quebrariam. A consulta 3 de `db/scripts/diagnostico-0069.sql`
lista quem está fora da regra.

**Código ERP**: `core.usuario.external_id` já atende — único vivo por tenant desde a 0002 (`usuario_external_uk (tenant_id,
external_id) where external_id is not null and deleted_at is null`; é o `codigo_erp` do CSV da Equipe, 0036). Continua **nulo**
no banco (usuários antigos e o admin inicial do provisionamento não têm código); o "obrigatório para todos" é regra do cadastro
(domain/API do Core). Nenhuma coluna nova.

Volta: `0069_core_cargo_hierarquia.down.sql` (saem os 4 gatilhos do promotor, as 2 funções e a view; ver plataforma.md). Teste: `db/testes/cargo-hierarquia.db.test.ts`.

## 0076 — código da marca no ERP no produto (`0076_core_produto_marca_codigo`; decisão do dono do produto R-20261115-080000-alexandre, item 1)
Aditiva: `core.produto.marca_codigo varchar(30)` nula, sem padrão (não reescreve a tabela), sem CHECK e sem índice (só exibição,
nunca filtro). Vem do ERP pelo Hub (`marca_codigo` do produto no contrato v1, opcional; view `vw_macuxi_produto` em
`db/conector/views-modelo.sql`, ao lado de `marca`) e o Catálogo mostra no card. Texto vazio do ERP: o consumidor do Core grava
nulo (o banco não recusa, para o produto não cair por isso). RLS, grants e índices de `core.produto` ficam como estão.

Volta: `0076_core_produto_marca_codigo.down.sql` apaga a coluna (os códigos voltam na próxima carga do ERP). Volte antes o Core
que lê/grava a coluna (senão 42703). Teste: `db/testes/produto-marca-codigo.db.test.ts`.

## 0077 — filial de cadastro e filiais de venda (`0077_core_usuario_filial`; T-0176, RN-CORE-39, decisões R-20261115-093000 e R-20261115-094500)
Todo usuário (inclusive admin e analista) tem uma **filial de cadastro** e uma ou mais **filiais de venda**; a de cadastro
está entre as de venda. Sem filial de cadastro o usuário fica **bloqueado** (domain/API do Core; o banco aceita o nulo).
Proposta do modulo-core: `docs/modulos/core/filial-cadastro-venda.md`.

### usuario — coluna nova
| Coluna | Tipo | Regra |
|---|---|---|
| filial_cadastro_id | uuid null | FK composta `usuario_filial_cadastro_fk (tenant_id, filial_cadastro_id)` para `filial` (outro tenant = 23503); nulo = bloqueado |

- Índice `usuario_filial_cadastro_ix (tenant_id, filial_cadastro_id) where deleted_at is null`: "usuários da filial" e a trava
  de inativar filial. RLS e grants de `usuario` não mudam.

### usuario_filial — filiais de VENDA do usuário. Índice de sync; o pull é decisão do modulo-core
| Coluna | Tipo | Regra |
|---|---|---|
| usuario_id | uuid not null | FK composta `usuario_filial_usuario_fk` para `usuario` |
| filial_id | uuid not null | FK composta `usuario_filial_filial_fk` para `filial` (filial de outro tenant = 23503) |

- Único vivo `usuario_filial_uk (tenant_id, usuario_id, filial_id) where deleted_at is null` (23505): também atende
  "filiais de venda do usuário". `usuario_filial_filial_ix (tenant_id, filial_id)` vivo: "usuários que vendem pela filial".
  Sync `usuario_filial_sync_ix (tenant_id, updated_at, id)`; `usuario_filial_external_uk`.
- Remover = soft delete (`deleted_at`). `macuxi_app`: select, insert, update (sem DELETE); worker e portal: nada.
  RLS `isolamento_tenant` + `manutencao`. O mínimo de 1 filial de venda é do domain/API do Core (422).

### Invariante: a filial de cadastro está entre as de venda
- `filial_cadastro_id` preenchida num usuário vivo exige linha viva em `usuario_filial` com a mesma filial.
- Gatilhos de restrição **adiados** (conferidos no COMMIT; a ordem das gravações na transação não importa), os dois com o nome
  **`usuario_filial_inclui_cadastro`**: em `usuario` (insert; update de `filial_cadastro_id`, `deleted_at`) e em
  `usuario_filial` (update de `usuario_id`, `filial_id`, `deleted_at` ou delete de linha viva). Função
  `core.filial_cadastro_conferir()` SECURITY DEFINER (COMMIT do portal), sem EXECUTE a ninguém.
- Erro `23514`, constraint `usuario_filial_inclui_cadastro`, detail `usuario_id=<uuid>`, hint `RN-CORE-39` → 422 na API. Para
  o erro sair no comando: `set constraints core.usuario_filial_inclui_cadastro immediate`.
- Concorrência: a conferência trava a linha do usuário (`for no key update`); trocar o cadastro e apagar a venda do mesmo
  usuário em transações paralelas ficam em fila, e a segunda falha no COMMIT.

### Backfill (R-20261115-094500, item 5)
1. "Quem já tem filial vinculada": **não se aplica** — antes da 0077 não há vínculo usuário–filial em tabela nenhuma
   (`usuario`, `equipe`, `plataforma.*` não têm filial; `usuario_filial` nasce na 0077).
2. Empresa com **uma** filial viva: todo usuário vivo (ativo ou não) recebe essa filial como venda e como cadastro (o
   `updated_at` sobe; o sync puxa a filial).
3. Quem sobra (empresa com 2+ filiais vivas) fica sem cadastro e sem venda: bloqueado até o BKO ou a carga do ERP.

### Admin inicial da empresa nova (`plataforma.provisionar_tenant`)
A 0077 redefine a `provisionar_tenant` (`create or replace`, a partir do texto da 0068): o admin que ela **cria** recebe a
filial padrão do tenant (semeada pela 0056 ao inserir o tenant) como cadastro (no insert do usuário) e como venda, e não nasce
bloqueado; sem padrão viva = 55000 (hint RN-CORE-39). Admin existente não muda (nem ganha filial). É o lugar **único** da
regra: vale para o CLI (`pnpm tenant:criar`), as seeds e o portal — a `sa_provisionar_tenant` chama a `provisionar_tenant` e
continua com o texto da 0068. A conferência adiada `usuario_filial_inclui_cadastro` passa também no COMMIT do `macuxi_portal`.
Assinatura, SECURITY INVOKER, `search_path` e ACL não mudam; o down volta ao texto da 0068.

Volume: 1 a poucas linhas por usuário. Fixture: `USUARIO_FILIAL_FIXTURE` (grupo 0x6a): todo usuário com cadastro e venda na
padrão; o supervisor de A vende também na Boa Vista e o vendedor de B também na Campinas (o usuário bloqueado é montado pelo
teste). Seeds: demo (`db/seeds/demo/filial.ts`, `dadosDemoUsuarioFilial`) com os 7 logins na Manaus (cadastro e venda) e os 2
vendedores também na Boa Vista; Fase M com todos na padrão.
Volta: `0077_core_usuario_filial.down.sql` (a `provisionar_tenant` volta à 0068; saem os gatilhos, a tabela, a função, o índice, a FK e a coluna; as filiais se
perdem; reaplicar refaz o backfill). Teste: `db/testes/usuario-filial.db.test.ts`.

## 0080 — Código FDV do usuário (`0080_core_usuario_codigo_fdv`; T-0175, RN-CORE-59)
Especificação: [docs/modulos/core/usuarios.md](../modulos/core/usuarios.md) ("Código FDV") e `modules/core/domain/codigo-fdv.ts`.
Dois códigos por usuário: o Código ERP (`external_id`) e o **Código FDV**, gerado pelo banco em sequência por empresa
(só número, 5 dígitos, sem prefixo: `00001`, `00002`…; `99999` -> `100000`; R-20261115-110000), para todos os perfis, único por
empresa, só de leitura e nunca reaproveitado.

| Objeto | O que é |
|---|---|
| `core.usuario.codigo_fdv text` | o código; nulo só no usuário apagado antes da 0080. CHECK `usuario_codigo_fdv_formato` (`^(0000[1-9]|000[1-9][0-9]|00[1-9][0-9]{2}|0[1-9][0-9]{3}|[1-9][0-9]{4,})$`: só o que o gatilho gera, 5 dígitos de `00001` a `99999` ou 6 ou mais sem zero à esquerda; `00000`, `000001` e `0100000` são recusados) |
| `usuario_codigo_fdv_uk` | único `(tenant_id, codigo_fdv) where deleted_at is null and codigo_fdv is not null`; cobre a busca pelo código |
| `core.usuario_codigo_fdv_contador` | uma linha por tenant (`usuario_codigo_fdv_contador_tenant_uk`; id = `uuid_de_chave('<tenant>:core.usuario_codigo_fdv_contador')`), `ultimo_sequencial bigint >= 0` = maior número emitido. Colunas-padrão, RLS forçado, `isolamento_tenant` + `manutencao`; `macuxi_app` só **select**. `macuxi_leitura` (0078): select e política `leitura`. Fora do sync |
| `usuario_codigo_fdv_contador_nao_diminui` | gatilho BEFORE UPDATE do contador: diminuir ou trocar de tenant = 23514, constraint de mesmo nome |
| `usuario_codigo_fdv_contador_piso` | gatilho BEFORE INSERT do contador (função `core.usuario_codigo_fdv_contador_piso()`, invoker, sem EXECUTE a ninguém): a linha nova nasce no mínimo no maior código já gravado no tenant (vivo ou apagado, máximo numérico) |
| `core.usuario_codigo_fdv()` | função dos 2 gatilhos abaixo, SECURITY DEFINER, `search_path = pg_catalog, core, plataforma, pg_temp`, sem EXECUTE a ninguém |
| `usuario_codigo_fdv_emitir` | BEFORE INSERT em `core.usuario`: código nulo -> `update ... set ultimo_sequencial = ultimo_sequencial + 1 returning` no contador; sem a linha, insert no piso (`on conflict (tenant_id) do nothing`) e o mesmo update (a linha fica travada até o fim da transação, então inserts concorrentes do mesmo tenant numeram em fila, sem repetir) e grava `lpad(n, greatest(5, dígitos), '0')`. Código informado (restauração de backup, carga técnica) fica, e o contador que existe sobe para `greatest(atual, n)`; sem a linha, nada (o piso cuida quando ela nascer) |
| `usuario_codigo_fdv_somente_leitura` | BEFORE UPDATE em `core.usuario`: mudar `codigo_fdv` = **SQLSTATE 23514**, **constraint `usuario_codigo_fdv_somente_leitura`**, coluna `codigo_fdv`, hint `RN-CORE-59` -> o Core mapeia para 422 `CODIGO_FDV_SOMENTE_LEITURA`. O apagado sem código que volta a vivo ganha o próximo número |

**Consulta só leitura** (0078): `grant select (codigo_fdv) on core.usuario to macuxi_leitura` (a 0078 deu SELECT por coluna em
`core.usuario`; coluna nova não herda).

**Filial (0077)**: o gatilho `usuario_codigo_fdv_emitir` é BEFORE INSERT e não toca a filial; o admin que a
`plataforma.provisionar_tenant` cria (CLI, seeds e portal) recebe a filial padrão e o próximo Código FDV no mesmo insert. A
conferência adiada `usuario_filial_inclui_cadastro` não dispara no backfill (o update só muda `codigo_fdv`).

**Backfill**: os vivos (`deleted_at` nulo) de cada tenant, por `created_at, id`, recebem `00001`…; o contador termina no maior
emitido (tenant sem vivo fica sem linha até o 1º insert). O `updated_at` dos vivos anda: o aparelho puxa o usuário com o código.

**Nunca reaproveitado**: o contador só sobe. Apagado (inclusive o provisório desativado no vínculo do ERP, que mantém o próprio
código) fica fora da unicidade dos vivos, mas o número dele já foi contado. Número consumido sem uso (insert de usuário que caiu no
`ON CONFLICT` dele) não volta: buraco aceito.

**Backup e restauração da empresa** (0072, `ordem_do_backup`): o contador só tem FK para `plataforma.tenant` e sai na 1ª leva,
antes de `core.usuario` (que espera `core.equipe`, ciclo quebrado, e `core.filial` pela 0077). A restauração dá certo em qualquer ordem, com os gatilhos
ligados: contador antes -> cada usuário com código sobe o contador para `greatest(atual, n)`; usuários antes -> o usuário com
código não cria a linha, e o contador do backup entra por insert (o "nunca diminui" é de update e não entra) e passa pelo piso.
Contador do backup atrás dos códigos (cópia inconsistente) também sobe até o maior. Não desligue os gatilhos do contador na
restauração (sem o piso, um contador atrasado repetiria número).

Caminho de volta: `0080_core_usuario_codigo_fdv.down.sql` apaga gatilhos, funções, contador, índice, CHECK e coluna; **perde os
códigos** (reaplicar renumera os vivos). Volte antes o Core (`COLUNA_CODIGO_FDV_PRONTA = false`). Teste:
`db/testes/usuario-codigo-fdv.db.test.ts`.
