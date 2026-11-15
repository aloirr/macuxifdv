# Início (boas-vindas) — Campo vendedor, Campo promotor e Gestão (T-0076)

> 2026-11-04 · designer-ux · **referência aprovada pelo Alexandre:** `docs/produto/referencias/R-20261104-164000-alexandre-inicio-cliente360.png`
> (fonte `.html` ao lado), spec R-20261104-164000-alexandre, tarefa `.coord/tarefas/T-0076.md`.
> **Substitui o layout da T-0073** (`referencia-2026-11-03/Main.dc.html` e `Supervisor.dc.html`): saíram o sino no cabeçalho,
> o cartão escuro "Recado do dia", a grade "Sua meta de hoje", o botão "Começar a rota", a lista "Seus módulos" e a hora da
> sincronização duplicada no topo. Onde este documento e a T-0073 divergirem, vale este.
> Tela do shell: `apps/mobile/src/app/(tabs)/index.tsx` e `components/inicio.tsx` (engenheiro-apps); textos e tons em
> `apps/mobile/src/lib/inicio.ts`. Dados: `useInicio()` do Core (`core.inicio@1`, campos aditivos `recados_hoje`, `meta_hoje`,
> `sem_realizado`). A tela só desenha; nenhuma conta de negócio na tela.

## 0. Regras gerais
- Primeira tela depois do login e da carga. Funciona **sem sinal**: tudo sai da última sincronização (offline-first).
- **Um só botão na tela: Sincronizar**, no fim (principal 52, `variant="dark"`, grafite). Nenhum outro botão de 52 no Campo
  nem na Gestão. Os cards (Orçamentos, A faturar, Pedidos para aprovar) são cartões tocáveis, não botões.
- Ordem fixa dos blocos, de cima para baixo; espaçamento entre blocos 14 (`Screen gap`), lateral 20.
- Quando sobra altura, o Sincronizar fica no pé da tela (espaçador flexível); quando a tela rola, vem logo depois do último bloco.
- Puxar para baixo = Sincronizar (RN-CORE-23 item 5). Nenhum timer automático < 15 min (ADR 0018).
- Dinheiro de centavos arredondado para reais inteiros ("R$ 1.240"). Datas e horas no fuso do tenant.
- Cada card de módulo só aparece se o módulo estiver ativo, no perfil e com a ação (ADR 0004, RN-CORE-03): sem Vendedor, nada
  de Orçamentos e A faturar; sem Gestor, nada de Pedidos para aprovar.

> **Revisão de 08/11/2026 (T-0124, auditoria de redundâncias RD-0002 a RD-0011, `docs/qualidade/redundancias/2026-11-08-inicio-campo.md`;
> decisões do gerente em R-20261108-161557).** Os §1.1 a §1.5, o §3 e o §5 abaixo já trazem o texto final. Regra que vale para
> a tela inteira: **cada fato uma vez** — "hoje" no máximo uma vez por cartão (a data já está no topo), "mês" só no título do
> cartão, a unidade uma vez por linha, um só aviso de dado antigo (no Sincronizar) e uma só barra (a do cartão principal).
> Tela de referência (domingo, base de 06/11):
> ```
> Domingo, 8 de novembro
> Bom dia, Lucas
> Sem rota hoje · não é dia útil
> RECADOS                                    1 novo
> Prioridade: passe cedo no Mercadinho São Jorge — título vencido e …   (2 linhas)
> META DO MÊS                                  0,3%
> R$ 553 de R$ 180.000
> [barra]
> Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)
> Positivação   1 de 15 clientes
> Visitas       0 de 90
> Cobertura     0% de 90%
> Orçamentos    nenhum                                   ›
> A faturar     6 · R$ 3.989 (1 aguardando aprovação)    ›
> [ Sincronizar ]
> ⟳ Dados de 06/11, 6h28 · 0 na fila
> ```

## 1. Campo — vendedor (`escopo: 'proprio'`)
Ordem: **boas-vindas → Recados → Meta do mês → Orçamentos e A faturar → (espaço) → Sincronizar**.

### 1.1 Boas-vindas (sem cartão, direto no fundo)
| Peça | Estilo | Texto |
|---|---|---|
| Data | `type.sub` (13, `ink2`) | "Quarta, 4 de novembro" |
| Saudação | `type.saudacao` (Archivo 26/800, `ink`), 1 linha | "Bom dia, Lucas" (5h–11h59) · "Boa tarde, Lucas" (12h–17h59) · "Boa noite, Lucas" (18h–4h59), fuso do tenant, só o primeiro nome |
| Visitas | `type.sub` | "6 visitas hoje · 3 feitas" · 1: "1 visita hoje · 1 feita" · sem paradas em dia útil: "Sem rota hoje" · sem paradas e `dia_util` falso: "Sem rota hoje · não é dia útil" (RD-0006: o "não é dia útil" fica só aqui; o cartão de meta não repete) |
- O bloco inteiro abre o Perfil (alvo ≥ 48; leitor: "Boa tarde, Lucas. Abrir perfil"). Sem sino e sem hora no topo.
- Começa abaixo da barra de status (área segura do shell; no Android o piso é `StatusBar.currentHeight`).

