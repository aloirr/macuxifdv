# Catálogo do Campo: busca sem resultado (T-0052)

> 2026-11-05 · designer-ux · pedido R-20261105-152728 (modulo-catalogo) · tela `modules/catalogo/app/telas/catalogo.tsx`
> Contexto: em catálogo com mais de 5.000 produtos (`LIMIAR_SEM_VARREDURA`), a busca no aparelho não varre mais o catálogo
> quando nada casa no índice, nem pelo começo da palavra. Ela fica menos tolerante a erro de digitação. A tela não precisa
> saber o tamanho do catálogo: o texto abaixo serve para catálogo pequeno e grande e já empurra a pessoa para o que funciona
> no índice (grafia, código, começo do nome).

## Componente
`EstadoVazio` de `@macuxi/ui/mobile` no lugar do `Empty` quando há busca (`consulta` preenchida) e a lista veio vazia.
- `icone="search"` (círculo cinza, ícone `colors.ink2`);
- título em `colors.ink` e apoio em `colors.ink2` (estilos do próprio `EstadoVazio`; nada escrito à mão);
- ação = `Botao` secundário de 44 px (o padrão do `EstadoVazio`). A tela do Catálogo não tem botão principal; não há conflito;
- `testID="catalogo-vazio"` (a ação fica `catalogo-vazio-acao`);
- o `Banner` de aviso (sem internet ou busca inteligente indisponível) continua **acima**, como hoje. O vazio não repete o
  que o Banner já diz.

## Título (igual em todos os casos)
`Nada encontrado para "{consulta}"`
- `{consulta}` é o texto buscado, sem espaços nas pontas. Acima de 30 caracteres, corte em 29 e ponha "…".
- Sem ponto final.

## Apoio e ação: escolha o primeiro caso que vale
| # | Quando | Apoio (texto exato) | Ação (rótulo · o que faz) |
|---|---|---|---|
| 1 | Há chip ligado (`linha`, `marca` ou `soComEstoque`) | `Há filtro ligado. Tire o filtro para procurar em todo o catálogo.` | `Limpar filtros` · desliga linha, marca e "Com estoque"; mantém o texto e busca de novo |
| 2 | Sem filtro e sem internet (`lista.aviso === AVISO_BUSCA_OFFLINE`) | `Confira a grafia, tente o código ou só o começo do nome. Com internet, a busca entende mais erros de digitação.` | `Limpar a busca` · apaga o texto e volta à vitrine |
| 3 | Sem filtro, dentro do pedido (`dentroDoPedido`) | `Confira a grafia, tente o código ou só o começo do nome. Aqui aparecem só os produtos que este cliente pode comprar.` | `Limpar a busca` |
| 4 | Os demais (com internet, ou busca inteligente indisponível) | `Confira a grafia, tente o código ou só o começo do nome.` | `Limpar a busca` |

Notas:
- Caso 2 dentro do pedido: vale o caso 2 (a falta de internet explica mais do que a tabela do cliente).
- "Limpar a busca" faz o mesmo que o X do campo **e** zera a consulta na hora (sem esperar os 350 ms), para a vitrine voltar já.
- Erro de digitação: o apoio começa por "Confira a grafia" porque, no catálogo grande, é a causa mais provável e a que o
  índice não perdoa. "Só o começo do nome" é o que a busca por prefixo acha ("refri" acha "Refrigerante").
- Sem internet: o Banner âmbar diz "A busca inteligente volta quando houver internet."; o apoio só acrescenta o que fazer agora
  e o porquê de tentar de novo depois.
- Nunca culpe a pessoa ("você digitou errado") e não fale de índice, FTS ou varredura.

## Sem busca (vitrine vazia)
Fica como está: `Nenhum produto neste aparelho ainda. Puxe a tela para sincronizar.`

## Conferir no APK
- catálogo de 20 mil produtos, "refrigerante" com erro ("refrijerante"): o vazio aparece rápido, com o caso 4 (ou 2 no modo avião);
- com o chip de uma linha ligado e um termo de outra linha: caso 1, e "Limpar filtros" traz o resultado;
- TalkBack lê título, apoio e o botão na ordem; texto longo quebra em até 3 linhas em tela de 360 dp.
