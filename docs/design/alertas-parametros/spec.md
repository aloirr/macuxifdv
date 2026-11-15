# Parâmetros › Alertas e alertas de produtividade (spec aprovada, T-0180)

**Aprovada.** Pedido do Alexandre R-20261115-112500; decisões D1 a D6 e correções do corretor e da marca tomadas pelo gerente-projetos por delegação escrita do dono do produto (R-20261115-123000 e R-20261115-120632, 15/11/2026, manhã, Manaus). Tarefa: `.coord/tarefas/T-0180.md` (v1.0.13).
Conteúdo (gatilhos, cadência, offline): `docs/modulos/gestor/alertas-produtividade.md`. Onde a proposta e esta spec divergem, valem as decisões da T-0180 e esta spec. Esta spec diz **o que cada tela mostra e como**.
Base visual: menu Parâmetros de `docs/design/menu-parametros/spec.md` (menu de 240 px, grupo aberto em sanfona, `PageHeader` com "Parâmetros" acima do título, seções em `Panel`, um Salvar por unidade salva).

## 1. Página Parâmetros › Alertas (`/parametros/alertas`)

Duas seções, uma embaixo da outra: **Alertas da equipe** e **Produtividade do dia**. Cada regra é uma linha (cartão com borda `line-2`, raio 12) que salva sozinha. **Todo campo vem preenchido com o padrão (D6)**, sem configuração prévia.

### 1.1 Linha de regra (padrão das duas seções)
Da esquerda para a direita:
1. **Interruptor geral**: `Interruptor` do kit (`packages/ui/src/web/permissoes.tsx`) com `estadoEscrito="so-desligada"`; trilho 40×24, alvo 44, `rotulo` = nome da regra. Ligada: só o trilho, **sem texto**. Desligada: o selo neutro **"Desligada"** ao lado (cor nunca sozinha). O estado vai no `aria-checked`.
2. **Nome** (15 px, semibold) e **frase curta** (13 px, `ink-2`) logo abaixo. A frase diz o problema; o valor fica só no campo (uma informação, um lugar: nem o nome nem a frase repetem número).
3. **Campos da regra**: só os que a regra usa, cada um com rótulo do que faz, padrão preenchido e unidade escrita dentro do campo (`% da frequência`, `dias`, `min`, `h`, `fotos`). Altura 44.
4. **Severidade** (só em Alertas da equipe): Informativo, Atenção, Crítico (rótulos de `modules/gestor/web/pages/regras-page.tsx`).
5. **Salvar** da regra: principal (Azul noite) só na regra alterada; nas outras, desabilitado. Um só principal por tela.

Estados:
- **Alterada:** campo mexido com borda de 2 px em Azul noite; borda da linha em Azul noite; Salvar ativo.
- **Desligada:** fundo Pérola na linha; campos, severidade e destinos mostram o valor guardado em só leitura (fundo Pérola, borda `line`, texto em grafite, legível). O selo "Desligada" explica o estado. Ao religar, os valores voltam como estavam.
- **Exceção D1:** no **Parado entre visitas**, o campo "Depois de" continua **editável com a regra desligada** (a Equipe agora usa o mesmo número, `inicio.parado_min`, RN-CORE-26). Os outros campos dessa regra seguem a regra geral.
- **Sem licença do Promotor:** Ruptura recorrente, Visita curta e Fotos sem GPS não aparecem (RN-CORE-03).
- **Sem `alerta_regra.gerenciar`:** a página não aparece no menu.

### 1.2 Alertas da equipe (tela 01)
| Regra | Frase | Campos (padrão) | Severidade |
|---|---|---|---|
| Cliente sem visita | Avisa quando o cliente passa do prazo de visita. | Tolerância 50 % da frequência · Sem frequência 30 dias · Carência do cliente novo 15 dias | Atenção |
| Ritmo abaixo da meta | Avisa quando o vendedor está abaixo do ritmo da meta. | Ritmo mínimo 80 % da meta · A partir do 3º dia útil | Atenção |
| Pedido parado na aprovação | Avisa quando o pedido passa do prazo de aprovação. | Prazo 1 dia útil | Crítico |
| Ruptura recorrente | Avisa quando a loja repete ruptura em várias visitas. | Ruptura em 3 visitas · No período de 14 dias | Atenção |
| Visita curta | Avisa quando o promotor fica menos que o mínimo na loja. | Permanência mínima 10 min · Nos últimos 3 dias | Informativo |
| Fotos sem GPS | Avisa quando muitas fotos chegam sem localização. | Máximo sem GPS 20 % · No período de 7 dias · A partir de 10 fotos | Atenção |

Na simulação: Ritmo abaixo da meta alterada (80 → 85 %, Salvar ativo) e Visita curta desligada.

### 1.3 Produtividade do dia (tela 02)
Mesma linha, sem severidade. No topo da seção, o teto: "Lembretes por pessoa: 4 por dia, no máximo", com o próprio Salvar.
**Destinos só nas regras com dois** (Parado entre visitas e Sem check-in no início do dia): bloco "Vendedor" e "Gestor" entre a frase e os campos, cada um com o `Interruptor` no padrão (Sim/Não). Nas outras regras não há bloco de destinos (são só do vendedor); fica o espaço vazio para os campos alinharem na mesma coluna.

| Regra | Frase | Destinos | Campos (padrão) |
|---|---|---|---|
| Fim do almoço | Lembra a volta do almoço. | — (só vendedor) | Antes do fim 10 min |
| Parado entre visitas | Avisa quando passa do tempo sem check-in. | Vendedor, Gestor | Depois de 60 min (editável mesmo desligada, D1) · Alerta ao gestor 30 min depois · Também sem rota: Sim |
| Sem check-in no início do dia | Avisa quando o dia começa sem visita. | Vendedor, Gestor | Até as 10:00 |
| Rota do dia incompleta | Lembra os clientes da rota que faltam. | — (só vendedor) | Lembrete às 16:00 (sem alerta ao gestor) |
| Visita aberta | Lembra o checkout da visita que ficou aberta. | — (só vendedor) | Depois de 120 min |
| Envio pendente | Lembra os registros sem enviar. | — (só vendedor) | Depois de 4 h |

