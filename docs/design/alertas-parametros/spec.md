# Parâmetros › Alertas e alertas de produtividade (simulação para aprovação)

Pedido do Alexandre R-20261115-112500 (15/11/2026, manhã, horário de Manaus). **Só simulação**: nada muda no código, no banco nem nas telas até a aprovação.
Conteúdo (regras, gatilhos, textos, padrões, decisões D1 a D6): `docs/modulos/gestor/alertas-produtividade.md`. Esta spec diz só **o que cada tela mostra e como**.
Base visual: menu Parâmetros de `docs/design/menu-parametros/spec.md` (branch `nuvem/menu-parametros-designer-ux`): menu de 240 px, grupo aberto em sanfona, `PageHeader` com "Parâmetros" acima do título, seções em `Panel`, um Salvar por unidade salva.

## 1. Página Parâmetros › Alertas (`/parametros/alertas`)

Duas seções, uma embaixo da outra: **Alertas da equipe** e **Produtividade do dia**. Cada regra é uma linha (cartão com borda `line-2`, raio 12) que salva sozinha.

### 1.1 Linha de regra (padrão das duas seções)
Da esquerda para a direita:
1. **Interruptor geral** (`Interruptor` do kit, `packages/ui/src/web/permissoes.tsx`; trilho 40×24, alvo 44). Ao lado, o estado escrito: "Ligada"; desligada, o selo neutro "Desligada" (cor sempre com texto).
2. **Nome** (15 px, semibold) e **frase curta** (13 px, `ink-2`) logo abaixo. A frase diz o problema; o valor fica só no campo (uma informação, um lugar).
3. **Campos da regra**: só os que a regra usa, cada um com rótulo do que faz, valor padrão preenchido e unidade escrita dentro do campo (`% da frequência`, `dias`, `min`, `h`, `fotos`). Altura 44.
4. **Severidade** (só em Alertas da equipe): lista com Informativo, Atenção, Crítico (rótulos de `modules/gestor/web/pages/regras-page.tsx`).
5. **Salvar** da regra: principal (Azul noite) só na regra alterada; nas outras, desabilitado. Um só principal por tela.

Estados:
- **Alterada:** campo mexido com borda de 2 px em Azul noite; borda da linha em Azul noite; Salvar ativo.
- **Desligada:** fundo Pérola na linha; os campos, a severidade e os destinos mostram o valor guardado em só leitura (fundo Pérola, borda `line`, texto em grafite, legível). O selo "Desligada" explica o estado; nada fica cinza sem ele. Ao religar, os valores voltam como estavam.
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

### 1.3 Produtividade do dia (tela 02, PROPOSTA)
Mesma linha, sem severidade, com o bloco **Destinos** entre a frase e os campos: "Vendedor" e "Gestor", cada um com o seu interruptor (Sim/Não, o texto do kit). Só aparece o destino que a regra tem: Fim do almoço e Visita aberta só têm Vendedor. No topo da seção, o teto: "Lembretes por pessoa: 4 por dia, no máximo", com o próprio Salvar.

| Regra | Frase | Destinos | Campos (padrão) |
|---|---|---|---|
| Fim do almoço (3a) | Lembra a volta do almoço. | Vendedor | Antes do fim 10 min |
| Sem visita (3b) | Avisa quem está parado entre visitas. | Vendedor, Gestor | Depois de 60 min · Alerta ao gestor 30 min depois · Também sem rota: Sim |
| Sem check-in no início do dia (3c-1) | Avisa quando o dia começa sem visita. | Vendedor, Gestor | Até as 10:00 |
| Rota do dia incompleta (3c-2) | Avisa quando sobram clientes da rota. | Vendedor, Gestor | Lembrete às 16:00 · Alerta ao gestor às 18:00 |
| Visita aberta (3c-3) | Lembra o checkout da visita que ficou aberta. | Vendedor | Depois de 120 min |
| Envio pendente (3c-4) | Avisa quando há registros sem enviar. | Vendedor, Gestor | Depois de 4 h |

