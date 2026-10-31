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
