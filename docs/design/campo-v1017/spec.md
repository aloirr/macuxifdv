# Campo v1.0.17: sino padrão, altura do cabeçalho, hora da sincronização e filtros

> 2026-11-20 · designer-ux · teste de campo do Campo v1.0.16, recado R-20261120-055304 do dono do produto (20/11/2026, ~05h50 de
> Manaus); título da Rota confirmado em R-20261120-055501. Destinatários: **modulo-core** (Início, Rota, Clientes),
> **modulo-catalogo** (Catálogo), **engenheiro-apps** (sino do shell, Mais e Perfil) e, pelo item 6, **modulo-vendedor**
> (Pedidos). Kit: `packages/ui/src/mobile` (`sino.ts`, `sino-rn.tsx`, `cabecalho.ts`, `ui.tsx`, `tokens.ts`, `theme.ts`).
> Regras do kit em `docs/design/componentes.md` §5 (listas), §5.2, §5.4 e §5.5 e em `filtro-padrao-campo/spec.md` §0.
>
> Os itens 3, 4, 8, 9–14 e 16–22 do recado não foram lidos nesta sessão (o repositório de recados respondeu 403). Ficam para
> quando o texto do recado for anexado; nada foi inventado para eles.

## 0. O que vale para todas as telas
| Item | Regra | Peça do kit |
|---|---|---|
| 1 · frase do Início | Sem mudança visual até a aprovação do dono do produto (exceção à marca e proposta em `componentes.md` §5.5). | `type.fraseInicio`, `colors.faixaFrase`, `LINHAS_FRASE_INICIO` |
| 2 · sino | O mesmo sino em todas as telas, o que a Rota mostra hoje: `componentes.md` §5.4. | `SinoNotificacoes` |
| 5 · altura | A faixa Azul noite tem a altura do painel do Início em todas as telas: `componentes.md` §5.2. | `ALTURA_CABECALHO`, `alturaMinimaCabecalho` (já no `CabecalhoTela`) |
| 6 · hora da sincronização | Só no Início, junto do Sincronizar: `componentes.md` §5 (listas). | o `direita` do `CabecalhoTela` sem `SeloAtualizacao` |
| 7 · filtros | Ver `filtro-padrao-campo/spec.md` §0. | `BotaoFiltro`, `FolhaFiltro`, `EtiquetaFiltro` |

## 1. Início (`modules/core/app/telas/inicio/tela-inicio-campo.tsx`, modulo-core; sino do shell, engenheiro-apps)
- **Sino (2):** o mesmo `SinoNotificacoes` das outras telas, vindo do `ProvedorSinoCabecalho`. Sai o ajuste próprio do Início
  (`sinoBox` com `marginVertical: -10` e `linhaSaudacao` com `marginRight: -12`): o sino fica à direita da `linhaTopo`,
  centralizado na altura da foto, na posição de `componentes.md` §5.4, como na Rota. A saudação continua encolhendo até 0,75.
- **Altura (5):** o painel é a referência da altura única. Na escala do celular pequeno (`escala-inicio.ts`) o painel pode ficar
  abaixo dela; as outras telas seguem a altura única.
- **Hora da sincronização (6):** fica como está, só aqui: rodapé fixo, `Sincronizar` à esquerda e "Últ. sincronização" + hora à direita.
- **Frase (1):** a tela passa a usar `type.fraseInicio` (com o `fontSize` da escala) e `numberOfLines={LINHAS_FRASE_INICIO}` no
  lugar do estilo local; a cor e o peso continuam os de hoje até o "aprovado".

## 2. Rota (`modules/core/app/telas/rota.tsx` e `modules/core/app/index.ts`, modulo-core)
- **Título:** só `Rota` (R-20261120-055501), em qualquer dia e com qualquer filtro; a data fica só na etiqueta. Mudam o
  `tituloDaRota` e o `titulo` da página em `modules/core/app/index.ts` (hoje "Rota de hoje").
- **Sino (2):** já é o padrão; passa a ser o `SinoNotificacoes` (pelo shell).
- **Altura (5):** pelo `CabecalhoTela`; nada a fazer na tela.
- **Filtros (7):** já estão no `BotaoFiltro` (cliente, cidade, bairro e data).

## 3. Clientes (`modules/core/app/telas/clientes.tsx`, modulo-core)
- **Hora da sincronização (6):** sai o `SeloAtualizacao` do `direita` (`clientes-selo-sync`). O puxar para atualizar continua.
- **Sino (2) e altura (5):** pelo `CabecalhoTela`.
- **Filtros (7):** a busca por nome ou código entra na folha "Filtrar" como grupo **Cliente** (o mesmo da Rota); a linha de cima
  fica só com o `BotaoFiltro` à direita. Busca ativa vira etiqueta (`"Raimundo" ✕`). A situação já está na folha.

## 4. Catálogo (`modules/catalogo/app/telas/catalogo.tsx`, modulo-catalogo)
- **Hora da sincronização (6):** sai o `SeloAtualizacao` do `direita` (`catalogo-selo-sync`). O estado vazio "O catálogo ainda não
  está no aparelho" continua com a ação `Sincronizar`.
- **Sino (2) e altura (5):** pelo `CabecalhoTela`.
- **Filtros (7):** a `CampoBusca` fica na tela (a exceção). As linhas de chips de sistema e de categoria (`catalogo-chips-sistema`,
  `catalogo-chips-categoria`) entram na folha "Filtrar" como grupos **Sistema** e **Categoria**, junto da filial; o que estiver
  ativo vira `EtiquetaFiltro`.

## 5. Mais (`apps/mobile/src/app/(tabs)/mais.tsx`, engenheiro-apps)
- **Sino (2) e altura (5):** pelo `CabecalhoTela` (`<Screen cabecalho={{ titulo: 'Mais' }}>`).
- Sem hora da sincronização e sem filtro na tela.

## 6. Perfil (`apps/mobile/src/app/profile.tsx`, engenheiro-apps)
- **Sino (2) e altura (5):** pelo `CabecalhoTela`, com o voltar `‹ Início` dentro da faixa; voltar e título cabem na altura única.
- Sem hora da sincronização no cabeçalho; o puxar para atualizar continua.

## 7. Pedidos (`modules/vendedor/app/screens/orders-screen.tsx`, modulo-vendedor), pelos itens 6 e 7
- Sai o `SeloAtualizacao` do `direita` (`orders-selo-sync`). Os estados "Atualizando…" e "Sem resposta" da consulta ao servidor
  precisam de outro lugar: entram na área Alertas da tela quando pedem ação (RN-VEN-42). A busca e os chips de situação entram
  na folha "Filtrar".
- Outras telas do Campo com o selo no cabeçalho (ex.: `modules/treinamento/app/screens/treinar-screen.tsx`) seguem a mesma regra.

## 8. Para o engenheiro-apps: sino no shell (RD-2450, no lote do build)
`apps/mobile/src/components/sino.tsx` passa a desenhar o `SinoNotificacoes` do kit (`total`, `onPress` que abre o balão,
`sobreFaixa`); o balão, a contagem (`ProvedorContagemSino`) e a navegação continuam no shell. `coresDoSino`, `leituraDoSino` e
`temNovoNoSino` de `apps/mobile/src/lib/sino.ts` passam a vir do kit, com os mesmos nomes, e as cópias do shell saem.
