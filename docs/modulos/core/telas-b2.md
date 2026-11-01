# Core — telas web e app (T-0001 / B2)

## Web (BKO) — `modules/core/web`
`moduloWeb` (platform-sdk `definirModuloShell`): Clientes (`/clientes`), Rotas (`/rotas`, Leaflet + 2-opt), Metas (`/metas`) e Plano de RV (`/plano-rv`, grupo cadastros).
Permissões pela ação do manifesto (`usePode`): `rota.editar`, `meta.fechar_periodo`, `plano_rv.editar`. `lib/rules.ts` mantém os `canX` da Fase M; o teste "permissões por perfil" confere que as duas visões não divergem.
A `params-page` da Fase M foi dividida: plano de RV aqui; alçadas de desconto no Vendedor.

## App (Android) — `modules/core/app`
`moduloApp`: Rota, Clientes, Metas e ficha do cliente (`/m/cliente?id=…&from=…&checkin=1`).
- Estado: armazenamento do módulo (`motor.armazenamentoDoModulo('core')`): `me` (shell), `clientes`, `rota`, `metas`, `pedidos`, `extras`, `visitas`, `visita_servidor`. Lido por `lib/estado.ts` (`ArmazemCore`) e `lib/usar-core.ts`.
- Cargas (REST da Fase M até o pull genérico da T-0004): `lib/cargas.ts` (`etapasSync`), precisam do cliente HTTP do shell (`ctx.http`, pedido ao engenheiro).
- Visitas: `lib/acoes-visita.ts` — check-in e checkout gravam no aparelho e vão pela fila (`entidade: 'visita'`; checkout = `{ visit_id, ...CheckoutVisitRequest }`).
- Check-in único, fechamento na virada do dia e volta à aba Rota após o checkout: `lib/visit.ts`, `lib/route.ts`, `components/visit-sheets.tsx`.

## Pontos de extensão oferecidos (`contracts/extensoes.ts`)
| Slot | Tela | Payload |
|---|---|---|
| `cliente.abas` | ficha do cliente | `AbaCliente` (rótulo, testID, componente com `{ contexto }`) |
| `cliente.acoes` | rodapé da ficha | `AcaoCliente` (rótulo, testID, `abrir(contexto)`) |
| `visita.etapas_checkout` | folha de checkout | `EtapaCheckout` (`obrigatoria`, `concluida(ctx)`; RN-CORE-12) |
| `inicio.cards` | Início (shell) | `CardInicio` |
| `menu.itens` | menu/Perfil | `ItemMenu` |

## Pendências
- ~~RN-CORE-12 como função de domínio com teste~~ — feito na T-0037: `prepararCheckoutVisita` em `domain/checkout.ts` (ver "Checkout — RN-CORE-12" abaixo).
- Tela "Meus módulos" (app) e licenças (BKO): T-0003 (precisam de `GET /v1/me/modulos` e da API de licenças).
- Total do pedido na fila: `pedidosDaFila` lê `payload.total_cents` (opcional) do pedido do Vendedor; sem ele a visita mostra R$ 0,00 até a sincronização.

## Checkout de cliente fechado (RN-CORE-14)
- Motivos `loja_fechada` e `acesso_negado` (lista fechada, `MOTIVOS_CLIENTE_FECHADO` em `contracts`) exigem foto da fachada e dispensam todas as etapas obrigatórias do slot `visita.etapas_checkout`.
- Regra pura: `prepararCheckoutVisita` → `avaliarCheckoutVisita` em `domain/checkout.ts` (RN-CORE-12 + RN-CORE-14). `avaliarCheckout`/`ehClienteFechado` (contrato antigo `order`/`no_order`) seguem só por compatibilidade.
- `ContextoCheckout` ganhou `clienteFechado?: boolean` e `motivoClienteFechado?` (opcionais, compatível).
- `CheckoutVisitRequest` ganhou `motivo_cliente_fechado` e `foto_fachada_ref` (a API recusa o motivo sem a foto).
- App: a folha de checkout lista os dois motivos, mostra "Tirar foto da fachada" (testIDs `checkout-foto-fachada`, `checkout-tirar-foto`) e oculta as etapas. A câmera real é registrada pelo shell via `definirCapturaFoto` (`app/lib/foto-fachada.ts`).

## Checkout — RN-CORE-12 (T-0037)
Toda a regra da folha está em `prepararCheckoutVisita` (`modules/core/domain/checkout.ts`), função pura, sem I/O e sem relógio (a regra não depende de hora; o `checkout_em` continua vindo de `agora` passado a `montarCheckout`).
- Entrada: `escolha` (`pedido` | `sem_pedido` | `atendido` | `null`), `vendedorEfetivo`, `motivo` (`{ tipo }` da lista do tenant ou `null`), `fotoFachada`, `temPedido` e `etapas` do slot `visita.etapas_checkout` já avaliadas (`modulo`, `id`, `rotulo`, `obrigatoria`, `concluida`).
- Saída: `resultado` do `CheckoutVisitaSchema`, `pode`, `pendencias` (`resultado`, `motivo`, `pedido`, `foto_fachada` ou rótulo da etapa), `etapasPendentes` (texto "Falta concluir"), `etapasRegistro` (`concluida`/`dispensada` para o payload), `clienteFechado` e `etapasDispensadas`.
- Regras: motivo do tipo `cliente_fechado` vence a escolha (RN-CORE-14); com Vendedor efetivo, `pedido` exige o pedido da visita, `sem_pedido` exige motivo e `atendido` não vale; sem Vendedor, só `atendido`; etapa obrigatória pendente bloqueia, salvo cliente fechado.
- "Módulos ativos": o slot já lista só itens de módulos efetivos (`platform-sdk`, `extensoes.listar`), então a função recebe as etapas como vieram.
- A API (`api/visita-push.ts`) revalida com `avaliarCheckoutVisita`; as etapas de outros módulos ainda não são conferidas no servidor (desenho T-0016 §4.3).