### 1.2 Recados (`Cartao`, gap 4) — RD-0003, RD-0009
- Topo (tocável, abre a central de notificações, alvo 44): `type.rotulo` **"RECADOS"** à esquerda (sem "de hoje": são os
  primeiros da caixa, não só os de hoje); à direita o selo pílula `accentSoft`/`accentInk` 12/600 "3 novos" ("1 novo";
  "99+ novos"; some com tudo lido).
- Até 3 linhas (mín. 48 dp, divisor `lineSoft` entre elas). Cada linha é **um texto só em até 2 linhas**: título em
  `bodyStrong` seguido do corpo em `body` ("**Prioridade:** passe cedo no Mercadinho São Jorge — título vencido e …"), corte com
  "…" na 2ª linha; a hora (`small` `ink2`, "09:15"; ontem: "ontem"; na semana: "seg"; antes: "28/10") à direita da 1ª linha.
- Ponto de 9 só com **2 ou mais** linhas (com 1 item, o selo já diz "1 novo"): recado do dia do supervisor = `accent` (vem
  primeiro); boa notícia (aprovado, faturado, meta batida) = `success`; novo = `accent`; lido = `ink3`. A cor nunca é a única
  pista: o leitor diz ", novo" em toda linha nova, com ou sem ponto.
- Toque na linha marca como lida e abre o link interno (`/m/...`) ou a central.
- Rodapé do cartão: link `accentInk` 14/600 "Ver todos" (alvo 44) → central (RF-CORE-09), **só quando há mais recados do que
  as linhas mostradas** (`recados_hoje.total` > itens; sem o total do Core, com 3 itens). Com 1 ou 2, o topo tocável basta.
- Vazio: `small` "Nenhum recado por enquanto." sem "Ver todos" (o topo continua tocável).

### 1.3 Meta do mês (`Cartao`, gap 8) — RD-0002, RD-0004, RD-0005, RD-0007, RD-0010; decisão R-20261108-161557
**Substitui a referência da T-0076** (realizado de hoje como número grande): o cartão é sempre **do mês**, também em dia útil.
O realizado de hoje sai do Início (está em Metas).
- Topo: `type.rotulo` **"META DO MÊS"** · à direita `sub` o % do mês, uma vez: "40%"; abaixo de 1%, com 1 casa ("0,3%");
  sem "mês" (o título já diz).
- Linha do valor: `title16`/Archivo 22 tabular **"R$ 553 de R$ 180.000"** (realizado do mês **de** meta do mês, numa linha só,
  sem "no mês").
- Barra 6 dp (`accent` sobre `lineSoft`, limitada a 100%) — a **única** barra do cartão.
- Última linha `sub`, uma das duas:
  - dia útil: **"Meta de hoje R$ 9.969"** (RN-CORE-26, valor pronto do Core);
  - dia não útil: **"Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)"** (`dias_uteis_por_dia` e `dias_uteis_restantes`
    prontos do Core, RN-CORE-22/26; os mesmos de Metas). Sem dias úteis restantes: só "Faltam R$ 179.447".
- Outros indicadores com meta, em linhas de 1 linha **sem barra** (rótulo `body` à esquerda · valor tabular à direita), no
  formato **"x de y"**, unidade uma vez e só quando o rótulo não a diz (RD-0005/0007; as três ficam, decisão do gerente):
  "Positivação   1 de 15 clientes" · "Visitas   0 de 90" · "Cobertura   0% de 90%".

| Estado (`situacao`) | Cartão | Última linha |
|---|---|---|
| `a_cumprir` (dia útil) | padrão | "Meta de hoje R$ 9.969" |
| `dia_batido` | padrão; "Meta de hoje batida" em `success` com ✓ | "Meta de hoje batida" |
| `mes_batido` | `sucesso` (valor em `success`, barra `success` 100%, trilho `successTrack`) | "Meta do mês batida" |
| `dia_nao_util` | padrão | "Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)" |
| `do_mes` (cobertura como principal) | padrão | valor "62% de 90%" e nenhuma última linha |
- **Dado antigo ou sem cópia de vendas: nada no cartão** (RD-0008). O aviso único fica no Sincronizar (§1.5).
- Sem meta no mês: o cartão fica só com o rótulo e "Nenhuma meta cadastrada." (RD-0040: o rótulo "META DO MÊS", logo acima, já diz
  "meta" e "mês"; vale também para "META DO MÊS DA EQUIPE" na Gestão).

