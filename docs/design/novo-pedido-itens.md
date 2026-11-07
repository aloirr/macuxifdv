# Novo pedido — aba Itens revisada e aba Detalhes (T-0089)

> 2026-11-06 · designer-ux · referência: `docs/produto/referencias/R-20261106-0703-alexandre-novo-pedido-itens-v2.png` (e `.html`),
> a das 7h03 (mais nova que a de `.coord/recados/anexos/`). Regras: RN-VEN-12, 13, 15, 23, 24, 25; RN-CAT-08.
> Desenho técnico: `docs/desenho/T-0089.md` (fatias V4 e U1). Kit: `packages/ui/src/mobile` (`suspensa.tsx`, `cartoes-pedido.tsx`,
> `formulario.tsx`, parte pura em `selecao.ts`). Tela: `modules/vendedor/app` (dono: modulo-vendedor).

## 1. Aba Itens, de cima para baixo
**Sem rodapé fixo.** Nada flutua sobre a lista; o único principal da tela continua no Resumo ("Enviar pedido").
Para ir de Itens a Detalhes e de Detalhes ao Resumo: botão **"Avançar"** no fim do conteúdo da aba (inline, rola com a lista;
premissa do Vendedor aceita na T-0089). As pendências do pedido ficam **antes** dele.

0. **Cabeçalho:** "{cliente} · cód. {código} · prazo médio do cliente {n} dias" (até 2 linhas; sem prazo médio, a parte final
   não aparece). Explica por que alguns prazos aparecem desabilitados.

1. **Card Pagamento** (`Cartao`):
   - linha com dois `ListaSuspensa` lado a lado (`flex: 1` cada, `gap: 8`): **FORMA DE PAGAMENTO** à esquerda, **PRAZO** à direita;
   - o Prazo mostra só os prazos da forma escolhida; antes da forma, o Prazo fica `desligado` com o placeholder "Escolha a forma";
   - a lista do Prazo mostra **só o prazo** ("28/56 dias", "À vista"), sem "médio 42";
   - prazo acima do prazo médio do cliente (RN-VEN-25): `desabilitada: true`, `motivo: 'Acima do prazo médio do cliente'`
     (o motivo só é lido pelo TalkBack; na tela, texto cinza com cadeado e sem toque);
   - trocar a forma e o prazo atual não existir nela: o Prazo volta ao placeholder e fica com `erro` até escolher;
   - divisor e, abaixo, **"Total do pedido · 2 itens"** à esquerda e **"R$ 99,09"** à direita (Archivo 18, tabular). O total
     não se repete no rótulo da aba Resumo.
2. **Busca de produto** (`CampoBusca`), e os resultados com o produto em 3 linhas (abaixo).
3. **Itens do pedido**, sob o rótulo "NO PEDIDO" (`RotuloSecao`), um por bloco, separados por divisor (sem cartão por item).
   Com a busca aberta, os itens do pedido continuam visíveis abaixo dos resultados (como na referência).

### 1.1 Produto (na busca e no item) — RN-CAT-08
- Linha 1: `código · medida` em mono 11 `ink3`, depois o **nome** 14/700 e a **embalagem** (até 2 linhas, depois reticências).
- Linha 2: **aplicação** em até 2 linhas (`numberOfLines={2}`), 12,5 `ink2`. Sem aplicação, a linha não aparece.

### 1.2 Item do pedido (3 linhas + total)
- **Linha 1:** código · nome · embalagem (igual ao produto).
- **Linha 2:** aplicação em até 2 linhas.
- **Linha 3 (controles):** `Segmentado compacto` **UN | CX** (ou a sigla da embalagem: FD) · `Passo compacto` (− n +) ·
  `CampoAjuste` (o tipo ao lado e o valor), nesta ordem.
  - Layout da linha: `flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 0`; o Segmentado com
    `style={{ flexGrow: 0, width: larguraSegmentadoCompacto(n) }}` (do kit: 2 medidas → 94, 3 → 144; não repita a conta), o Passo com a largura dele (124) e o `CampoAjuste` com `style={{ flexGrow: 1, minWidth: 124 }}`.
  - Cabe numa linha com **≥ 350 dp** de conteúdo (aparelho de 393-412 dp); no de 360 dp o ajuste desce para a linha de baixo,
    ocupando a largura toda. **Não diminua os alvos para caber** (≥ 44 dp é critério da T-0089).
- **"Valor total:"** do item **no fim, alinhado à direita**, abaixo da linha 3: rótulo 12,5 `ink2` + valor 14/800 tabular.
- **O item não mostra** "preço de tabela → preço final" nem o selo da faixa (a faixa aparece só no "Leve mais" de Detalhes).
- Remover o item: pelo Passo (− até 0, com o aviso no rodapé com Desfazer, como hoje) — sem lixeira nova na linha 3.

### 1.3 Medidas da linha 3 (visual × alvo)
| Peça | Visual (moldura) | Alvo de toque | Observação |
|---|---|---|---|
| `Segmentado compacto` (UN/CX) | 30 dp de altura (não estica: `flex: 0`) | 44 × 44 dp cada opção, dentro do botão | sem hitSlop; largura `larguraSegmentadoCompacto(n)` |
| `Passo compacto` | caixa 100 × 30 dp (− 32 · n 36 · + 32) | − e + com 44 × 44 dp; contêiner 124 × 44 | o alvo passa 12 dp para fora da caixa |
| `CampoAjuste` | 30 dp de altura | tipo e valor com 44 dp de altura | o tipo abre o menu com os 4 tipos |

Por que sem hitSlop: no Android, o toque fora da borda do **pai** não chega ao filho, então a folga de um botão de 30 dp
dentro de um contêiner de 30 dp não vale. Nestas peças o alvo é o tamanho do próprio botão e o visual fica desenhado dentro.

