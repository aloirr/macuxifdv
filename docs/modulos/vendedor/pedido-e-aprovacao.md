# Vendedor — pedido, alçada e aprovação (T-0029)

Referências: desenho `docs/desenho/T-0029.md`, ADR 0011 (aprovação mora no Vendedor), ADR 0012 (consultas entre módulos), doc 03 §4 e matriz §2.

## Fluxo
1. **Campo** (vendedor, offline): cliente e produto vêm do pull do Core; o preço, da consulta `catalogo.precos_cliente@1` no aparelho; as alçadas, dos parâmetros do tenant (`alcada.*`, valem offline); a condição de pagamento, de `condicao_pagamento` e `cliente_condicao`. O aparelho valida com a mesma função do servidor (`validateOrder`) e enfileira o `PedidoPush` (UUID do aparelho).
2. **API** (`POST /v1/sync/push`, entidade `pedido`, `modules/vendedor/api/receber.ts`): uma transação por item. Ordem: remover (RN-VEN-31) → id do payload → perfil (RN-PRO-01) → idempotência (RN-VEN-33) → carteira (RN-CORE-04) → cadastro (`core.cadastro_resumo@1`: RN-VEN-13/01) → preço (RN-CAT-06, data limitada a 7 dias, P-4) → condição (RN-VEN-14) → alçada (RN-VEN-10). O total do servidor vale (RN-VEN-02).
3. **Resultado (P-1)**: dentro da alçada = `approved` na hora (aprovação automática, histórico "Dentro da alçada"); acima = `pending_approval` com o nível (`supervisor`, `gerente`, `analista`; acima do gerente com `alcada.acima_gerente = bloquear` = recusado com `RN-VEN-10`).
4. **Gestão/BKO** decidem por `POST /v1/vendedor/pedidos/:id/aprovar` e `/rejeitar`. Decidir exige internet (D-4). Escopo = usuários visíveis (RN-CORE-04), fora dele 404. Quem decide (P-3, RN-GES-04): supervisor o nível supervisor; gerente os níveis gerente e supervisor (neste caso `acima_do_nivel`); analista só o nível analista. Rejeitar exige motivo de 3+ caracteres (RN-GES-08, 422). Repetir a mesma decisão é idempotente; decidir pedido que não está pendente é 422 `RN-VEN-30`.
5. **P-2**: pedido já aceito pelo servidor não se edita (o vendedor duplica); só o que ainda está na fila do aparelho edita. Cancelar continua permitido até o envio ao ERP (inclui aprovado).

## Rotas (`/v1/vendedor`)
| Rota | Ação | Notas |
|---|---|---|
| `GET pedidos` | `pedido.ver` | filtros `status` (lista por vírgula), `seller_id`, `customer_id`, `from`/`to` (fuso do tenant), `q`, `cursor`, `limite`; escopo igual ao do pull; `nivel_aprovacao` e `pode_decidir` por linha |
| `GET pedidos/:id` | `pedido.ver` | itens, histórico, retrato do cliente e `aprovacao` |
| `GET alcadas` | `pedido.ver` | política vigente dos parâmetros (só leitura) |
| `POST pedidos/:id/aprovar` | `pedido.aprovar` | corpo `{ comentario? }` |
| `POST pedidos/:id/rejeitar` | `pedido.aprovar` | corpo `{ motivo }` |
| `POST pedidos/:id/cancelar` | `pedido.cancelar` | 422 `RN-VEN-CANCELAR-APOS-ENVIO` depois do ERP |

Promotor: 403 `RN-PRO-01` em toda escrita; leitura só da carteira. Vendedor e assistente em aprovar/rejeitar: 403 `PERFIL_SEM_ACESSO`.

## Eventos (outbox)
`vendedor.pedido.criado@1`, `status_alterado@1` (uma por transição), `aprovacao_solicitada@1` (pendente) e `aprovado@1` (conteúdo para a fila do ERP). Status no vocabulário RN-VEN-30 (`statusDoContrato`); nenhum nome, documento ou endereço no payload. Auditoria (`tx.auditar`): `pedido.criar`, `pedido.aprovar`, `pedido.rejeitar`, `pedido.cancelar`.

## Telas
- **Campo**: Pedidos (lista, detalhe, novo pedido, Exportar PDF) sobre o pull; pedido na fila e aceito ainda não trazido pelo pull aparecem sobrepostos.
- **Gestão**: aba Pedidos com a lista da equipe ("Para aprovar" primeiro), detalhe com decisão (Aprovar em 1 toque, Rejeitar com motivo; sem internet os botões ficam desabilitados) e PDF.
- **BKO**: Pedidos (filtros na URL, cursor, atualização a cada 10 s, painel "Aguardando aprovação", gaveta com itens, histórico e PDF pelo diálogo de impressão) e Alçadas (limites em leitura e decisões recentes pela auditoria).
- PDF: gerador único em `domain/pdf-pedido.ts` (versão cliente sem nenhum `%`; versão interna com tabela, desconto, alçada e histórico).

## Fora da fatia (backlog)
Envio ao ERP, crédito e título vencido no servidor, estoque, preço mínimo, desconto por item, orçamento, pedido em nome, edição de pedido aceito, notificação ao vendedor e ao supervisor, edição de alçadas pelo BKO, prazo da aprovação (fila do Gestor).
