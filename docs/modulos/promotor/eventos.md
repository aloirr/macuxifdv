# Promotor — eventos publicados (`promotor.*@1`)

> T-0040. Schemas: `modules/promotor/contracts/eventos.ts` (Zod, `.strict()`, tipos `z.infer` exportados).
> Emissão: `modules/promotor/domain/eventos.ts`. Registro oficial dos nomes: `.coord/contratos/eventos.md` (dono: engenheiro-software).

## Regras comuns
- **Payload completo**: toda chave é obrigatória; o que não se aplica vai como `null` explícito. Sem `default` e sem `transform` (o tipo de entrada é igual ao de saída).
- **Estrito**: chave a mais é recusada. Só ids (UUID), códigos, números e instantes — nada de texto livre, nome, documento ou endereço (sem dado pessoal no evento).
- Instantes em UTC (`...Z`); dinheiro em centavos inteiros; percentuais com 2 casas.
- `tenant_id`, `evento_id` (idempotência) e `ocorrido_em` vêm do envelope do platform-sdk, não do payload.
- **Números derivados são revalidados** com as funções do `domain` (permanência RN-PRO-07, share/atingimento RN-PRO-03, preço efetivo/índice RN-PRO-04, quantidade reposta RN-PRO-05, foto da fachada RN-PRO-06): conta que não fecha = evento não publicado.
- **Emissão**: `montarEventoPromotor(nome, payload)` valida com o schema e devolve `{ nome, payload }` congelado; inválido lança `ErroPayloadEvento` (`evento`, `problemas: ['campo: mensagem']`) e não devolve nada. Montadores por coleta: `eventoVisitaLojaConcluida`, `eventoGondolaRegistrada`, `eventoShareMedido`, `eventoPrecoColetado`, `eventoRupturaRegistrada`, `eventoTarefaConcluida`. Na API, montar o evento **na mesma transação** que grava a coleta (outbox, ADR 0007): se falhar, a escrita é recusada junto.
- **Versão**: tirar/renomear campo, mudar tipo ou vocabulário, ou campo novo obrigatório = `@2` + ADR; campo novo opcional (anulável) pode continuar `@1` com recado aos consumidores. `contracts/eventos.test.ts` congela o formato de cada `@1` (tipo exato no `typecheck` e lista de chaves no teste).
- RN-PRO-01: nenhum evento do Promotor fala de pedido (teste).

## Tabela dos eventos

| Evento | Quando | Campos (todos obrigatórios; `?` = anulável) | Quem consome |
|---|---|---|---|
| `promotor.visita_loja.concluida@1` (`VisitaLojaConcluidaV1`) | checkout da visita de loja | `visita_loja_id`, `visita_id` (visita do Core), `promotor_id`, `cliente_id`, `checklist_modelo_id?`, `checkin_em`, `checkout_em`, `permanencia_min` (RN-PRO-07), `desfecho` (`realizada` \| `loja_fechada` \| `acesso_negado`), `foto_fachada_id?` (obrigatória em loja fechada/acesso negado, RN-PRO-06), `fotos_total`, `fotos_sem_gps` (≤ total, RN-PRO-02) | gestor |
| `promotor.gondola.registrada@1` (`GondolaRegistradaV1`) | registro de gôndola (RF-PRO-03) | `gondola_id`, `visita_loja_id`, `promotor_id`, `cliente_id`, `categoria_gondola_id`, `conformidade` (`conforme` \| `parcial` \| `nao_conforme`), `foto_antes_id`, `foto_depois_id` (≠ antes), `foto_referencia_id?`, `registrado_em`. O motivo (texto livre) fica só na coleta | gestor |
| `promotor.share.medido@1` (`ShareMedidoV1`) | medição de share por categoria (RF-PRO-04) | `medicao_id`, `visita_loja_id`, `promotor_id`, `cliente_id`, `categoria_gondola_id`, `frentes_nossas`, `frentes_total`, `cm_nossos?`, `cm_total?`, `share_pct?` (RN-PRO-03; nulo sem frentes), `meta_share_id?` e `meta_pct?` (juntos, RN-PRO-10), `atingimento_pct?`, `medido_em` | gestor |
| `promotor.preco.coletado@1` (`PrecoColetadoV1`) | coleta de preço (RF-PRO-05) | `coleta_id`, `visita_loja_id`, `promotor_id`, `cliente_id`, `produto_id`, `concorrente_id?`, `produto_concorrente_id?` (nulo = nosso item), `preco_cents`, `em_promocao`, `em_encarte`, `preco_promocional_cents?`, `preco_efetivo_cents` (RN-PRO-04), `preco_nosso_ref_cents?`, `indice_preco?` (só na linha do concorrente com referência), `variacao_confirmada`, `coletado_em` | gestor |
| `promotor.ruptura.registrada@1` (`RupturaRegistradaV1`) | **cada** item do mix obrigatório conferido, inclusive `presente` (RF-PRO-06) | `registro_id`, `visita_loja_id`, `promotor_id`, `cliente_id`, `produto_id`, `mix_obrigatorio_id` (RN-PRO-10), `status` (`presente` \| `ruptura_gondola` \| `ruptura_total`, RN-PRO-05), `quantidade_reposta` (0 em ruptura total), `registrado_em` | gestor (% ruptura e falha de reposição); vendedor (alerta ao vendedor responsável, P1 — só `STATUS_RUPTURA_COM_ALERTA` = `ruptura_gondola`, `ruptura_total`; `rupturaGeraAlerta`) |
| `promotor.tarefa.concluida@1` (`TarefaConcluidaV1`) | conclusão de tarefa de campanha numa loja (RF-PRO-10) | `execucao_id` (execução nesta loja), `tarefa_id` (tarefa de trade do BKO), `visita_loja_id`, `promotor_id`, `cliente_id`, `fotos_total` (≥ 1), `concluida_em` | gestor |

## Compatibilidade com o espelho do Gestor
O Gestor lê estes eventos por um espelho próprio (`modules/gestor/contracts/eventos-consumidos.ts`, T-0014). O contrato oficial é **superconjunto** dos campos do espelho (teste em `contracts/eventos.test.ts`), com duas diferenças avisadas por recado ao `modulo-gestor` na T-0040:
1. `desfecho` usa o vocabulário do domain do Promotor (`realizada`, `loja_fechada`, `acesso_negado`); o espelho espera `concluida` / `nao_finalizada`.
2. `tarefa_id` é a tarefa de trade (campanha); a mesma tarefa pode ser concluída em várias lojas — a chave do fato é `execucao_id`.
