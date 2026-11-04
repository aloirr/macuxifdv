# Início (boas-vindas) — Campo vendedor, Campo promotor e Gestão (T-0073, fatia 2)

> 2026-11-03 · designer-ux · referência aprovada: `docs/design/referencia-2026-11-03/Main.dc.html` (vendedor) e
> `Supervisor.dc.html` (supervisora) · desenho técnico: `docs/desenho/T-0073.md` (§1.3 `VisaoInicio`, §2 RN-CORE-26, §1.5, §4)
> · componentes: `docs/design/componentes.md` (T-0072). Tela do shell: `apps/mobile/src/app/(tabs)/index.tsx` (engenheiro-apps).
> Dados: `useInicio()` do Core. A tela só desenha; nenhuma conta na tela (a meta do dia vem pronta em `metas[]`).

## 0. Regras gerais
- Primeira tela depois do login e da carga. Funciona **sem sinal** com a última sincronização.
- **Um só botão principal**: no Campo, "Começar a rota". Na Gestão **não há botão de 52**: a chamada é o cartão em destaque
  "Pedidos para aprovar".
- Ordem fixa dos blocos (de cima para baixo), espaçamento `layout.entreBlocos` (14), lateral 16–20 (`Screen`).
- Cards de outros módulos (`inicio.cards`: Pesquisa, Treinamento…) entram **abaixo** dos blocos do Core, ordenados por `ordem`.
- Dinheiro de centavos; no Início arredonda para reais inteiros ("R$ 1.240"); nos detalhes, com centavos. Datas e horas no fuso do tenant.

## 1. Cabeçalho (os três)
| Peça | Componente / estilo | Texto |
|---|---|---|
| Data | `type.sub` (13, `ink2`) | "Terça, 3 de novembro"; na Gestão: "Terça, 3 de novembro · Equipe Manaus" |
| Saudação | `type.saudacao` (Archivo 26/800) | "Bom dia, Lucas" (5h–11h59) · "Boa tarde, Lucas" (12h–17h59) · "Boa noite, Lucas" (18h–4h59), no fuso do tenant; só o primeiro nome (`firstName`) |
| Sino | botão redondo 44 visual (`hitSlop` 2 → 48), borda `line`, ícone `bell` 20; contador pílula laranja (`accent`, texto branco 10/700) | leitor: "Notificações, 3 não lidas" / "Notificações"; toque abre a lista de notificações |

## 2. Recado do dia (os três)
- `Cartao tom="escuro"` (grafite, raio 18, padding 18, gap 10).
- Linha 1: ícone `sun` 16 `accentLight` + `type.rotulo` em `accentLight`: **"Recado do dia"**.
- Texto: Archivo 19/700, linha 25, branco. Até 4 linhas; o resto com reticências e toque abre o recado inteiro.
- Assinatura (`small`, `darkMuted`): "Renata · Supervisora da Equipe Manaus" (`autor_nome · perfil`).
- `origem: 'padrao'` (sem recado marcado): mostra a frase padrão do tenant **sem assinatura** e sem toque.

## 3. Campo — vendedor (`escopo: 'proprio'`)
Ordem: cabeçalho → recado → **Sua meta de hoje** → **Notificações** → **botão principal** → linha de sincronização.

### 3.1 Sua meta de hoje
- Título `type.secao` "Sua meta de hoje"; à direita `small`: "faltam 19 dias úteis" (`dias_uteis_restantes`, contando hoje);
  com 1: "último dia útil do mês"; em `dia_nao_util`: "hoje não é dia útil".
- Grade de 2 colunas (gap 8), um cartão por item de `metas[]`, na ordem que vem (vendas, positivação, visitas, cobertura).
  Número ímpar: o último ocupa a linha inteira. Mix fica fora até existir o indicador.
- Cartão (`Cartao`, padding 12, gap 6): rótulo 12/600 `ink2` · valor `type.numeroGrande` · barra 6 dp (`ProgressBar height={6}`,
  trilho `lineSoft`, limitada a 100%) · linha de apoio 12 `ink2`.

| Estado (`situacao`) | Cartão | Valor | Barra | Linha de apoio (exemplos) |
|---|---|---|---|---|
| `a_cumprir` | `padrao` | realizado de hoje ("R$ 1.240", "2 clientes", "2 de 6") | `accent`, `atingimento_hoje_pct` | "de R$ 4.180 · 30%" · "de 6 · 33%" · visitas: "próxima: Mercadinho Sol" |
| `dia_batido` | `sucesso` (rótulo e linha em `success`) | realizado de hoje | `success` 100%, trilho `successTrack` | "meta de hoje batida · R$ 4.180" |
| `mes_batido` | `sucesso` | realizado do mês ("R$ 31.200") | `success` 100% | "meta do mês batida · R$ 30.000" |
| `dia_nao_util` | `padrao` | realizado do mês | `ink3`, % do mês | "faltam R$ 1.800 no mês" (ou "meta do mês batida") |
| `do_mes` (cobertura) | `padrao` | "62%" | `accent`, realizado ÷ meta | "do mês · meta 80%" |