### 1.4 O "−" e o "+" (bug do R-20261106-064754)
- Cada toque responde, inclusive com o teclado aberto: o `Passo` lê o número digitado no momento (digitar 5 e tocar "+" dá 6).
- **A tela precisa** de `keyboardShouldPersistTaps="handled"` no `ScrollView`/`FlatList` da aba; sem isso, o primeiro toque com o
  teclado aberto só fecha o teclado (o kit não consegue resolver isso de dentro do componente).
- Sem preço: `desligadoAumentar` (o "+" fica sem toque; o motivo vai em texto perto, "Sem preço nesta tabela").

### 1.5 Desconto sempre aberto
- `CampoAjuste` com `tipos={TIPOS_AJUSTE}`: **Desc %**, **Desc R$**, **Acrésc %**, **Acrésc R$** num toque (menu ancorado).
- Valor com `sanearDecimal` ao digitar e `lerDecimal` ao confirmar; placeholder "0"; vazio = sem ajuste.
- A alçada é do desconto efetivo do **pedido** (domain do Vendedor): o aviso "vai para aprovação" fica na faixa do Resumo.
  Se o domain marcar erro **do item** (ex.: preço mínimo), o `CampoAjuste` recebe `erro` e o texto vai abaixo da linha 3.
  Preço mínimo (RN-VEN-11): `erro` e "Abaixo do preço mínimo" — o domain do Vendedor decide; o kit só mostra.
- Tipo desabilitado (ex.: o tenant não permite acréscimo em R$): `desabilitada: true` no tipo, com `motivo`.

## 2. Aba Detalhes, nesta ordem
1. **Crédito do cliente** (`CartaoCredito`)
2. Frete (CIF/FOB + transportadora; sai de Itens)
3. Entrega
4. Observações
5. **Leve mais e pague menos** (`CartaoLeveMais`)
6. Combina com o pedido

### 2.1 Crédito do cliente (RN-VEN-12, RN-VEN-13; `core.financeiro_cliente@1`)
- Título "CRÉDITO DO CLIENTE" (rótulo 11/700 maiúsculas).
- Dois valores lado a lado: **Limite total** (esquerda) e **Limite disponível** (direita), Archivo 18 tabular, de centavos com
  `formatBRL`. Disponível negativo: `negativo: true` (número em vermelho, com o sinal "−").
- **Sem** a linha "Após este pedido".
- Com título vencido: `alerta={textoInadimplencia({ titulos, valorCents, dias, consequencia: CONSEQUENCIA_VENCIDO })}` →
  "Cliente inadimplente: 2 títulos vencidos · R$ 480,00 · há 12 dias. Só à vista ou com aprovação." (Faixa vermelha, com texto).
  `dias` = atraso do título mais antigo.
- Rodapé: `atualizacao={textoAtualizacao(sincronizadoEm, agora, tz)}` → "Atualizado hoje às 06:20" (fuso do tenant). Sem sinal:
  `semSinal` troca o ícone; o texto continua (vale offline).
- Sem dados do cliente: `vazio="Sem dados de crédito deste cliente."` (sem zeros falsos).

### 2.2 Leve mais e pague menos (RN-VEN-23)
- Uma linha por item com próxima faixa (`proximaFaixa` do domain do Vendedor), com `textosLeveMais(...)`:
  - título "Água mineral 1,5 L · leve 10 FD";
  - apoio "R$ 19,90/FD (hoje R$ 20,31) · faltam 7 FD";
  - a linha inteira é o toque (≥ 56 dp) e ajusta a quantidade para a da faixa; ícone ⇧ à direita;
  - TalkBack: "Água mineral 1,5 L: levando 10 FD, R$ 19,90 por FD, hoje R$ 20,31. Faltam 7 FD." + dica "Ajustar para 10 FD".
- Depois do toque: aviso no rodapé "Água mineral 1,5 L: 10 FD" com **Desfazer** (padrão do guia, §5).
- Nenhum item com próxima faixa: o cartão não aparece (o componente devolve nada).

## 3. Textos aprovados
| Lugar | Texto |
|---|---|
| Rótulos | "Forma de pagamento" · "Prazo" · "Total do pedido · {n} itens" · "Valor total:" |
| Placeholder | Forma: "Escolha" · Prazo sem forma: "Escolha a forma" |
| Fechar o menu (TalkBack) | "Fechar a lista" |
| Prazo desabilitado (TalkBack) | "Acima do prazo médio do cliente" |
| Tipo do ajuste (TalkBack) | "Tipo do ajuste de {produto}" · valor: "Valor do ajuste de {produto}" |
| Passo (TalkBack) | "Quantidade de {produto}" · "Diminuir {produto}" · "Aumentar {produto}" |
| Crédito | "Crédito do cliente" · "Limite total" · "Limite disponível" · alerta de `textoInadimplencia` · "Sem dados de crédito deste cliente." |
| Leve mais | "Leve mais e pague menos" · textos de `textosLeveMais` |
| Sem formas no tenant | "Cadastre as formas de pagamento no BKO" (só se todas estiverem desativadas, P7 da ficha) |

## 4. Estados
- **Carregando** (formas ainda não lidas do aparelho): os dois campos `desligado` com o placeholder.
- **Offline**: tudo funciona com os dados do aparelho; o crédito mostra a data da última sincronização.
- **Erro**: falta forma ou prazo ao enviar → `erro` no campo e a pendência no Resumo ("Escolha o prazo").
- **Reduzir movimento**: o menu aparece e some sem esmaecer; o passo e as linhas não afundam.
