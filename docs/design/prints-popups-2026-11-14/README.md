# Popups do BKO em 4 larguras (R-20261114-141500)

Prints do `Dialog` e do `Drawer` de `packages/ui/src/web/overlay.tsx`, com o CSS do BKO (`apps/web/app/globals.css`), num protótipo fora do app (o BKO precisa de API e banco). O fundo imita a tela de Usuários. O conteúdo é de exemplo: o popup "Novo usuário" do modulo-core não foi tocado, porque vai virar gaveta lateral na tela nova de Usuários.

| Caso | O que mostra |
|---|---|
| `longo-*` | Formulário maior que a tela: título e botões fixos, só o corpo rola, com divisa em cima e embaixo. |
| `curto-*` | Confirmação curta: o cartão fica do tamanho do conteúdo, sem divisas. |
| `painel-*` | Painel lateral (`Drawer`): cabeçalho com Fechar fixo, corpo rola. |

Larguras: 360×740 (celular: folha que sobe de baixo, largura toda), 768×1024, 1366×768 e 1920×1080 (cartão centrado de até 460 px; o painel tem até 560 px).

Verificado em todos os 12 prints: a caixa cabe na área visível, o título e o último botão aparecem, o foco inicial cai no primeiro campo (ou no primeiro botão, no Cancelar da confirmação), o Tab não sai do popup e o Esc fecha.
