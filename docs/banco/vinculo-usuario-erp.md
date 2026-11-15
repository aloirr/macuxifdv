# Vínculo "provisório → usuário real" (T-0175, A2, RN-CORE-58)

Levantamento do banco-dados para a rota `POST /v1/core/usuarios/:id/vincular-erp` do modulo-core: toda coluna que
referencia `core.usuario` nas migrações até a `0069`, se o vínculo deve movê-la e o risco de duplicata (índice único) ao
mover. Provisório = usuário com e-mail `…@sem-email.invalid`, criado pela carga do vendedor do ERP; ele nunca entrou no
aparelho (sem senha), então só tem linhas que vieram da **carga** ou do **BKO**.

## 1. Código no ERP (`core.usuario.external_id`) — nada a criar

- **Unicidade por tenant já existe** desde a `0002`: `usuario_external_uk` = `unique (tenant_id, external_id) where
  external_id is not null and deleted_at is null` (lembrada na `0069`, item 4).
- **Busca por código**: o mesmo índice atende `where tenant_id = $1 and external_id = $2 and deleted_at is null` (igualdade).
  Busca parcial (`ilike '%…%'`) na lista de Usuários não usa índice, mas o volume é de centenas de usuários por tenant: a
  varredura do tenant fica bem abaixo da meta de 300 ms. Nenhuma migração na T-0175.
- **Ordem obrigatória na transação**: o índice único **não é adiável**. Primeiro libere o código do provisório, depois grave
  no real:
  1. `update core.usuario set external_id = null, ativo = false, deleted_at = now() where tenant_id = $t and id = $provisorio`
     (o código antigo vai no `antes` da auditoria);
  2. `update core.usuario set external_id = $codigo where tenant_id = $t and id = $real`.
  Só `ativo = false` **não** libera o código (o índice olha `deleted_at`). Anular o `external_id` do provisório evita que
  uma consulta da carga sem filtro de `deleted_at` encontre duas linhas.
- **Idempotência**: na repetição o provisório já está com `deleted_at` → a rota devolve o plano vazio (nada a mover).
- Violação do índice = SQLSTATE `23505`, constraint `usuario_external_uk` → 409 (A1, item 2).

## 2. Colunas que o vínculo MOVE (schema `core`, na mesma transação)

| Tabela.coluna | FK | Índice único que pode colidir | Como mover sem duplicar |
|---|---|---|---|
| `core.carteira.usuario_id` | `carteira_usuario_fk` | `carteira_uk (tenant_id, cliente_id, usuario_id, papel)` vivo | Cliente que o real **já tem** no mesmo papel: `deleted_at = now()` na linha do provisório; os outros: `update usuario_id`. Publicar `core.cliente.atualizado@1` por cliente movido |
| `core.nota_erp.usuario_id` | `nota_erp_usuario_fk` | nenhum por usuário | `update usuario_id` em todas (inclusive as excluídas, para o histórico). `vendedor_external_id` não muda |
| `core.meta.usuario_id` | `meta_usuario_fk` | `meta_uk (tenant_id, usuario_id, periodo, indicador)` vivo | Colisão: fica a meta do real, a do provisório recebe `deleted_at`; sem colisão: `update` |
| `core.meta_produtividade.usuario_id` (escopo usuário) | `meta_produtividade_usuario_fk` | `meta_produtividade_vigencia_uk (tenant_id, escopo, coalesce(equipe_id, usuario_id, …), indicador, vigencia_inicio)` vivo | Igual à `meta` |
| `core.rota.usuario_id` | `rota_usuario_fk` | `rota_usuario_dia_uk (tenant_id, usuario_id, data)` vivo | Sem colisão: `update` — a `rota_parada` acompanha sozinha (FK `(tenant_id, id, usuario_id, data)` com `on update cascade`). Colisão: `deleted_at` na rota do provisório **e** nas paradas dela |
| `core.rota_parada.usuario_id` | via `core.rota` | sequência adiável por rota | Não atualizar à mão: vem pelo cascade da rota |
| `core.tarefa_destinatario.usuario_id` | `tarefa_dest_usuario_fk` | `tarefa_dest_usuario_uk (tenant_id, tarefa_id, usuario_id)` vivo | Colisão: `deleted_at` na do provisório; sem colisão: `update` |
| `core.visita.usuario_id` | `visita_usuario_fk` | `visita_aberta_uk (tenant_id, usuario_id)` com checkout nulo | Na prática vazio (provisório não faz check-in). Se houver: `update`; visita aberta do provisório = recusar (422) |
| `core.deslocamento_dia.usuario_id` | `deslocamento_dia_usuario_fk` | `deslocamento_dia_uk (tenant_id, usuario_id, data)` vivo | Na prática vazio (vem do aparelho). Mesma regra da `meta` |
| `core.indicador_diario.usuario_id` | `indicador_diario_usuario_fk` | `indicador_diario_uk (tenant_id, usuario_id, data)` vivo | Read-model: sem colisão `update`; com colisão `deleted_at` na do provisório e recalcular o dia do real pela fonte |
| `core.equipe.responsavel_id` | `equipe_responsavel_fk` | nenhum | Na prática vazio (provisório é vendedor/promotor). Se houver: `update` |

