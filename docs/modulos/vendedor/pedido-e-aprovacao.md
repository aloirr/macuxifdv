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
- **BKO**: Pedidos (filtros na URL, cursor, atualização ao abrir, ao focar a janela, depois de decidir e pelo botão Atualizar, painel "Aguardando aprovação", gaveta com itens, histórico e PDF pelo diálogo de impressão) e Alçadas (limites em leitura e decisões recentes pela auditoria).
- PDF: gerador único em `domain/pdf-pedido.ts` (versão cliente sem nenhum `%`; versão interna com tabela, desconto, alçada e histórico).

## Atualização das telas (RN-CORE-23, T-0054)
- **App (Campo e Gestão)**: nenhuma consulta periódica nem timer. Ao abrir a tela, o app só relê o aparelho. O pull vem do motor de sync da plataforma, no shell: a cada `sync_auto_min` (30 min, mínimo 15), ao abrir o app e ao voltar ao primeiro plano depois de 30 min. Puxar a tela para baixo = **Sincronizar** (envia a fila e roda o sync), na lista e no detalhe. Um novo toque nos 30 s seguintes só relê o aparelho (item 5).
- **BKO**: sem `refetchInterval`. Atualiza ao abrir, ao focar a janela, depois de cada decisão e pelo botão "Atualizar".
- O teste `sem-consulta-periodica.test.ts` barra `setInterval` e `refetchInterval` nas telas.

## Retorno do ERP (T-0054)
Status pelo retorno do ERP, faturado@1, faturado e devolução nas telas: ver `retorno-erp.md`.

## Fora da fatia (backlog)
Crédito e título vencido no servidor, estoque, edição de pedido aceito, notificação ao vendedor e ao supervisor, edição de alçadas pelo BKO, prazo da aprovação (fila do Gestor).

T-0053: retorno do ERP e orçamento (pré-venda) em `pre-venda-e-erp.md`.

## Leitura de pedidos pelo promotor (O-3, opção `promotor_ve_pedidos`)
Decisão de 02/11: o promotor lê, só leitura e com escopo de carteira, os pedidos dos clientes da própria carteira; é uma **opção do perfil Promotor** (`promotor_ve_pedidos`), **ligada por padrão**.
- Ligada: lista (`GET /v1/vendedor/pedidos`), detalhe (`/:id`) e pull de `pedido`, `pedido_item` e `pedido_evento` com escopo de carteira; toda escrita segue 403 (`RN-PRO-01`).
- Desligada: 403 `RN-PRO-01` na lista e no detalhe (sem consultar o banco) e o pull não entrega pedido, item nem evento.
- Vendedor, supervisor e demais perfis não mudam.
- Regra pura: `podeLerPedidos(perfil, opcao)` em `modules/vendedor/domain/leitura-pedido.ts`. Ponto único da leitura da opção: `promotorVePedidos(ctx)` em `modules/vendedor/api/opcao-promotor.ts` (hoje devolve `true`; TODO trocar pela consulta pública do Core quando o modulo-core publicar). Testes injetam a opção com `usarOpcaoPromotorVePedidos`.

