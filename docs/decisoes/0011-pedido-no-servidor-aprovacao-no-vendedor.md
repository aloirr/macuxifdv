# ADR 0011 — Pedido no servidor: a aprovação mora no Vendedor, aprovação automática dentro da alçada e vocabulário dos eventos

- **Status**: aceita (2026-11-01, OK do gerente R-20261101-042340 ao desenho T-0029)
- **Data**: 2026-11-01
- **Tarefa**: T-0029 (desenho: [docs/desenho/T-0029.md](../desenho/T-0029.md) §1, §4, §5)
- **Autor**: engenheiro-software
- **Base**: RN-VEN-10/30/31, RN-GES-03/04/07/08, RN-INT-08, RN-CORE-21, matriz do doc 03 §2, RF-VEN-09, RF-GES-04; ADR 0006, ADR 0009;
  domínio do Gestor (`modules/gestor/domain/aprovacoes.ts`, T-0014)

## Contexto
A fatia do pedido para a demo (pedido do Alexandre R-20261101-020623) precisa que o servidor aceite o pedido do aparelho e que
supervisor e gerente aprovem ou rejeitem pelo app Gestão e pelo BKO. Três perguntas surgiram:

1. **Onde mora a aprovação.** O Gestor (T-0014) já tem domínio de fila de aprovação: prazo em dias úteis (RN-GES-03), quem decide
   (RN-GES-04), comentário só na rejeição (RN-GES-08), resumo da fila. O Vendedor tem a alçada (RN-VEN-10), o estado do pedido
   (RN-VEN-30) e a tabela `vendedor.pedido`. A ação `pedido.aprovar` já está no manifesto do Vendedor, e o contrato do Gestor diz
   "a decisão é executada pela API pública do Vendedor".
2. **O que acontece com o pedido dentro da alçada.** Pela RN-VEN-30 o caminho é `recebido → em_aprovacao → aprovado`, mas não diz
   o que faz o pedido que não precisa de aprovação. Na Fase M ele ficava `received` e seguia ao ERP. Na plataforma nova só
   `aprovado` entra na fila do ERP (RN-INT-08) e na base de apuração das metas (RN-CORE-21, padrão "aprovado").
3. **Vocabulário dos estados.** O banco e o pull usam `ORDER_STATUSES` em inglês (herança da Fase M, CHECK em
   `0007_vendedor_pedido`). O doc 03, o Gestor (`STATUS_PEDIDO`) e a Integração (`EstadoPedidoErp`) usam português.

## Decisão
1. **A aprovação mora no Vendedor.** Rotas `POST /v1/vendedor/pedidos/:id/aprovar` e `…/rejeitar` (ação `pedido.aprovar`), regra
   pura `decidirAprovacao` no `domain` do Vendedor (estado, alçada pelo nível do pedido, RN-GES-04 para o gerente, motivo da
   rejeição RN-GES-08), histórico em `vendedor.pedido_evento`, auditoria (RN-AUD-01) e eventos na mesma transação. O **Gestor**
   continua dono da fila e do prazo (RN-GES-03), montados pelos eventos `vendedor.pedido.*@1` (Sprint 6), e quando a tela dele
   existir chama as mesmas rotas. Nesta fatia, o app Gestão mostra a aba **Pedidos** do Vendedor (`apps.gestao` no manifesto).
2. **Dentro da alçada o pedido vira `approved` na hora**, com `aprovacao_automatica = true` e o histórico
   `null → received → approved` (autor = vendedor, motivo "dentro da alçada"). Acima da alçada vira `pending_approval` com o nível
   (`supervisor`, `gerente` ou `analista`). `received` só existe dentro da transação de recebimento. Editar e cancelar continuam
   permitidos em `approved` enquanto o pedido não foi ao ERP (RN-VEN-31; a edição entra depois da fatia).
3. **Estados**: banco, pull e rotas continuam com `ORDER_STATUSES`. Os **eventos** usam o vocabulário do doc 03 por uma função
   pura `statusDoContrato` (`received → recebido`, `pending_approval → em_aprovacao`, `approved → aprovado`,
   `rejected → rejeitado`, `cancelled → cancelado`, `integrated → integrado_erp`, `invoiced_partial → faturado_parcial`,
   `invoiced → faturado_total`; `sent_to_erp → enviado_erp`, que o Gestor acrescenta quando o ERP entrar). Renomear os estados do
   banco fica para uma ADR própria, se valer a pena.
4. **Decidir é online** (REST) no Gestão e no BKO; lista e detalhe são offline pelo pull. A decisão depende do estado atual
   (outro gestor pode ter decidido), então um comando offline viraria conflito frequente. Se o campo pedir aprovação offline, a
   saída é um comando push-only `pedido_decisao` (ADR 0009 §1), sem mudar as rotas.
5. **Novo evento `vendedor.pedido.aprovado@1`** com o conteúdo do pedido para a fila do ERP (pedido do Hub,
   R-20261101-044224-3): o Hub não lê tabela do Vendedor e o `status_alterado@1` não carrega o pedido.

## Alternativas consideradas
- **Aprovação no Gestor** (rota e tabela no schema `gestor`): o Gestor teria de mudar o estado de um pedido que não é dele (lendo
  ou escrevendo `vendedor.pedido`, proibido pela regra 1) ou pedir ao Vendedor por evento, o que deixa o pedido aprovado "em
  algum momento" e a resposta ao gestor sem o estado novo. Também tiraria a aprovação do BKO de quem não licencia o Gestor
  (analista aprovando acima do gerente, RF-VEN-09).
- **Dentro da alçada ficar `received`** (como na Fase M): exigiria outro estado na fila do ERP e na base das metas, e o
  vendedor veria "Recebido" para sempre num pedido que já está liberado.
- **Renomear os estados agora** para o português do doc 03: mexe no CHECK, no pull, nos APKs instalados, na Fase M copiada e nos
  testes, sem ganho para a demo. O mapa nos eventos protege os consumidores e deixa a troca para depois.
- **Aprovação offline por comando**: possível (item 4), mas mais caso de conflito do que valor nesta fase.

## Consequências
- Vendedor: `decidirAprovacao`, `statusDoContrato`, `nivelDaAlcada`, `resultadoDoRecebimento`; `transitions` ganha
  `received → approved`; `orderActions(approved)` libera cancelar; manifesto com `apps.gestao`, perfis de gestão e `aprovado@1`.
- Gestor: nada a fazer agora. A regra "quem decide" fica nos dois módulos: a do Vendedor vale (API); a do Gestor só organiza a
  fila e pode passar a ler `pode_decidir` do Vendedor na Sprint 6. `STATUS_PEDIDO` do Gestor ganha `enviado_erp` quando o ERP
  entrar (campo novo, compatível).
- Integração: consome `vendedor.pedido.aprovado@1` em vez de montar o pedido a partir de `status_alterado@1`.
- Core (metas, RN-CORE-21): o realizado conta a partir de `status_alterado@1` com `para = aprovado`.
