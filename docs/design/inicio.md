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

## 1. Campo — vendedor (`escopo: 'proprio'`)
Ordem: **boas-vindas → Recados de hoje → Meta de hoje → Orçamentos | A faturar → (espaço) → Sincronizar**.

### 1.1 Boas-vindas (sem cartão, direto no fundo)
| Peça | Estilo | Texto |
|---|---|---|
| Data | `type.sub` (13, `ink2`) | "Quarta, 4 de novembro" |
| Saudação | `type.saudacao` (Archivo 26/800, `ink`), 1 linha | "Bom dia, Lucas" (5h–11h59) · "Boa tarde, Lucas" (12h–17h59) · "Boa noite, Lucas" (18h–4h59), fuso do tenant, só o primeiro nome |
| Visitas | `type.sub` | "6 visitas hoje · 3 feitas" · 1: "1 visita hoje · 1 feita" · sem paradas: "Nenhuma visita na rota de hoje" |
- O bloco inteiro abre o Perfil (alvo ≥ 48; leitor: "Boa tarde, Lucas. Abrir perfil"). Sem sino e sem hora no topo.
- Começa abaixo da barra de status (área segura do shell; no Android o piso é `StatusBar.currentHeight`).

### 1.2 Recados de hoje (`Cartao`, gap 4)
- Topo: `type.rotulo` "RECADOS DE HOJE" à esquerda; à direita o selo pílula `accentSoft`/`accentInk` 12/600 "3 novos"
  ("1 novo"; "99+ novos"; some com tudo lido).
- Até 3 linhas (mín. 48 dp, divisor `lineSoft` entre elas): ponto 9 · título `bodyStrong` (até 2 linhas) · apoio `small`
  "Mercadinho São Jorge · 14:02" / "Marcos · 09:15" (quem ou onde · hora de relógio; ontem: "ontem"; na semana: "seg").
- Ponto: recado do dia do supervisor = `accent` (vem primeiro); boa notícia (aprovado, faturado, meta batida) = `success`;
  novo = `accent`; lido = `ink3`. A cor nunca é a única pista: o leitor diz ", novo".
- Toque na linha marca como lida e abre o link interno (`/m/...`) ou a central.
- Rodapé do cartão: link `accentInk` 14/600 "Ver todos" (alvo 44) → central de notificações (RF-CORE-09).
- Vazio: `small` "Nenhum recado por enquanto." e o "Ver todos" continua.

### 1.3 Meta de hoje (`Cartao`, gap 8)
- Topo: `type.rotulo` "META DE HOJE" · à direita `sub` "mês 40%" (`meta_hoje.mes_pct`).
- Linha do valor: realizado de hoje em Archivo 30 tabular ("R$ 1.240") · à direita, na mesma linha de base, `sub` "de R$ 3.200"
  (necessidade diária, RN-CORE-22/RN-CORE-26).
- Barra 6 dp (`accent` sobre `lineSoft`, limitada a 100%).
- Apoio `sub`: "Faltam R$ 1.960 hoje" (`meta_hoje.faltam_hoje`).
- Outros indicadores com meta (positivação, visitas, cobertura) entram abaixo, em linhas compactas (rótulo · valor · barra 4).

| Estado (`situacao`) | Cartão | Valor | Barra | Apoio |
|---|---|---|---|---|
| `a_cumprir` | padrão | realizado de hoje | `accent` | "Faltam R$ 1.960 hoje" |
| `dia_batido` | `sucesso` (valor e apoio em `success`) | realizado de hoje | `success` 100%, trilho `successTrack` | "Meta de hoje batida" |
| `mes_batido` | `sucesso` | realizado de hoje | `success` 100% | "Meta do mês batida · R$ 31.200 de R$ 30.000" |
| `dia_nao_util` | padrão | realizado do mês | `ink3`, % do mês | "Hoje não é dia útil · faltam R$ 1.800 no mês" |
| `do_mes` (cobertura) | padrão | "62%" | `accent` | "Acumulado do mês" |
- Cópia defasada (`base.defasado`): linha `small` `warningInk` no cartão "Vendas até 02/11 às 18h40. Sincronize para atualizar".
- Sem cópia de vendas (`sem_realizado`): linha "Sincronize para ver as vendas".
- Sem meta no mês: o cartão fica só com o rótulo e "Nenhuma meta cadastrada para este mês."