Na simulação: Envio pendente desligada (destinos travados com o valor visível). Destino desligado deixa só leitura os campos que só ele usa (ex.: "Alerta ao gestor" com Gestor em Não).

## 2. Ficha do usuário: Jornada (tela 03)
Acesso › Usuários › gaveta "Editar usuário" (`Drawer` do kit, 560 px). Seção nova **Jornada** depois de "Código no ERP", com o campo **Horário de almoço**:
- Caixa marcada "Padrão da empresa (12:00 às 13:00)", alvo de 48 px. O horário entre parênteses vem de Parâmetros › Calendário (`jornada.almoco_padrao`).
- Desmarcada: aparecem **Início** e **Fim** já preenchidos com o padrão, para ajustar. Erro só ao salvar fora da regra (fim maior que início; 15 min a 3 h; dentro do horário comercial), no texto de erro do campo.
- Salvar e Cancelar continuam no rodapé da gaveta (sem Salvar próprio na seção).

## 3. No aparelho (tela 04)
- **Campo (vendedor e promotor):** notificação local do Android, ícone do Campo, título e corpo curtos (textos da seção 3 da proposta). Toque abre a rota do dia. Nada no Início (uma informação, um lugar).
- **Gestão:** área Alertas que já existe (`modules/gestor/app/screens/alertas-screen.tsx`): título do tipo, chip de severidade com texto (Atenção), mensagem, "desde" e Dispensar (neutro). Tipos novos: Sem visita, Sem check-in no início do dia, Rota do dia incompleta, Envio pendente. Sem push para o gestor (D3).

## 4. Premissas visuais
- P1. Cores e fontes só dos tokens existentes (`apps/web/app/globals.css`, `packages/ui/src/mobile/tokens.ts`): Azul noite na ação, grafite no interruptor ligado, `disabled` no desligado, selos `neutral-soft` e `warning-soft`. Nenhuma cor nova.
- P2. O estado da regra fica escrito ao lado do interruptor geral ("Ligada"/selo "Desligada") em vez de Sim/Não, para não repetir o selo. Pede uma prop de rótulos no `Interruptor` do kit (designer-ux, na implementação).
- P3. "Vendedor" no destino vale também para o promotor (um rótulo curto; a regra é a mesma).
- P4. Severidade com os rótulos atuais do código (Informativo, Atenção, Crítico); a proposta escreve no feminino.
- P5. Na tela 02, a seção Produtividade do dia aparece no topo como se a página tivesse rolado; na página ela fica abaixo de Alertas da equipe.
- P6. Na tela 04, a bandeja do Android e a barra de abas do Gestão estão simplificadas; data fictícia de dia útil (seg., 16/11).
- P7. Na Gestão, "Sem visita" no título e "sem visita há 1 h 30 min" na mensagem seguem o texto da proposta; o corretor-redundancias decide se a mensagem perde o "sem visita".

## 5. Decisões (D1 a D6)
Estão em `docs/modulos/gestor/alertas-produtividade.md`, seção 6: D1 o "parado" mora só em Alertas › Sem visita; D2 o vendedor não silencia; D3 sem push ao gestor; D4 quais do 3c entram; D5 almoço por pessoa e uso pela Produtividade; D6 padrões.

## 6. Simulações (escala 2, dados fictícios)
Gerador: `node docs/design/alertas-parametros/gerar.mjs` (escreve os `.html` e os `.png` desta pasta e confere texto cortado e o que passa da tela).

| Arquivo | O que mostra |
|---|---|
| `01-alertas-da-equipe.png` | 1440×900. Parâmetros › Alertas, Alertas da equipe: 6 regras, uma alterada, uma desligada |
| `02-produtividade-do-dia.png` | 1440×900. Produtividade do dia (PROPOSTA): 3a, 3b, 3c-1 a 3c-4, destinos e teto |
| `03-ficha-usuario-almoco.png` | 1440×900. Acesso › Usuários com a gaveta aberta: Jornada marcada; ao lado, o campo desmarcado |
| `04-push-no-aparelho.png` | 1000×1060, aparelhos de 412×915. Campo: bandeja com 3 lembretes. Gestão: Alertas com 2 alertas do gestor |
