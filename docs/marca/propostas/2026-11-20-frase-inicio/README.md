# Frase do Início do Campo em negrito e em outra cor (proposta, aguardando aprovação)

20/11/2026 · design-de-marca · pedido do dono do produto no teste de campo do Campo v1.0.16 (R-20261120-055304, item 1).
Print simulado (390 × 844, 2×): `frase-inicio.png` (antes · proposta · alternativa), com o `frase-inicio.html` ao lado;
gerado por `gerar.mjs`. Dados fictícios.

## O que muda
Só a frase motivacional do cabeçalho Azul noite (`#1E3350`) do Início: peso **700 (negrito)** e a cor. Tamanho 14,
itálico, aspas e até 2 linhas ficam como hoje (`docs/design/telas/inicio-cabecalho.md` §3). Hoje: `colors.faixaSub`
`#C9CED5`, peso 400.

| | Cor | Token | Contraste no `#1E3350` | Peso |
|---|---|---|---|---|
| Hoje | Texto claro na faixa `#C9CED5` | `colors.faixaSub` | 8,07:1 | 400 |
| **Proposta (recomendada)** | **Sol claro `#F59A52`** | `MARCA.solClaro` (`colors.accentLight` / `GRAFICO.sobreEscuro`) | **5,85:1** (AA, ≥ 4,5) | **700** |
| Alternativa | Branco `#FFFFFF` | `colors.faixaTitulo` | 12,77:1 | 700 |

## Por quê
- **Sol claro `#F59A52` 700 (recomendada):** o sol do logo sobre o escuro; destaca a frase, 5,85:1, nenhuma cor nova.
- **Branco `#FFFFFF` 700 (alternativa):** o maior contraste, 12,77:1; o destaque fica só no negrito.

## O que a aprovação muda no manual
Hoje o manual (§3) só deixa o Sol claro como texto no título de grupo do menu e do painel do BKO. Se a proposta for
aprovada, entra a exceção: **"e na frase motivacional do Início do Campo, em 700"**; continua proibido em item, link e
botão. O `designer-ux` aplica pelo token (sem hex solto) em `docs/design/telas/inicio-cabecalho.md` e no kit, e o
`modulo-core` na tela.
