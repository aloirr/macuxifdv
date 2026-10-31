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
- RN-CORE-12 como função de domínio com teste (hoje a regra está na folha de checkout); motivo sem pedido só "se o Vendedor estiver ativo".
- Tela "Meus módulos" (app) e licenças (BKO): T-0003 (precisam de `GET /v1/me/modulos` e da API de licenças).
- Total do pedido na fila: `pedidosDaFila` lê `payload.total_cents` (opcional) do pedido do Vendedor; sem ele a visita mostra R$ 0,00 até a sincronização.