## Pedido em nome do vendedor (RF-GES-05, RN-VEN-35, RN-VEN-10)
O supervisor (equipe) e o gerente (área) fazem o pedido pelo vendedor no app Gestão, pelo slot `pedido.criar_em_nome` (item registrado em `app/index.ts`, contrato em `contracts/extensoes.ts`; abre `/m/novo-pedido?vendedorId=`).
- **Contrato**: `PedidoPush.vendedor_id` (opcional) = dono. O `autor_id` **nunca** vem do aparelho: é o usuário do token. Ausente ou igual ao autor = pedido comum (a fila antiga segue válida).
- **API** (`api/receber.ts`, regras em `domain/pedido-em-nome.ts`): `verificarPedidoEmNome` confere promotor (403 `RN-PRO-01`), perfil do autor (403 `PERFIL_SEM_ACESSO`), equipe/área por `ctx.usuariosVisiveis()` (403 `FORA_DA_EQUIPE`) e dono vendedor (422 `VENDEDOR_INVALIDO`). Orçamento e conversão não são em nome (`EM_NOME_SO_PEDIDO`).
- **Alçada** (RN-VEN-10): vale a do gestor (`politicaDoAutor`: supervisor 10%, gerente 15% por padrão; as exceções individuais do vendedor saem). O aparelho aplica a mesma regra (`politicaParaAutor`).
- **Gravação**: `vendedor_id` = vendedor, `autor_id` = gestor, `vendedor_nome` = vendedor, histórico e auditoria com o nome e o perfil do gestor (`depois.em_nome`). Eventos `criado@1`, `status_alterado@1` e `aprovacao_solicitada@1` levam `vendedor_id` = vendedor (conta na meta e no ranking, RN-CORE-21) e `autor_id` = gestor.
- **Idempotência** (RN-VEN-33): o id só se repete para o mesmo autor; outro autor recebe `ID_EM_USO`.
- Limite conhecido: a carteira conferida é a do gestor (equipe/área), não a carteira individual do vendedor. Notificação ao vendedor: pedido ao Core (consumo de `criado@1` com autor diferente do vendedor).
- Testes: `domain/pedido-em-nome.test.ts`, `api/pedido-em-nome.test.ts` (banco simulado), `api/pedido-em-nome.db.test.ts` (CI), `app/lib/pedido-em-nome.test.ts`, `app/slot-em-nome.test.ts`.

## Aplicação do produto no item (RN-VEN-19, T-0084)
- **Domain** `domain/aplicacao.ts`: `retratoAplicacao(texto, incluir, max)` (nulo se desmarcado ou vazio; corta em `max` na última palavra inteira com "…", o "…" conta; palavra única longa vira `max − 1` + "…"; idempotente) e os parâmetros `aplicacao_max_orcamento` (50 a 1.000, padrão 300), `aplicacao_no_orcamento_padrao` (padrão sim) e `referencia_no_orcamento` (padrão não, RN-CAT-10).
- **App (Novo pedido)**: cada item cujo produto tem aplicação mostra as 2 linhas e a caixa "Incluir aplicação no orçamento" (48 dp), **por item**, marcada pelo padrão do tenant; a escolha fica no `ajustes[chave]` do rascunho (`aplicacao_marcada`, `aplicacao_retrato`). O retrato é tirado ao montar o pedido (`calcularPedido`), offline, a partir de `catalogo.textos_produto@1` (carregado junto com os preços da tabela do cliente). Editar mantém o retrato gravado (e o desmarcado); desmarcar e marcar de novo pega o texto atual; Duplicar tira um novo.
- **Push**: `ItemPush.aplicacao` (até 1.000; ausente = sem aplicação). **API** (`receber` e `PUT` do orçamento): grava `retratoAplicacao(texto, true, parâmetro atual)` em `pedido_item.aplicacao` (0033), nunca recusa por tamanho e nunca troca pelo cadastro.
- **Saídas**: `OrderItem.application` no detalhe e no pull (`PedidoItemSync.aplicacao`); "Aplicação: …" abaixo da descrição no detalhe (Campo e BKO) e nos dois PDFs (`domain/pdf-pedido.ts`); `vendedor.pedido.aprovado@1` leva `itens[].aplicacao` (aditivo) para o Hub.

## Detalhe do pedido e do orçamento, histórico em tags e cancelamento integrado (T-0138)

