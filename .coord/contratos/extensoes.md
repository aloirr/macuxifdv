# Pontos de extensão

> Dono: engenheiro-software. O tipo do slot fica em `contracts` do módulo que oferece.
> Slots do core: tipos em `modules/core/contracts/extensoes.ts` (`AbaCliente`, `AcaoCliente`, `EtapaCheckout`, `CardInicio`, `ItemMenu`).

| Extensão | Oferece | Quem renderiza | Usado por |
|---|---|---|---|
| `cliente.abas` | core | ficha do cliente do core (app) | promotor, pesquisa, vendedor, gestor |
| `cliente.acoes` | core | rodapé da ficha / folha de check-in do core (app) | vendedor |
| `visita.etapas_checkout` | core | folha de checkout do core (app); RN-CORE-12 | pesquisa, promotor, vendedor (motivo de não-venda) |
| `inicio.cards` | core | shell: Início do app (`apps/mobile/src/components/extensoes-shell.tsx`) | todos (ex.: core "em atendimento", promotor tarefas do dia) |
| `menu.itens` | core | shell: Perfil do app (seção "Mais") e menu do BKO (grupo "Mais") | todos |
| `produto.acoes` | catalogo | (catálogo, T-0007+) | vendedor |
| `pedido.criar_em_nome` | vendedor | (vendedor) | gestor |

Itens só aparecem se o módulo registrante e o dono do slot forem efetivos, o perfil bater e a `acao` for permitida
(ADR 0004); caso contrário somem sem erro (RN-CORE-03).

> **Sprint 1 — planejado (desenho [T-0016](../../docs/desenho/T-0016.md), aguardando OK do gerente)**
> - `cliente.abas`: o Vendedor registra a aba **Pedidos** (últimos pedidos, a partir das entidades locais `pedido`/`pedido_item`) — opcional na Sprint 1.
> - `inicio.cards`: o Core registra o card **Notificações não lidas** (T-0019).
> - `visita.etapas_checkout` passa a receber do Core, além do motivo de cliente fechado (RN-CORE-14), o `resultado` do checkout
>   (`atendido | pedido | sem_pedido | cliente_fechado`); cada etapa concluída/dispensada vai no payload do comando `visita_checkout`
>   (`etapas[]`) e vira linha de `core.visita_etapa`.
> - **`visita.etapas_checkout` no servidor** (planejado, sem data): cada módulo com etapa obrigatória com estado no servidor
>   (Pesquisa, Promotor) expõe por contrato a verificação da própria etapa, e o Core a chama no `receber` do `visita_checkout`
>   (RN-CORE-12 revalidada na API). Entra com a primeira etapa real; tipo em `modules/core/contracts/extensoes.ts`.
