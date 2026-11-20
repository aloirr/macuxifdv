# Pontos de extensão

> Dono: engenheiro-software. O tipo do slot fica em `contracts` do módulo que oferece.
> Slots do core: tipos em `modules/core/contracts/extensoes.ts` (`AbaCliente`, `AcaoCliente`, `AvisoCliente`, `EtapaCheckout`, `CardInicio`, `ItemMenu`).

| Extensão | Oferece | Quem renderiza | Usado por |
|---|---|---|---|
| `cliente.abas` | core | ficha do cliente do core (app) | promotor, pesquisa, vendedor, gestor |
| `cliente.acoes` | core | rodapé da ficha / folha de check-in do core (app); desde a T-0076 o rodapé mostra só a ação com `destaque: true` ("+ Novo pedido"), ao lado do Visitado | vendedor (o `ver-catalogo` do Catálogo saiu na T-0076); **T-0187**: item `novo-pedido-em-nome` do Vendedor, rótulo "Novo pedido", `apps: ['gestao']`, `destaque: true`, ação `pedido.criar_em_nome`; abre o pedido com `emNome: true` |
| `cliente.avisos` | core (T-0102, aditivo, 08/11) | ficha do cliente do core (app, Campo e Gestão): abaixo do cabeçalho, acima das abas/ações; o componente recebe `{ contexto: ContextoCliente }` e devolve `null` sem aviso (offline, só o aparelho) | gestor `etapa-pendente-equipe` (`AvisoEtapaEquipe`, `apps: ['gestao']`, ação `painel_equipe.ver`) |
| `visita.etapas_checkout` | core | folha de checkout do core (app); RN-CORE-12 | pesquisa, promotor, vendedor (motivo de não-venda) |
| `inicio.cards` | core | shell: Início do app (`apps/mobile/src/components/extensoes-shell.tsx`) | todos, por `ordem` (menor primeiro; ausente = 100): gestor "Pedidos para aprovar" (10, Gestão), vendedor `pedidos-resumo` Orçamentos e A faturar (20, só Campo, ação `pedido.criar`, T-0076) |
| `menu.itens` | core | shell: Perfil do app (seção "Mais") e menu do BKO (grupo "Mais") | todos |
| `produto.acoes` | catalogo | (catálogo, T-0007+) | vendedor |
| `pedido.criar_em_nome` | vendedor | (vendedor) | gestor · contexto `ContextoPedidoEmNomeSlot` (`modules/vendedor/contracts/extensoes.ts`): `vendedor_id`, `autor_id` e, desde o v1.0.1 (aditivo, 08/11, R-20261108-210156), `vendedor_nome?` para o PDF do pedido em nome; sem o campo nada muda |
| `rota.parada_complemento` | core (T-0187, aditivo) | (core) | gestor |
| `pedido.equipe_em_nome` | vendedor (T-0187, aditivo) | (vendedor) lista "Em nome de": filtra só vendedor e tira o autor | gestor · visão da equipe em cache |

Itens só aparecem se o módulo registrante e o dono do slot forem efetivos, o perfil bater, a `acao` for permitida
(ADR 0004) e, quando o item declara `apps` (T-0029 E4), o app atual estiver na lista; caso contrário somem sem erro (RN-CORE-03).
Ex.: "Novo pedido" do Vendedor em `cliente.acoes` com `apps: ['campo']` não aparece no Gestão.

> **Sprint 1 — planejado (desenho [T-0016](../../docs/desenho/T-0016.md), aguardando OK do gerente)**
> - `cliente.abas`: o Vendedor registra a aba **Pedidos** (últimos pedidos, a partir das entidades locais `pedido`/`pedido_item`) — opcional na Sprint 1.
> - `inicio.cards`: o Core registra o card **Notificações não lidas** (T-0019).
> - `visita.etapas_checkout` passa a receber do Core, além do motivo de cliente fechado (RN-CORE-14), o `resultado` do checkout
>   (`atendido | pedido | sem_pedido | cliente_fechado`); cada etapa concluída/dispensada vai no payload do comando `visita_checkout`
>   (`etapas[]`) e vira linha de `core.visita_etapa`.

## `visita.etapas_checkout` no servidor (T-0039, contrato aditivo, revisado em 05/11)

RN-CORE-12/14 revalidadas na API: no `receber` do comando `visita_checkout` o Core chama `avaliarCheckoutNoServidor`
(`modules/core/domain/checkout-servidor.ts`). **O servidor não confia nas etapas que o aparelho diz ter cumprido**: só libera
o checkout o que o módulo dono da etapa confirma no servidor. Checkout inválido = item `rejeitado` no push (`codigo`
`RN-CORE-12`, `RN-CORE-14` ou `MOTIVO_INVALIDO`, mensagem em português), nada gravado em `core.visita`, nenhum evento.

| Consulta | Oferece | Schemas (em `modules/core/contracts/etapas-checkout.ts`) | Chamada por | Estado |
|---|---|---|---|---|
| `<modulo>.etapas_checkout@1` | cada módulo com etapa obrigatória e estado no servidor (pesquisa, promotor) | entrada `EtapasCheckoutEntradaSchema` (`visita_id`, `cliente_id`, `usuario_id`, `cliente_fechado`); saída `EtapasCheckoutSaidaSchema` (`etapas[]`: `etapa`, `rotulo`, `obrigatoria`, `concluida`; até 20) | core (`api/etapas-checkout.ts`, `verificadorPorConsulta`) | contrato publicado; **nenhum módulo oferece ainda** (`CONSULTAS_ETAPAS_CHECKOUT` vazia) |

Como um módulo entra: `definirConsulta({ nome: '<modulo>.etapas_checkout@1', entrada: EtapasCheckoutEntradaSchema, saida: EtapasCheckoutSaidaSchema })`
nos `contracts` do próprio módulo (importando os schemas de `modules/core/contracts`), implementação no `api`, nome em
`ofereceConsultas` do manifesto; depois **recado ao modulo-core** para incluir a definição em `CONSULTAS_ETAPAS_CHECKOUT` e em
`usaConsultasOpcionais` do manifesto do Core. O id `etapa` é o mesmo do item do slot no app (`pesquisa.preco`) e vira
`core.visita_etapa.etapa`.

Regras do Core sobre a resposta: módulo desligado no tenant/usuário (`ConsultaIndisponivel`) = sem etapa daquele módulo;
saída fora do schema = erro (500, não libera); `cliente_fechado` (RN-CORE-14) dispensa as obrigatórias e grava `dispensada`.
Etapas informadas pelo aparelho de módulo sem a consulta continuam gravadas em `core.visita_etapa` só como registro
informativo e **não liberam nada**. Até a primeira consulta publicada valem só as regras do Core (resultado, motivo, pedido,
foto da fachada), as mesmas da folha do app (`prepararCheckoutVisita`).