### 1.4 Orçamentos | A faturar (Vendedor, slot `inicio.cards`, id `pedidos-resumo`, `ordem: 20`)
- Dois cartões **lado a lado** (mesma largura, gap 12), cada um tocável (abre Pedidos já filtrado), mín. 112 dp de altura.
- Cartão: `type.rotulo` "ORÇAMENTOS" / "A FATURAR" · quantidade em Archivo 28 ("3") · `small` `ink2` "R$ 1.150 · 1 vence amanhã"
  / "R$ 2.980 · 1 aguardando aprovação" (sem pendência: só o valor).
- Sem pré-venda no tenant: só "A faturar", na largura toda.
- "A faturar" = aguardando aprovação, aprovado, enviado ao ERP e integrado, sem faturamento (decisão do gerente na T-0076);
  pedido na fila do aparelho fica fora (já aparece no chip "Na fila" de Pedidos).
- Leitor: "Orçamentos: 3. R$ 1.150 · 1 vence amanhã. Toque para ver a lista."

### 1.5 Sincronizar (kit: `BotaoSincronizar`, `packages/ui/src/mobile/sincronizacao.tsx`)
- Botão 52 na largura toda, `variant="dark"` (grafite `ink`, texto branco), ícone `sync`, rótulo "Sincronizar".
- Abaixo, **centralizado**, `small` `ink2`: "Última sincronização 16:25 · 0 na fila" (RN-CORE-23); nunca sincronizado:
  "Ainda não sincronizado · 2 na fila"; logo depois de um toque: "Atualizado há instantes".
- Sincronizando: o botão mostra o indicador de carregamento e fica sem toque.
- Modo sem sinal ligado: botão desabilitado "Sem sinal" e, acima da linha de situação, centralizado em `warningInk`,
  "Desligue o modo sem sinal para sincronizar".
- O mesmo componente, com o mesmo desenho, fica no Perfil (cartão Sincronização).

## 2. Campo — promotor (RN-PRO-01)
Igual ao vendedor (§1), com estas diferenças:
- Sem Orçamentos, A faturar e qualquer atalho de pedido (o slot não entrega o card ao promotor).
- "Meta de hoje" mostra só os indicadores em que ele tem meta (em geral visitas e cobertura); o principal é o primeiro com meta.
- Avisos de vendas (defasada, sem cópia) só se ele tiver meta de vendas ou positivação.

## 3. Gestão — supervisor e gerente (`escopo: 'equipe'`)
Ordem: **boas-vindas → Recados de hoje → Meta de hoje da equipe → Pedidos para aprovar → Equipe agora → (espaço) → Sincronizar**.
(Sem imagem própria: segue a ordem do Campo com os blocos da equipe, premissa da T-0076.)
- Boas-vindas: data com a equipe "Quarta, 4 de novembro · Equipe Manaus"; visitas somadas da equipe "18 visitas hoje · 7 feitas".
- Recados de hoje: igual ao §1.2.
- Meta de hoje da equipe: igual ao §1.3 com o rótulo "META DE HOJE DA EQUIPE" e, quando parte da equipe já bateu,
  `small` "1 de 3 já bateu o mês".
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
Quarta, 4 de novembro · Bom dia / Boa tarde / Boa noite, {nome} · {n} visitas hoje · {m} feitas · Nenhuma visita na rota de hoje ·
Recados de hoje · {n} novos · Ver todos · Nenhum recado por enquanto. · Meta de hoje · Meta de hoje da equipe · mês {pct}% ·
de {meta} · Faltam {valor} hoje · Meta de hoje batida · Meta do mês batida · Hoje não é dia útil · Acumulado do mês ·
Sincronize para ver as vendas · Nenhuma meta cadastrada para este mês. · Orçamentos · {valor} · {n} vence(m) amanhã · A faturar ·
{n} aguardando aprovação · Pedidos para aprovar · Equipe agora · Sincronizar · Última sincronização {hh:mm} · {n} na fila ·
Ainda não sincronizado · Atualizado há instantes · Sem sinal · Desligue o modo sem sinal para sincronizar.

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