Também do provisório, sem FK para usuário: `core.usuario.equipe_id` — se o real não tiver equipe, a regra do domain decide
se herda a do provisório (o banco não obriga).

## 3. Colunas que o vínculo NÃO move (identidade ou auditoria do provisório)

Ficam com o provisório (que sai da lista com `deleted_at`) e contam a história como ela foi:

- **Identidade e acesso do próprio provisório**: `core.dispositivo`, `core.sessao` (vazias: ele nunca entrou),
  `core.usuario_convite.usuario_id` (convite pendente do provisório: `revogado_em = now()`; `usuario_convite_pendente_uk` é por
  usuário, não colide), `plataforma.usuario_modulo` e `plataforma.usuario_perfil` (as licenças e o cargo do real são os
  dele; mover colidiria em `usuario_modulo_uk`/`usuario_perfil_uk`), `core.usuario_avatar`, `plataforma.email_saida`,
  `plataforma.diagnostico`, `core.notificacao.usuario_id` (caixa que ninguém leu; mover colidiria em `notificacao_evento_uk`,
  `notificacao_envio_uk`, `notificacao_recado_do_dia_uk` e `notificacao_tarefa_uk`).
- **Autoria e auditoria** (quem fez): `core.notificacao.autor_id` e `recado_do_dia_por`, `core.plano_rv.atualizado_por`,
  `core.meta_produtividade.atualizado_por`, `core.tarefa.autor_id` e `cancelada_por`, `core.usuario_avatar.alterado_por`,
  `core.cliente_foto.enviado_por`, `plataforma.arquivo.enviado_por`, `core.usuario_convite.criado_por_id`,
  `plataforma.auditoria.usuario_id`, `plataforma.auditoria_plataforma.usuario_id`, `plataforma.evento.usuario_id` (outbox,
  imutável), `plataforma.portal_sessao.usuario_atual_id` e `plataforma.portal_sessao_empresa.usuario_id`.

## 4. Outros schemas (fronteira: o Core não escreve aqui)

Sem FK para `core.usuario` (fronteira de módulo). O modulo-core **não** atualiza essas tabelas; se o dono precisar, recebe
um evento do Core (sugestão: `core.usuario.vinculado_erp@1` com `provisorio_id`, `usuario_id`, `external_id`) e reatribui
no próprio schema.

| Tabela.coluna | Precisa mover? |
|---|---|
| `gestor.projecao_fato.usuario_id`, `gestor.alerta.responsavel_id` | **Sim, pelo modulo-gestor via evento**: os fatos `carteira_pendente`, `entradas_carteira` e `metas` guardam o `usuario_id`; o `core.cliente.atualizado@1` por cliente movido recompõe a carteira, mas as metas movidas (e o que mais o gestor atribuir ao provisório) só mudam com o evento do vínculo ou o da meta |
| `vendedor.pedido.vendedor_id`, `autor_id`, `decidido_por_id`; `vendedor.pedido_evento.autor_id` | Em regra vazio (provisório não faz pedido). Se a carga de pedidos do ERP atribuir pedido ao provisório, o modulo-vendedor reatribui `vendedor_id` via evento; `autor_id`/`decidido_por_id` são auditoria e não mudam |
| `promotor.*.promotor_id` (visita_loja e as 10 coletas) | Não (vêm do aparelho; o provisório não coleta). Atenção: as coletas têm FK composta para `visita_loja (tenant_id, id, promotor_id, cliente_id)` **sem** cascade — mover exigiria tudo junto no módulo dono |
| `pesquisa.resposta.usuario_id`, `pesquisa.questionario_versao.publicada_por` | Não (aparelho/auditoria) |
| `treinamento.progresso`, `tentativa`, `xp_lancamento`, `medalha_usuario` (`usuario_id`), `trilha_publicacao.autor_id` | Não (aparelho/auditoria) |
| `catalogo.uso_ia.usuario_id`, `catalogo.busca_log.usuario_id` | Não (telemetria e cota do dia) |
| `integracao.credencial.revogada_por`, `pendencia_inativacao.decidida_por`, `inativacao_auditoria.decidida_por` | Não (auditoria) |

## 5. Carga seguinte (A2, item 7)

O consumidor do vendedor do ERP procura por `(tenant_id, external_id)` entre os vivos (`usuario_external_uk`) e acha o
real: não recria o provisório (o código está ocupado pelo real) e não deve trocar o e-mail real pelo `@sem-email.invalid`
(regra do consumidor, não do banco). A carga de notas (`core.nota_erp.vendedor_external_id` → `usuario_id`) passa a
resolver para o real pela mesma busca.
