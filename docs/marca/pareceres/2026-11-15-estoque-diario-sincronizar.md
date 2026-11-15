# Parecer de marca · Estoque diário, parte F (v1.0.13): botão "Sincronizar" com segurar 10 s, popup da sincronização completa e hora do estoque

> 2026-11-15 · design-de-marca · decisão de origem: R-20261115-100000-alexandre (e R-20261115-121000-alexandre).
> **Base:** `origin/nuvem/estoque-diario-designer-ux` `9d059d3`: `docs/design/sincronizacao-completa.md` e `docs/design/telas/T-estoque-diario-sincronizar.html` / `.png` (print olhado), contra `docs/marca/manual.md` v1 e `decisoes.md`.
> **Sem print do aparelho:** validado pela simulação e pelo contraste calculado (WCAG). O reteste no aparelho fica para o build.
> **Recados:** a CLI de recados dá HTTP 403 nesta sessão. Os ajustes ao designer-ux ficam neste parecer e na entrega ao gerente.
> Só o Alexandre aprova a marca. Este parecer é a validação técnica antes do lote: nenhuma cor, fonte ou peça nova entra.

## Veredito: **APROVADO COM AJUSTES**
A marca está conforme no botão, na faixa de progresso, no popup e nos textos. Segura **um achado baixo** com a correção pronta (MC-0057, a cor do "Estoque desatualizado"). Corrigido, vira aprovado sem nova rodada de marca; confiro no print do build.

## Respostas às perguntas do gerente
1. **O laranja `#F59A52` como progresso no botão é coerente?** Sim. É o **Sol claro**, que o manual §3 reserva para "o sol e os gráficos sobre fundo escuro (Azul noite e grafite)". O botão Sincronizar é grafite `#16202A` (§3), a faixa é gráfico (não texto, não botão, não link) e o par dá **7,56:1** (mínimo de gráfico 3:1). É o mesmo sinal da barra da entrada (§4: preenchimento no Sol claro): o vendedor reconhece "sincronizando" pela mesma cor nas duas telas. O rótulo da contagem continua branco no grafite. Conforme.
2. **Popup claro também no Campo é coerente?** Sim. O tema escuro do Campo é só a **entrada** (splash e carga, §4). O popup abre por cima do corpo da tela, que nos dois apps é Pérola com cartões brancos (§4), então o cartão branco é o certo. Um popup Azul noite no meio do Início criaria uma segunda "tela de entrada" e brigaria com a faixa do cabeçalho. A variante clara da barra (`temaDaEntrada('gestao')`) é a já aprovada na entrada do Gestão: trilho Azul suave `#DFE2E6`, preenchimento Sol laranja `#C2540A` (**3,54:1** no trilho e 4,60:1 no branco, gráfico ≥ 3:1) e textos Azul noite `#1E3350` (12,77:1 no branco). "Barra igual à da tela de carga" vale para a geometria (6 dp, raio 3, 240 ms) e o cálculo; a cor é a da variante clara. Conforme.
3. **Tom dos textos de erro.** Conforme. "Sem internet na etapa 3 de 5" e "Parou na etapa 3 de 5" são diretos, sem jargão e iguais aos da carga (mesma voz nas duas telas); o detalhe técnico fica no Diagnóstico. O vermelho `#A8261B` (7,10:1 no branco) aparece só com texto e ícone, como situação (§3). "Tentar de novo" é o principal em Azul noite e "Fechar" é neutro na Névoa: o papel de cada cor está certo.

## O que mais foi conferido
- **Texto do popup:** "Realizando a sincronização completa, aguarde e não saia dessa tela" é literal do Alexandre (R-20261115-100000-alexandre). Fica como está; não cabe ajuste de marca sobre texto ditado por ele.
- **Tipografia:** IBM Plex Sans SemiBold 16 no rótulo do botão e no texto do popup, Plex Sans 13 e Bold 13 (números tabulares) na linha da barra, SemiBold 15 no erro. Tudo dentro da família e dos pesos aprovados (§5).
- **Hora do estoque:** "Atualizado às 06:12", "Atualizado ontem às 06:12" e "Atualizado em 13/11 às 06:12" em `ink2` `#4A5562` (7,59:1 no branco), uma vez por tela. Sem cor nova.
- **Nenhum token novo, nenhum hex fora da paleta** no produto especificado; o logo não aparece nestas telas (o Início não leva logo, §4).

## Achado
| Campo | Conteúdo |
|---|---|
| ID | MC-0057 |
| Onde | `docs/design/sincronizacao-completa.md` §3 (linha "Desatualizado": `warningInk`) e `docs/design/telas/T-estoque-diario-sincronizar.html:21` (`--warningInk:#5C3B00`), painel 7 do print |
| Tipo | cor |
| Fere | manual §3: a cor de aviso aprovada é `#7A4F00` (fundo `#FFF1D6`); "cor quase igual às da paleta" é combinação proibida. O `#5C3B00` (token `warningInk`, `packages/ui/src/mobile/tokens.ts:63`) não está no manual |
| Gravidade | baixa (texto de situação legível nas duas cores; a cor não é a aprovada) |
| Correção | no texto "Estoque desatualizado · ..." (Catálogo, ficha e alerta do Novo pedido): `warningInk` `#5C3B00` → `warning` `#7A4F00` (7,13:1 no branco; 6,38:1 no `#FFF1D6`). Na spec, trocar `warningInk` por `warning`; no HTML, `--warningInk:#5C3B00` → `#7A4F00` e regerar o PNG |
| Dono | designer-ux |

**Fora do escopo desta entrega (registro, não segura este lote):** o token `warningInk` `#5C3B00` já existe no kit (`packages/ui/src/mobile/tokens.ts:63`, usado em `sincronizacao.tsx:155`). Ou ele passa a `#7A4F00` (sai o token e o uso vira `warning`), ou o Alexandre aprova o `#5C3B00` como "aviso escuro" no manual. Recomendo a primeira: uma cor de aviso só, que já passa no contraste. Fica com o designer-ux para o próximo lote do kit.

## Observação (não é achado)
- O marcador do dedo na simulação (painel 2) é laranja translúcido e cobre o "6 s" do rótulo. É só da prancha, não do produto. Ao regerar o PNG, vale deslocar o marcador para fora do texto (ou deixá-lo em cinza neutro), para o Alexandre ler a contagem inteira.

## Para fechar
1. designer-ux corrige a MC-0057 na spec e no HTML e regera o PNG;
2. eu confiro no print regerado e, depois, no print do aparelho do build.