Estados da base (vendas e positivação vêm de `core.inicio@1`; visitas e cobertura são do aparelho e sempre aparecem):
- **`base.defasado`** (cópia de ontem, mesmo mês): acima da grade, `Banner tone="warning" icon="clock"`:
  "Vendas até 02/11 às 18h40. Sincronize para atualizar." Os cartões de vendas e positivação mostram o que há (hoje = 0).
- **sem cópia** (ou de outro mês): vendas e positivação com valor "—" e linha "Sincronize para ver as vendas"; barra vazia;
  sem `Banner`. A linha de sincronização do rodapé vira o `BotaoSincronizar variant="outline"` (secundário 44).
- **sem meta no mês** (`metas[]` vazio): no lugar da grade, `Cartao tom="suave"` com `small`: "Nenhuma meta cadastrada para
  este mês."

### 3.2 Notificações
- Título `type.secao` "Notificações"; à direita, link 13/600 `accentInk` "Ver todas" (alvo 48 por `hitSlop`).
- Um `Cartao preenchimento={0}` com até 3 linhas (padding 11/12, divisor `lineSoft`): ponto 8 `accent` se não lida (sem ponto se
  lida; leitor: "não lida") · texto 14 (`numberOfLines={2}`; negrito só no número ou nome) · hora 12 `ink2` à direita ("8h02",
  "ontem", "seg"). Toque na linha abre o `link` da notificação.
- Vazio: uma linha `small` "Nenhuma notificação nova." (sem "Ver todas" se não há nenhuma).

### 3.3 Botão principal e rodapé
| Situação (`rota`) | Botão | Texto |
|---|---|---|
| `visita_aberta` | principal 52, ícone `pin` | "Continuar visita · Mercadinho Sol" (nome com reticências) |
| `restantes > 0` | principal 52, ícone `pin` | "Começar a rota · 4 paradas" (1: "1 parada"); depois do 1º check-in do dia: "Seguir a rota · 3 paradas" |
| `paradas_hoje > 0` e `restantes = 0` | secundário 44, ícone `check` | "Rota de hoje concluída" → abre a Rota |
| `paradas_hoje = 0` ou `rota = null` | secundário 44, ícone `map` | "Ver rota" |
- Toque no principal: vibração leve (já no `Botao`). Abre a Rota na próxima parada (ou a visita aberta): **1 toque até o check-in**.
- Abaixo: `small` centralizado "Sincronizado às 8h05 · 0 na fila" (`textoUltimaSincronizacao`). Sem sinal: "Sem sinal · última
  sincronização 8h05" em `warning`, com ícone `wifiOff`.

## 4. Campo — promotor (RN-PRO-01)
Igual ao vendedor (§3), com estas diferenças:
- "Sua meta de hoje" mostra **só os indicadores em que ele tem meta** (em geral visitas e cobertura). Sem vendas nem positivação
  sem meta; se houver meta de venda, aparece como número, sem lista de pedidos.
- Estados `defasado` e "sem cópia" só aparecem se ele tiver meta de vendas ou positivação.
- Nunca há "Pedidos para aprovar", nem atalho para criar pedido.
- Botão principal: os mesmos textos da §3.3 ("Começar a rota · 5 paradas").

## 5. Gestão — supervisor e gerente (`escopo: 'equipe'`)
Ordem: cabeçalho (com a equipe) → recado (normalmente do gerente) → **Pedidos para aprovar** → **Meta de hoje da equipe** →
**Equipe agora** → cards de outros módulos → linha de sincronização. Sem botão de 52.

### 5.1 Pedidos para aprovar (card do Gestor no `inicio.cards`, `ordem: 10`)
- `Cartao tom="destaque"` tocável (padding 12/14, gap 12), abre `/m/aprovacoes`.
- Círculo 40 `accent` com o total (Archivo 18/800 branco) · título 15/600 "Pedidos para aprovar" (1: "Pedido para aprovar") ·
  linha 12 `accentInk` do 1º da fila: "Lucas · 8% de desconto · R$ 2.310" · `chevron` 16 `accentInk`.
