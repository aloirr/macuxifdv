# Parecer de marca: perfis sem "perfil base", permissões numa tabela (24/11/2026)

> design-de-marca · 24/11/2026 (Manaus) · item 12 de R-20261124-094327.
> Entrega do designer-ux: SHA `540c880bd4a31e9d5ecf7bdf1c9ef38a47c56279` (branch `nuvem/v1034-usuarios-designer-ux-3`),
> `docs/design/simulacoes/2026-11-24/perfis-tabela-{atual,vendedor,admin,colunas}-1366.png` e `perfis-tabela.md`.
> Base: `docs/marca/manual.md` §3 (paleta e contraste) e a revisão geral de 24/11 (`2026-11-24-revisao-geral.md`).
> Conferência pelos pixels dos prints (cores exatas), não a olho.

## Parecer: **VALIDADO** (sem ajuste de marca)

Só o Alexandre aprova a marca; este parecer diz que a simulação não fere o manual.

## O que foi conferido

| Elemento | Cor medida no print | Manual §3 | Resultado |
|---|---|---|---|
| Caixa marcada (linha e grupo, inclusive o traço de "parte") | `#1E3350` com ✓ branco (12,77:1) | Azul noite: destaque de controle, aba ativa | ok |
| Caixa vazia livre | borda `#7A8593` no branco (3,75:1) | Campo: borda de caixa de marcar | ok |
| Caixa travada vazia | fundo `#ECEEF1`, borda `#C9CED5` | Névoa: desabilitado | ok |
| Caixa travada marcada (Admin, autogestão) | `#8B96A3` com ✓ branco (3,00:1) | Cinza série: desabilitado do BKO | ok (no mínimo de ícone; ver observação 1) |
| Rótulo e motivo da linha travada | `#4A5562` no branco (7,59:1) | texto secundário | ok |
| Rótulo da linha livre | `#16202A` | Grafite: texto principal | ok |
| Cadeados | `#4A5562` | texto secundário, sem cor de situação | ok |
| Selo "Sem licença" (Treinamento) | texto `#7A4F00` no `#FFF1D6` | aviso: só situação, sempre com texto | ok: é situação que pede ação ("Ative o módulo…") |
| Aviso de autogestão no topo (Admin) | Névoa `#ECEEF1` com cadeado e texto | chip neutro | ok: neutro, uma vez só, sem âmbar |
| Nível de Dados, opção ativa | `#1E3350` com texto branco | aba ativa | ok |
| Cabeçalho de grupo e fundo | Pérola `#F8F6F1`, linhas `#DFE2E6` | fundo e linha | ok |
| "Salvar" desabilitado, "Copiar permissões de…" e "Histórico" | Névoa / contorno | botão desabilitado e secundário | ok: um só principal |
| Selo "2 usuários" / "1 usuário" | `#34404D` na Névoa (9,09:1) | chip neutro | ok |
| Variante de colunas | mesmos tokens | — | ok |

Nenhuma cor fora da paleta, nenhum "quase igual", nenhum verde de sucesso como enfeite, nenhum laranja como situação.
Isso responde ao padrão executivo da revisão geral: a tela de 141 linhas só tem uma cor de situação (o âmbar do "Sem licença"),
e o resto é Azul noite nos controles e cinzas.

## Observações (não seguram)

1. **Caixa travada marcada `#8B96A3`**: ✓ branco com 3,00:1, no limite de ícone. É o desabilitado aprovado do BKO e o
   rótulo ao lado (`#4A5562`, 7,59:1) carrega a informação. Se o código usar um cinza mais claro que `#8B96A3`, volta a ser achado.
2. **Menu lateral** nos prints (PESQUISA, TREINAMENTO e PARÂMETROS em caixa alta e Sol claro; filete da tela atual):
   são os achados MA-01 e MA-02 da revisão geral, já com o engenheiro-apps; não são desta entrega.
3. **Na implementação**, a caixa marcada vem do token do Azul noite (não `#1E3350` solto) e o selo "Sem licença" do tom
   `warning` do componente de selo. Revalido no print do BKO quando o código chegar.