- **Ordem da tela** (Campo, Gestão; spec `docs/design/pedido-v2.md` §4): cabeçalho (voltar, ⋮, número com a tag, cliente com código, vendedor) → itens (8 primeiros e "Ver os N itens") → total separado com "forma · prazo · frete" → histórico → `RodapeAcoes`. Parte pura em `app/lib/detalhe-pedido.ts` (`acoesDoDetalhe`: 1 principal, ícones, menu ⋮) e `domain/historico-pedido.ts` (`eventosDoPedido`, `eventosDoOrcamento`), a mesma para o BKO (`order-drawer.tsx` usa `HistoricoEmTags` do kit web).
- **Histórico (RN-VEN-30)**: só tags do kit (`tagsDoHistorico`); nunca "Recebido pelo servidor" (`orderNote` e `motivoDoEvento` o tiram); motivo só no Rejeitado e no Cancelado; autor só quando não é o vendedor nem um sistema (`aparelho`, `ERP`).
- **Cancelamento integrado (RN-VEN-31, T-0114)**: `orderActions(status, { erpAceitaCancelamento })`. Com o aceite, enviado/integrado (não faturado) cancela no Macuxi, não edita, e o texto é `MSG_ENVIADO_NAO_EDITA` (nunca "cancele no ERP"). O aceite chega pelo pull: `PedidoSyncSchema.erp_aceita_cancelamento` (opcional), marcado só nos enviados/integrados da página por UMA consulta `integracao.cancelamento_erp@1` com `{ licenca: 'tenant' }` (`api/sync.ts`, `marcarAceiteDeCancelamento`). Mudança da configuração do conector só chega ao aparelho na próxima atualização da linha; a API revalida no cancelar.
- **"Equivale a" no PDF (RN-CAT-09/10, T-0085 §5)**: `equivaleAHtml` (`domain/pdf-pedido.ts`); PDF interno sempre, PDF do cliente só com `referencia_no_orcamento`. As referências vêm de `catalogo.textos_produto@1` na hora de gerar (`referenciasDeProdutos`), não são retrato do pedido.
- **`vendedor.pedido.criado@1` ganhou `emitido_em`** (aditivo, opcional): `emitidoEm(criado_no_aparelho, recebido_em)` = hora do aparelho LIMITADA (nunca no futuro, no máximo 7 dias antes do recebimento). `vendedor.pedidos_da_meta@1` devolve o mesmo valor (`EMITIDO_EM_SQL`), então Core e Gestor apuram o mesmo mês.

## T-0151 (10/11/2026): alçada só ao salvar, máximo do produto e preço salvo
- **Alçada (RN-VEN-10):** não aparece no Venda, no Resumo, na caixa de %, sob o botão nem no detalhe. Ao salvar o **pedido** acima da alçada do autor (a do gestor no pedido em nome), o app pergunta "Desconto acima da sua alçada. Enviar para aprovação?" (Enviar para aprovação / Voltar; `perguntaDaAlcada` em `domain/botoes-resumo.ts`). Orçamento e Apenas salvar não perguntam. O Transformar do detalhe pergunta do mesmo jeito.
- **Máximo do produto (RN-VEN-11):** item com desconto acima do máximo bloqueia "Salvar e enviar pedido" e "Transformar"; só "Salvar como orçamento" fica, com o motivo numa linha ("AGU-1500 acima do desconto máximo", `motivoDoMaximo`). A API recusa com `preco_abaixo_minimo` e a frase "Desconto acima do máximo: AGU-1500" (`mensagemAcimaDoMaximo`). O aparelho só trava offline quando o sync do produto traz `preco_venda_cents` e `desconto_maximo_pct` (pedido ao modulo-core); sem eles, quem recusa é a API.
- **Preço salvo (RN-VEN-18):** editar ou corrigir pedido (ou orçamento) mantém o preço de tabela salvo em cada item; só o item novo entra pelo preço do dia; sem faixa de "preços atualizados". Duplicar continua nos preços de hoje.
- **Números iguais:** o rótulo "Desconto X%" do detalhe e do PDF sai de tabela × total (`descontoDoPedidoPct`, RN-VEN-03), nunca do % digitado; a medida do item (FD, CX…) vai sempre na exibição.
