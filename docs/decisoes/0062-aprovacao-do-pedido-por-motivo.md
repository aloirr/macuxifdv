# ADR 0062 — Aprovação do pedido por motivo: `aprovacao_solicitada@2`, `aprovacao_decidida@1` e recusa que cancela

- **Status**: aceita em 2026-11-19.
- **Data**: 2026-11-19
- **Tarefa**: T-0184 (P-6). Desenho em [docs/desenho/T-0184.md](../desenho/T-0184.md).
- **Autor**: engenheiro-software
- **Origem**: R-20261117-234127 e R-20261117-234437, que decidem a P-6. R-20261118-214740 e R-20261118-220604, que aprovam a simulação (P1 a P8). Todos do Alexandre.

## Contexto
Hoje o pedido vai para aprovação só por desconto. Ele tem um nível só (`nivel_aprovacao`) e duas decisões: aprovar ou rejeitar, e rejeitar leva a `rejected`.

A simulação aprovada pede quatro mudanças:
- crédito e inadimplência também levam à aprovação;
- cada motivo tem a sua aprovação, e o aprovador de crédito e de inadimplência sai de parâmetro;
- as aprovações correm em paralelo, e uma rejeição encerra as outras;
- o aprovador ganha duas saídas: **Rejeitar**, que leva a `cancelled`, e **Devolver ao vendedor**, que leva a `rejected`.

O evento `vendedor.pedido.aprovacao_solicitada@1` tem `motivos` como enum fechado. A leitura tolerante dos consumidores (Core e Gestor) recusa valor novo de enum. Um `inadimplencia` no `@1` faria o consumidor lançar erro, e o evento pararia na outbox.

## Decisão
1. **Motivo novo:** `inadimplencia` entra em `MOTIVOS_APROVACAO` (Vendedor) e no `MotivoAprovacao` do Gestor.
2. **Evento novo:** `vendedor.pedido.aprovacao_solicitada@2`.
   - É o `@1` mais `aprovacoes: [{ motivo, nivel, texto }]`, uma por motivo, e mais `inadimplencia: { maior_atraso_dias, vencidos_cents } | null`.
   - O `credito` passa a vir preenchido.
   - O `nivel` da raiz é o maior nível pendente.
   - A partir do deploy da v1.0.15, o servidor publica só o `@2`.
   - Os consumidores do `@2`, no Core (notificação) e no Gestor (projeção), entram no **mesmo lote**. Os do `@1` ficam para o histórico da outbox e saem numa versão seguinte, quando não houver `@1` pendente.
3. **Evento novo:** `vendedor.pedido.aprovacao_decidida@1` = `{ pedido_id, vendedor_id, ciclo, motivo, decisao: aprovada|rejeitada|devolvida|encerrada, autor_id, decidida_em, texto }`. Sai um por aprovação que muda de estado.
4. **Modelo:** a tabela `vendedor.pedido_aprovacao` tem uma linha por `(pedido, ciclo, motivo)`.
   - O pedido vai a `approved` quando todas as aprovações do ciclo estão aprovadas.
   - Rejeitar ou devolver encerra as pendentes.
   - Reenviar depois de uma devolução abre um ciclo novo.
   - `vendedor.pedido.nivel_aprovacao` e `motivos_aprovacao` continuam como resumo, para compatibilidade com o app v1.0.13.
5. **Rotas** (ação `pedido.aprovar`, a de hoje):
   - `rejeitar` mantém o efeito de hoje (`rejected`) e é o "Devolver ao vendedor";
   - `recusar` é nova e leva a `cancelled`;
   - o corpo ganha `motivo_aprovacao`, opcional. O `motivo` dos corpos de hoje continua sendo o texto livre do aprovador, que o app v1.0.13 manda. Sem `motivo_aprovacao`, a decisão vale para todas as aprovações que o usuário pode decidir.
   - RN-VEN-30 ganha a passagem de `pending_approval` para `cancelled`.
6. **Parâmetros:** `aprovacao.credito_nivel` e `aprovacao.inadimplencia_nivel`, no módulo `vendedor`, com padrão `gerente`.

## Consequências
- O app Gestão v1.0.13 continua aprovando e rejeitando, com o sentido antigo de rejeitar (devolver), e enxerga só o maior nível.
- Contratos e tabela exatos para cada dono estão no desenho, §7.
- Os critérios de crédito e de inadimplência (RN-VEN-12 e RN-VEN-13) mudam no doc 03. Isso cabe ao gerente-projetos.

## Alternativas recusadas
- **Acrescentar `inadimplencia` no `@1`:** quebra a leitura dos consumidores atuais.
- **Manter uma aprovação só, com o maior nível:** contraria a P3 e a P7.
- **Mudar o efeito da rota `rejeitar` para cancelar:** o app antigo cancelaria pedidos achando que devolvia.