Destino desligado deixa só leitura os campos que só ele usa (ex.: "Alerta ao gestor" com Gestor em Não). Na simulação: Parado entre visitas desligada (com o "Depois de" editável) e Envio pendente desligada (só leitura).

## 2. Ficha do usuário: Jornada (tela 03)
Acesso › Usuários › gaveta "Editar usuário" (`Drawer` do kit, 560 px). Seção nova **Jornada** depois de "Código no ERP", com o campo **Horário de almoço**:
- Caixa marcada "Padrão da empresa (12:00 às 13:00)", alvo de 48 px. O horário entre parênteses vem de Parâmetros › Calendário (`jornada.almoco_padrao`).
- Desmarcada: aparecem **Início** e **Fim** já preenchidos com o padrão, para ajustar. Erro só ao salvar fora da regra (fim maior que início; 15 min a 3 h), no texto de erro do campo.
- Salvar e Cancelar continuam no rodapé da gaveta (sem Salvar próprio na seção).

## 3. No aparelho (tela 04)
### 3.1 Campo (vendedor e promotor): lembretes
- Notificação local do Android, **só na bandeja**: nada no Início nem na central do app (uma informação, um lugar). Sem som nem aviso flutuante.
- **Ícone pequeno monocromático em Azul noite**: o ativo da marca `docs/marca/ativos/2026-11-12-v1/icone-notificacao-96.png` (96×96, branco no transparente, o formato que o Android pede para o ícone pequeno), pintado pelo sistema com a cor `#1E3350` (token `accent` de `packages/ui/src/mobile/tokens.ts`). Não há cópia em `docs/design/` para não duplicar o ativo (uma fonte só, a da marca).
- Textos (título · corpo). O corpo **"Próxima visita: <cliente>."** é igual em todos os lembretes que apontam a próxima visita; sem próxima visita, vai só o título.

| Lembrete | Título | Corpo |
|---|---|---|
| Fim do almoço | Seu almoço termina às 13:00 | Próxima visita: Mercado Bom Preço. |
| Parado entre visitas | Há 1 h sem visita | Próxima visita: Mercado Bom Preço. |
| Sem check-in no início do dia | Nenhuma visita hoje | Próxima visita: Mercado Bom Preço. |
| Rota do dia incompleta (16:00) | Faltam 3 clientes da rota hoje | Próxima visita: Mercado Bom Preço. |
| Visita aberta | Visita aberta há 2 h no Mercado Bom Preço | — |
| Envio pendente | Registros sem enviar há 4 h | — |

- Toque abre a rota do dia (Envio pendente: a tela de envio).

### 3.2 Gestão (e BKO): Alertas
Área Alertas que já existe (`modules/gestor/app/screens/alertas-screen.tsx`): título do tipo, chip de severidade com texto (Atenção), mensagem, "desde" e Dispensar (neutro). Sem push ao gestor (D3). Um alerta aberto por pessoa; o mais novo substitui (D4).

| Tipo | Título | Mensagem |
|---|---|---|
| Parado entre visitas | Parado | João Silva: último checkout às 10:12. |
| Sem check-in no início do dia | Sem check-in | Carla Mendes |

Lido junto, título e mensagem dão "Parado: João Silva: último checkout às 10:12.". Rota incompleta, envio pendente, visita aberta e fim do almoço **não** geram alerta ao gestor.

## 4. Premissas visuais
- P1. Cores e fontes só dos tokens existentes (`apps/web/app/globals.css`, `packages/ui/src/mobile/tokens.ts`): Azul noite na ação, grafite no interruptor ligado, `disabled` no desligado, selos `neutral-soft` e `warning-soft`. Nenhuma cor nova.
- P2. O liga/desliga geral usa `Interruptor` com `estadoEscrito="so-desligada"` (prop nova e opcional do kit; o padrão continua "Sim"/"Não").
- P3. "Vendedor" no destino vale também para o promotor.
- P4. Severidade com os rótulos atuais do código (Informativo, Atenção, Crítico).
- P5. Na tela 02, a seção Produtividade do dia aparece no topo como se a página tivesse rolado; na página ela fica abaixo de Alertas da equipe.
- P6. Na tela 04, a bandeja do Android e a barra de abas do Gestão estão simplificadas; data fictícia de dia útil (seg., 16/11).
- P7. O nome da regra no Parâmetros não leva o horário ("Sem check-in no início do dia"): o 10:00 mora só no campo "Até as".

## 5. Simulações (escala 2, dados fictícios)
Gerador: `node docs/design/alertas-parametros/gerar.mjs` (escreve os `.html` e os `.png` desta pasta e confere texto cortado e o que passa da tela).

| Arquivo | O que mostra |
|---|---|
| `01-alertas-da-equipe.png` | 1440×900. Alertas da equipe: 6 regras, uma alterada, uma desligada |
| `02-produtividade-do-dia.png` | 1440×900. Produtividade do dia: 6 regras, destinos só nas duas que têm dois, teto, D1 |
| `03-ficha-usuario-almoco.png` | 1440×900. Acesso › Usuários com a gaveta aberta: Jornada marcada; ao lado, o campo desmarcado |
| `04-push-no-aparelho.png` | 1000×1060, aparelhos de 412×915. Campo: bandeja com 3 lembretes e o ícone em Azul noite. Gestão: Alertas com 2 alertas do gestor |
