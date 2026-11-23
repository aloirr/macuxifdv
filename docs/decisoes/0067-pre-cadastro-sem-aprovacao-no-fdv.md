# ADR 0067 — Pré-cadastro de cliente sem aprovação no FDV

- **Status**: proposta (o número 0067 vale depois de conferido no `.coord/quadro.md` pelo gerente-projetos; livre no `origin/main` 0b79391).
- **Data**: 2026-11-23 (Manaus)
- **Versão**: v1.0.28. Regras: RN-CORE-78 (revista), RN-CORE-79 (nova), RN-INT-22.
- **Autor**: engenheiro-software
- **Origem**: decisão do dono do produto em 23/11/2026: "O FDV só faz pre cadastro mesmo. O vendedor faz, chega no ERP e o BKO aprova
  por lá." e "é importante o BKO ter uma tela lá em parâmetros onde ele define quais campos são obrigatórios no pré-cadastro."

## Contexto
A v1.0.27 (22/11) pôs o cliente novo para o ERP com aprovação no BKO: o pré-cadastro ficava `pendente`, um analista ou admin aprovava
pela rota `POST /v1/core/clientes/:id/cadastro` (ação `cliente.aprovar_cadastro`), o Core publicava `core.cliente.aprovado@1` e o Hub
buscava os aprovados pela consulta `core.clientes_aprovados_sem_erp@1` para entregar ao ERP em `GET /integracao/v1/clientes/pendentes`
(campo `aprovado_em`). Não chegou a haver tela de aprovação no BKO. O dono do produto decidiu que a aprovação é do ERP.

## Decisão
1. **Sem aprovação no FDV.** O pré-cadastro (campo ou BKO) chega `pendente` e entra na fila do ERP assim que o servidor o recebe. O ERP
   devolve o código (`aprovado`, com `external_id` e `aprovado_em` = quando o ERP aprovou) ou a recusa com o motivo (`recusado`,
   `motivo_recusa` até 500 caracteres; quem vê, item 6).
2. **Evento e consulta trocados sem nova versão.** Saem `core.cliente.aprovado@1`, `core.clientes_aprovados_sem_erp@1`, a ação
   `cliente.aprovar_cadastro` e a rota de decisão; entram `core.cliente.pre_cadastrado@1` `{cliente_id, recebido_em}` e
   `core.clientes_pre_cadastro_sem_erp@1`. Não é "nova versão + convivência" (regra 3 do CLAUDE.md) porque os dois contratos são
   internos (único consumidor: a Integração, no mesmo lote), foram publicados há um dia e o fato mudou de sentido (não há mais
   aprovação a anunciar). Eventos `core.cliente.aprovado@1` ainda na outbox no deploy: nenhum esperado (sem tela de aprovação);
   os pré-cadastros pendentes antigos entram na fila pela recomposição do consumidor da Integração.
3. **Campo do Hub v1 renomeado.** Em `GET /integracao/v1/clientes/pendentes`, `aprovado_em` vira `recebido_em`. É mudança incompatível
   na API pública v1 (RN-INT-09 pede só aditivos) aceita aqui **pela premissa de nenhum ERP integrado** à rota (publicada em 22/11,
   nenhum Conector a chama). Se a premissa falhar antes do deploy, a saída é voltar a mandar `aprovado_em` junto, com o mesmo valor.
4. **Campos obrigatórios por empresa em `plataforma.parametro`** (módulo `core`, chave `cliente.pre_cadastro.obrigatorios`), sem tabela
   nova: razão social e CPF/CNPJ sempre obrigatórios; o admin marca os demais (nome fantasia, inscrição estadual, telefone, e-mail,
   endereço). O app valida offline pelo parâmetro do pull `parametro` e a API revalida (422 `CAMPOS_OBRIGATORIOS`, só chaves).
   `GET|PUT /v1/core/parametros/pre-cadastro`, ações `parametro.pre_cadastro` (analista, admin) e `parametro.pre_cadastro_editar`
   (admin), auditado.
5. **Banco** na migração nova 0097 (não edita 0095/0096): sai `aprovado_por` e o CHECK par; entra `motivo_recusa` (sem grant ao
   `macuxi_leitura`); índice da fila por `(tenant_id, created_at, id)` dos pendentes sem código; `integracao.cliente_fila_erp.aprovado_em`
   vira `recebido_em`.
6. **Motivo da recusa só ao vendedor.** O `motivo_recusa` vai ao perfil vendedor no pull do `cliente` (que já é limitado à carteira) e
   no Cliente 360; os demais perfis (supervisor, gerente, analista, admin, promotor) recebem nulo. Filtro na API pela função pura `motivoRecusaVisivel` (domain do Core, RN-CORE-78).
   O motivo nunca vai a log nem à auditoria.
7. **Reenvio após recusa substitui o recusado.** No `POST /v1/core/clientes/pre-cadastro`, a busca de CPF/CNPJ repetido ignora cliente
   `recusado`: se houver recusado vivo com o mesmo documento, ele recebe `deleted_at` na mesma transação do novo (auditado como
   `cliente.recusado_substituido`, sem o motivo) e o pull leva a remoção ao aparelho. Pendente, aprovado ou legado sem situação segue
   dando 409 `DOCUMENTO_JA_CADASTRADO` (`decidirDocumentoDuplicado`, domain do Core, RN-CORE-78). O reenvio é um cliente novo (outro
   `id`), que entra na fila do ERP como qualquer pré-cadastro.

## Alternativas
- **`core.cliente.pre_cadastrado@1` ao lado do `aprovado@1`, com o antigo deprecado por 30 dias**: convivência sem consumidor nem
  publicador real; só custo.
- **Hub v2 para o campo novo**: versão nova da API pública por uma rota sem nenhum cliente; descartada pela premissa do item 3.
- **Tabela própria para os obrigatórios**: o padrão de parâmetro do Core (`plataforma.parametro` + pull `parametro`) já resolve.
- **Corrigir e reenviar o mesmo cliente** (recusado volta a `pendente` com o mesmo `id`): exigiria rota de edição do pré-cadastro e
  reabrir a linha do Hub já respondida pelo ERP; substituir por um cliente novo usa a rota e a fila que já existem.
- **Motivo para toda a carteira**: o motivo é texto livre do ERP, útil só a quem corrige e reenvia (o vendedor).

## Consequências
- O APK v1.0.27 em campo não quebra: o pull do `cliente` passa a trazer `status_cadastro` e `motivo_recusa`, e o aparelho guarda a linha
  como JSON sem revalidar pelo `ClienteSyncSchema` (só o push é validado). Ele só não mostra os campos.
- O histórico do recusado fica na auditoria; o registro antigo no Hub (`integracao.cliente_fila_erp`) segue ligado ao `id` antigo.
- Ordem do lote: migração 0097, Core e Integração juntos (o Core lê `motivo_recusa` no pull; a Integração grava `recebido_em`).
