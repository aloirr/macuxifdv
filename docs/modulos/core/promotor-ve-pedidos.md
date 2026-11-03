# Opção `promotor_ve_pedidos` do perfil Promotor (T-0061, complemento do Core)

Pedido do dono do produto. **Regras**: RN-CORE-01 (licença/opção avaliada a cada requisição, sem cache em JWT/sessão), RN-PRO-01 (promotor só lê pedido; **esta opção só controla a leitura**; criar, editar, cancelar, duplicar e excluir continuam sempre negados, UI e API), RN-AUD-01 (auditoria).

## Onde mora o valor (sem migração)
`plataforma.parametro` (RLS por tenant): `modulo = 'core'`, `chave = 'promotor_ve_pedidos'`, `valor` = JSON booleano. **Ausência de registro, registro removido ou valor inválido = LIGADO.** Só o booleano `false` desliga.

## Nomes finais
| O quê | Nome |
|---|---|
| Parâmetro | `core/promotor_ve_pedidos` (`PARAMETRO_PROMOTOR_VE_PEDIDOS`, padrão `PROMOTOR_VE_PEDIDOS_PADRAO = true`) |
| Consulta entre módulos | `core.promotor_ve_pedidos@1` (`CONSULTA_PROMOTOR_VE_PEDIDOS`): entrada `{}` (strict), saída `{ ligado: boolean }` do tenant da requisição. Lida do banco na transação de quem pergunta, a cada chamada |
| Rotas do BKO | `GET` e `PUT /v1/core/parametros/promotor-ve-pedidos` (corpo `{ ligado: boolean }`), ação `parametro.promotor_ve_pedidos`, **só admin** (outro perfil = 403) |
| Auditoria | `plataforma.auditoria`, ação `parametro.promotor_ve_pedidos`, entidade `parametro`: `antes: { promotor_ve_pedidos }`, `depois: { promotor_ve_pedidos }`, usuário e `request_id`. Só quando o valor muda; repetir o mesmo valor é idempotente (sem nova linha, sem auditoria) |
| App offline | pull da entidade `parametro` (lista fixa: `checkin.raio_m` e `promotor_ve_pedidos`). `promotorVePedidosDasLinhas(await motor.linhas('parametro'))` (em `modules/core/contracts`, para o Vendedor usar sem importar o domain) |
| Domain | `domain/promotor-pedidos.ts`: `promotorVePedidos`, `promotorVePedidosDasLinhas`, `perfilPodeVerPedidos`, `perfilPodeEscreverPedido` (RN-PRO-01), `pedidosVisiveisNoAparelho(perfil, linhas)`, `filtrarExtensoesDePedido(itens, verPedidos)` |

## O que o Core faz
- **Cliente 360 no app** (offline, `telas/cliente.tsx`, `components/cliente360.tsx`, `lib/cliente360-local.ts`): promotor com a opção desligada não vê "Compras dos últimos 12 meses" (histórico e contagem de pedidos), nem "Última compra", "Ticket médio", "Compras em 12 meses" e "Frequência média" (derivados dos pedidos). `montarCliente360Local(..., { verPedidos })` já devolve histórico vazio e resumo zerado, com `pedidos_visiveis: false`. Financeiro e contatos não mudam. Vendedor, gestor e demais perfis: nada muda.
- **Extensões montadas pelo Core** (`cliente.abas`, `cliente.acoes`): saem as que têm ação `pedido.*`/`pedido_item.*` ou `payload.mostraPedidos === true` (campo opcional novo em `AbaCliente` e `AcaoCliente`, aditivo). Quem registra uma aba de pedidos para o promotor (ex.: "Últimos pedidos" com `pedido.ver`) é filtrado pelo Core sem editar o Vendedor.
- **BKO**: seção "Opções do perfil Promotor" na tela "Usuários e módulos", nível Perfil › Promotor (`web/components/licencas/promotor-pedidos-panel.tsx`). testIDs: `promotor-pedidos.painel`, `promotor-pedidos.toggle` (role=switch), `promotor-pedidos.estado` (`data-estado` ligado|desligado). O Cliente 360 do BKO não mostra a lista de pedidos do Vendedor; o admin não é afetado.

## O que o Vendedor faz (recado R-20261103-005210-modulo-core)
Declarar `usaConsultas: ['core.promotor_ve_pedidos@1']`; na API, negar a leitura de pedido ao promotor com `ligado: false`; no app, esconder aba/seção de pedidos do promotor.

## Testes
`domain/promotor-pedidos.test.ts` · `contracts/promotor-pedidos.test.ts` · `app/lib/pedidos-visiveis.test.ts` · `api/promotor-pedidos.db.test.ts` (Postgres: padrão ligado, tenant A desliga e B continua ligado, admin do B não altera o A, auditoria antes/depois, consulta na requisição seguinte, idempotência, pull do parâmetro, 403 para não admin).