### 1.4 Orçamentos e A faturar (Vendedor, slot `inicio.cards`, id `pedidos-resumo`, `ordem: 20`) — RD-0010, RD-0011
- **Um** `Cartao` com **2 linhas tocáveis** (mín. 48 dp cada, divisor `lineSoft`, `›` à direita), cada uma abre Pedidos já
  filtrado (`irParaPedidosFiltrados`). No lugar dos 2 cartões de 112 dp lado a lado.
- Linha: rótulo `bodyStrong` à esquerda ("Orçamentos" / "A faturar") · à direita, `body` tabular: quantidade · valor e a
  pendência entre parênteses: "3 · R$ 1.150 (1 vence amanhã)" / "6 · R$ 3.989 (1 aguardando aprovação)". **Zero = "nenhum"**
  (sem "0 · R$ 0").
- Sem pré-venda no tenant: só a linha "A faturar".
- "A faturar" = aguardando aprovação, aprovado, enviado ao ERP e integrado, sem faturamento (decisão do gerente na T-0076);
  pedido na fila do aparelho fica fora (já aparece no chip "Na fila" de Pedidos).
- Leitor: "Orçamentos: 3, R$ 1.150, 1 vence amanhã. Toque para ver a lista." / "Orçamentos: nenhum. Toque para ver a lista."

### 1.5 Sincronizar (kit: `BotaoSincronizar`, `packages/ui/src/mobile/sincronizacao.tsx`)
- Botão 52 na largura toda, `variant="dark"` (grafite `ink`, texto branco), ícone `sync`, rótulo "Sincronizar".
- Abaixo, **centralizado**, `small` `ink2`: "Última sincronização 16:25 · 0 na fila" (RN-CORE-23); nunca sincronizado:
  "Ainda não sincronizado · 2 na fila". Toque, puxar e segurar 10 s disparam no máximo 1 vez a cada 30 s por aparelho;
  toque repetido é ignorado em silêncio, sem texto nem botão desabilitado (R-20261115-125500).
- Sincronizando: o botão mostra o indicador de carregamento e fica sem toque.
- Modo sem sinal ligado: botão desabilitado "Sem sinal" e, acima da linha de situação, centralizado em `warningInk`,
  "Desligue o modo sem sinal para sincronizar".
- **Aviso único de dado antigo (RD-0008)**: prop `avisoDados` do `BotaoSincronizar` (texto pronto do shell, fuso do tenant).
  Com ela, a linha de situação vira **"⟳ Dados de 06/11, 6h28 · 0 na fila"** (ícone `sync` 14 + `small` semibold, `warningInk`,
  centralizada, testID `<testID>-aviso-dados`; a linha continua `<testID>-situacao`), no lugar de "Última sincronização…". Textos:
  base defasada (`base.defasado`) **"Dados de 06/11, 6h28"**; sem cópia de vendas (`sem_realizado`) **"Sincronize para ver as
  vendas"**. O "· N na fila" fica (redundância útil, RN-CORE-23). Não repete "Sincronizar": o botão logo acima já diz.
  Vale para A faturar, Positivação e Meta ao mesmo tempo, por isso não fica em cartão nenhum.
- Celular de 6" com o Sincronizar abaixo da dobra (o Início rola): o aviso **continua no Sincronizar**; não sobe para as
  boas-vindas. Motivo: a data no topo e um segundo aviso lá voltariam a ser dois lugares; quem rola para ver a meta chega ao
  botão que resolve o aviso. Revemos com o print do APK se o dono do produto pedir.
- O mesmo componente, com o mesmo desenho, fica no Perfil (cartão Sincronização), sem `avisoDados`.

## 2. Campo — promotor (RN-PRO-01)
Igual ao vendedor (§1), com estas diferenças:
- Sem Orçamentos, A faturar e qualquer atalho de pedido (o slot não entrega o card ao promotor).
- "Meta do mês" mostra só os indicadores em que ele tem meta (em geral visitas e cobertura); o principal é o primeiro com meta.
- O aviso de dado antigo no Sincronizar (§1.5) só vai se ele tiver meta de vendas ou positivação (o shell não passa `avisoDados`).

## 3. Gestão — supervisor e gerente (`escopo: 'equipe'`)
Ordem: **boas-vindas → Recados → Meta do mês da equipe → Pedidos para aprovar → Equipe agora → (espaço) → Sincronizar**.
(Sem imagem própria: segue a ordem do Campo com os blocos da equipe, premissa da T-0076.)
- Boas-vindas: data com a equipe "Quarta, 4 de novembro · Equipe Manaus"; visitas somadas da equipe "18 visitas hoje · 7 feitas".
- Recados: igual ao §1.2.
- Meta do mês da equipe: igual ao §1.3 com o rótulo "META DO MÊS DA EQUIPE" (em dia útil, a última linha é "Meta de hoje R$ X"
  da equipe) e, quando parte da equipe já bateu, `small` "1 de 3 já bateu o mês".
