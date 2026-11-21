# Lista de Clientes · uma tag de situação e só a última visita (Campo e Gestão)

> **Tipografia substituída** pela fonte do sistema (R-20261115-110600, 15/11/2026): ver o [manual da marca §5](../marca/manual.md#5-tipografia).
> Famílias, pesos acima de 700 e tamanhos fora da escala citados abaixo ficam só como histórico.

> 2026-11-12 · designer-ux · T-0171 · Origem: R-20261112-180115-alexandre. **Aprovado** em R-20261112-204602 e -204639
> ("Vencido" vira "Devendo", tag "Pré-Cadastro", filtro "Devendo"); regra RN-CORE-41. Imagens:
> `docs/design/telas/T-0171-clientes-antes.png`, `T-0171-clientes-depois.png` (Campo) e `T-0171-clientes-gestao.png` (Gestão,
> com o filtro "Devendo" ligado). Fonte: `T-0171-clientes.html` (`?v=antes|depois|gestao`), aparelho de 412 dp, na marca v1
> (faixa Azul noite, T-0172).

Tela: `modules/core/app/telas/clientes.tsx`, a mesma no Campo e no Gestão (`apps: ['campo', 'gestao']`). Vale para
`LinhaLocal` (lista do aparelho) e `CustomerRow` (carga antiga). Se a carga antiga não tiver mais uso, o modulo-core decide se
ela sai.

## 1. A linha
Ordem, da esquerda para a direita:

| Posição | O que aparece | Como |
|---|---|---|
| 1ª linha | nome do cliente (fantasia; sem fantasia, a razão social) | `t.bodyStrong` (16 px, fonte do sistema, 600), 1 linha, reticências |
| 2ª linha | a última visita | `t.sub` (13 px, `ink2`), 1 linha, sem cor e sem ícone |
| Direita | a tag de situação | `ChipEstado pequeno` (24 dp) |
| Fim | seta | `Icon chevron` 16, `ink3` |

- Altura mínima de 64 dp; a linha toda é o alvo de toque e abre a ficha (`abrirCliente`), como hoje.
- Leitor de tela: `"<nome>, <tag>, <última visita>"` (ex.: "Mercadinho São Jorge, Devendo, Visitado ontem").
- **Nada mais na linha.** Saem: cidade, segmento, bairro, compra média, "N vencidos", "N dias sem compra", "Nunca comprou",
  "Não positivado", "Curva A" e a etiqueta "Cadastro incompleto".

## 2. A tag de situação (um valor só)
Prioridade: **Bloqueado > Devendo > Pré-Cadastro > Em dia** (RN-CORE-41). Mostra só o primeiro que valer.

| Valor | Quando | Tom do `ChipEstado` |
|---|---|---|
| `Bloqueado` | cliente bloqueado (`bloqueado`) | `erro`, com `icone="lock"` |
| `Devendo` | 1 ou mais títulos vencidos (`vencidos_qtd > 0`) e não bloqueado | `erro` |
| `Pré-Cadastro` | cadastrado no app ou no BKO e ainda sem o código do ERP; sai quando o ERP devolve o cadastro | `neutro` (`neutralInk` #34404D sobre `neutralBg` #ECEEF1, 9,09:1) |
| `Em dia` | nenhum dos anteriores | `sucesso` |

- Sem número na tag ("Devendo", não "2 vencidos"). A quantidade e o valor ficam na ficha do cliente.
- Pré-Cadastro em tom neutro, sem ícone: não é erro nem sucesso. O tom passa pelo parecer do design-de-marca
  (R-20261112-204602, item 3).
- Contraste: `danger` #A8261B sobre `dangerBg` #FDE8E6 e `success` #1D6B4F sobre `successBg` #E2F1EA, ambos acima de 4,5:1.

- Cadastro incompleto não é valor da tag (§1, "Saem"): segue na ficha (`EtiquetaCadastroIncompleto`, `ObservacoesCliente`) e
  nas pendências do pedido, sem filtro próprio (R-20261112-204602, item 6).

## 3. A última visita
| Caso | Texto |
|---|---|
| check-in hoje (inclusive o atendimento em aberto) | `Visitado hoje` |
| check-in ontem | `Visitado ontem` |
| 2 dias ou mais | `Visitado há N dias` (ex.: `Visitado há 42 dias`, `Visitado há 200 dias`) |
| nenhum check-in | `Nunca visitado` |

- Origem: a data do último check-in do cliente (feito no aparelho ou recebido no sync). Funciona offline: um check-in feito
  agora já muda a linha para "Visitado hoje".
- Dias em dias de calendário, no fuso do tenant (meia-noite do tenant vira o dia).
- Campo: a última visita do cliente, de qualquer vendedor que o atende. Gestão: a mesma regra, sobre a carteira da equipe.
- Sem cor e sem alerta por tempo sem visita: a linha só informa. O dado vem do modulo-core (pedido do dono no recado de
  origem).

## 4. Topo e filtros
- Faixa Azul noite (`<Screen cabecalho>`, `componentes.md` §5.2): título `Clientes`, contagem abaixo ("86 na carteira" / "12 de
  86 na carteira").
- Busca na tela, com o placeholder "Código, CNPJ ou nome" (v1.0.17), e os 3 filtros dentro do `BotaoFiltro`
  (`filtro-padrao-campo/spec.md` §0 e §3): **"Devendo"** (era "Com título vencido", R-20261112-204639; o mesmo nome no atalho
  que abre a lista já filtrada), "Sem compra 45+ dias" e "Bloqueados".
- A informação que saiu da linha vive nos filtros e na ficha. Vazio: sem mudança ("Nenhum cliente com esses filtros").

## 5. Componentes
`ChipEstado` (tons `erro`, `neutro` e `sucesso`, `pequeno`, `icone="lock"`), `Icon`, `t.bodyStrong`, `t.sub`, `Screen` com
`cabecalho`, todos de `@macuxi/ui/mobile`. Nenhum componente novo.