- Leitor: "2 pedidos para aprovar. O primeiro: Lucas, 8% de desconto, R$ 2.310."
- Fila vazia: `Cartao tom="suave"` não tocável, ícone `check` `success` + 14 "Nenhum pedido esperando aprovação."
- Some sozinho sem o módulo Gestor ou sem `fila_aprovacao.ver`.

### 5.2 Meta de hoje da equipe
- Título "Meta de hoje da equipe"; à direita `small`: "3 vendedores" (`membros`).
- Um `Cartao` (padding 4/14) com uma linha por indicador (padding 10/0, divisor `lineSoft`): rótulo 14/600 à esquerda; à direita
  valor tabular "R$ 1.920" + `ink2` " de R$ 7.900"; barra 6 abaixo.
- Estados por linha: `a_cumprir` (barra `accent`) · `dia_batido` (valor e barra em `success`, + " · batida") · `mes_batido`
  (todos bateram: "meta do mês batida") · `dia_nao_util` (valor do mês; à direita do título "hoje não é dia útil") ·
  `do_mes` ("62% · meta 80%").
- `membros_mes_batido > 0` e não todos: `small` abaixo da linha "1 de 3 já bateu o mês".
- `defasado` e sem cópia: os mesmos textos da §3.1 ("Vendas até 02/11 às 18h40…", "Sincronize para ver as vendas").

### 5.3 Equipe agora
- Título "Equipe agora". `Cartao preenchimento={0}` com uma linha por pessoa, na ordem do domain (parado, sem check-in, em rota,
  em visita, rota concluída). Linha tocável (abre a pessoa no Gestor), mínimo 56 dp:
  avatar 34 `neutralBg` com iniciais 13/700 · nome 14/600 · situação 12 · à direita 13 tabular "2/6 · R$ 1.240"
  (visitadas/paradas · vendas de hoje; sem vendas na cópia: "2/6").

| `status` | Texto da situação | Cor do texto |
|---|---|---|
| `em_visita` | "Em visita · Atacado Boto Rosa" | `ink2` |
| `em_rota` | "Em rota · saiu de um cliente às 9h40" | `ink2` |
| `parado` | "Sem check-in há 1h40" | `warning` |
| `sem_checkin` | "Sem check-in hoje" | `warning` |
| `rota_concluida` | "Rota concluída" | `success` |
- A cor sempre acompanha o texto. Equipe vazia: `small` "Ninguém na equipe ainda."

## 6. Abas (shell, `BarraAbas`)
- Campo: Início · Rota · Clientes · Pedidos · Mais (promotor: conforme os módulos efetivos; nunca Pedidos para criar).
- Gestão: Início · Equipe · Aprovações · Metas · Mais. Contador de Aprovações = total da fila (`tomContador` `destaque`).

## 7. Estados da tela inteira
| Estado | O que aparece |
|---|---|
| carregando (primeira vez, `useInicio()` = null) | `Loading` |
| sem sinal | tudo da última sincronização + `SyncStamp`/linha do rodapé em âmbar; nada some |
| erro no cálculo de um bloco | só o bloco some e fica uma linha `small` "Não deu para carregar a meta. Puxe para atualizar."; o resto continua |
| puxar para atualizar | `Screen onRefresh` (mesma ação do Sincronizar) |

## 8. Textos (todos pt-BR, sem ponto final em botão e rótulo)
Bom dia / Boa tarde / Boa noite, {nome} · Recado do dia · Sua meta de hoje · Meta de hoje da equipe · faltam {n} dias úteis ·
último dia útil do mês · hoje não é dia útil · de {meta} · {pct}% · meta de hoje batida · meta do mês batida · do mês · meta {x}% ·
próxima: {cliente} · Vendas até {dd/mm} às {hh}h{mm}. Sincronize para atualizar. · Sincronize para ver as vendas ·
Nenhuma meta cadastrada para este mês. · Notificações · Ver todas · Nenhuma notificação nova. · Começar a rota · {n} paradas ·
Seguir a rota · {n} paradas · Continuar visita · {cliente} · Rota de hoje concluída · Ver rota · Sincronizado às {hora} · {n} na fila ·
Pedidos para aprovar · Nenhum pedido esperando aprovação. · Equipe agora · Em visita · {cliente} · Sem check-in há {tempo} ·
Sem check-in hoje · Rota concluída · {n} de {m} já bateu o mês.
Rótulos de indicador: Vendas · Positivação · Visitas · Cobertura.

## 9. Revisão
O engenheiro-apps desenha a partir daqui; o designer-ux revisa antes do merge (checklist do `componentes.md` §8): um só principal
no Campo e nenhum de 52 na Gestão, cor sempre com texto, alvos ≥ 48, estados da §3.1 e §7 desenhados.