- Pedidos para aprovar (card do Gestor no `inicio.cards`): cartão tocável em destaque na largura toda, abre Aprovações;
  some sem o módulo Gestor ou sem a permissão da fila.
- Equipe agora (`Cartao`): uma linha por pessoa (mín. 56 dp, tocável quando a página do membro existe): avatar 34 com iniciais ·
  nome 14/600 · situação 12 · à direita 13 tabular "2/6 · R$ 1.240".

| `status` | Situação | Cor do texto |
|---|---|---|
| `em_visita` | "Em visita · Atacado Boto Rosa" | `ink2` |
| `em_rota` | "Em rota · saiu de um cliente às 9h40" | `ink2` |
| `parado` | "Sem check-in há 1h40" | `warning` |
| `sem_checkin` | "Sem check-in hoje" | `warning` |
| `rota_concluida` | "Rota concluída" | `success` |
- Equipe vazia: `small` "Ninguém na equipe ainda."
- Sincronizar: igual ao §1.5.

## 4. Estados da tela inteira
| Estado | O que aparece |
|---|---|
| carregando (primeira vez, `useInicio()` = null) | `Loading` |
| sem sinal | tudo da última sincronização; o Sincronizar desabilitado com o motivo (§1.5); nada some |
| módulo desativado com itens não enviados | `Banner` perigo logo abaixo das boas-vindas: "Um módulo foi desativado e há itens não enviados. Veja em Perfil › Fila do aparelho." |
| puxar para atualizar | `Screen onRefresh` (mesma ação do Sincronizar) |

## 5. Textos (pt-BR, sem ponto final em botão, rótulo e selo)
Quarta, 4 de novembro · Bom dia / Boa tarde / Boa noite, {nome} · {n} visitas hoje · {m} feitas · Sem rota hoje ·
Sem rota hoje · não é dia útil · Recados · {n} novos · Ver todos · Nenhum recado por enquanto. · Meta do mês ·
Meta do mês da equipe · {pct}% · R$ {realizado} de R$ {meta} · Meta de hoje R$ {valor} · Faltam R$ {valor} ·
R$ {valor} por dia útil ({n} dias) · Meta de hoje batida · Meta do mês batida · {x} de {y} clientes · {x} de {y} ·
{x}% de {y}% · Nenhuma meta cadastrada. · Orçamentos · A faturar · nenhum · {n} · R$ {valor} ({n} vence(m) amanhã) ·
({n} aguardando aprovação) · Pedidos para aprovar · Equipe agora · Sincronizar · Última sincronização {hh:mm} · {n} na fila ·
Ainda não sincronizado · Dados de {dd/mm}, {h}h{mm} · Sincronize para ver as vendas · Sem sinal ·
Desligue o modo sem sinal para sincronizar.
Saíram (RD-0002 a RD-0011): "Recados de hoje", "Meta de hoje" como título, "mês {pct}%", "Faltam {valor} hoje", "Hoje não é dia
útil" no cartão, "Nenhuma visita na rota de hoje", "Acumulado do mês", "meta {pct}%", "{x} clientes de {y} clientes",
"Vendas até {data} às {hora}. Sincronize para atualizar.".

## 6. Cliente 360 (mesma referência, tela do Core)
- Topo abaixo da barra de status: "‹ Rota de hoje" (de onde veio) · nome Archivo · endereço · "cliente desde 2026" · chips
  (Curva, segmento, "Positivado em nov").
- Ligar · WhatsApp · Mapa (3 botões de 48 na mesma linha).
- Grade de indicadores 2 colunas, nesta ordem: Compra média/mês · Última compra · Limite disponível · Títulos vencidos ·
  Ticket médio · Frequência · Compras em 12 meses (linha inteira). **"Última compra" uma vez só** ("hoje", "há 12 dias").
- Contatos e endereços de entrega abaixo.
- Rodapé fixo com **dois** botões de 52: [Visitado] (neutro desabilitado depois da visita; "Check-in" antes, "Checkout" com a
  visita aberta) e [+ Novo pedido] (principal `accent`, o dobro da largura). **Sem "Ver catálogo".** Promotor: só o da visita.

## 7. Revisão
O engenheiro-apps e o modulo-core desenham a partir daqui; o designer-ux revisa antes do merge (checklist de
`docs/design/componentes.md` §8): um só botão de 52 no Início (Sincronizar), cor sempre com texto, alvos ≥ 44/48,
contraste ≥ 4,5:1, área segura superior, cards somem com o módulo desligado.
