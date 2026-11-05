# Roteiro manual do build final da noite 04→05/11 (APK de preview Campo e Gestão)

Para: Alexandre, no aparelho, de manhã. Agente: `testes`. Data: 2026-11-05.
Cobre o que entrou no main na noite (lote 3, PRs #91–#93 do visual, lote B até b0e0462) e o lote C (ainda vai subir).
Marca em cada passo: **[B]** já está no build do b0e0462 · **[C]** só no build do lote C. Se você instalar o build do b0e0462, pule os [C].
Anote ✅/❌ na coluna da direita. Se der ❌, anote o passo, a hora e um print (o `testes` transforma em defeito).

**Links dos APKs:** os do lote C vêm no recado de status das 5h do gerente. Build do b0e0462, se o lote C não sair:
Campo https://expo.dev/artifacts/eas/Yms5ftWzSyREgLxuN8z0dQ0AX68XZFpneC_bmLzHNQU.apk ·
Gestão https://expo.dev/artifacts/eas/WvPT97pfXk4sNlk8nrLfUZ0iAsQWJYY0E1iIucgNaRo.apk.

**Logins da demo** (`docs/status/demo.md`): código da empresa `demo`, senha `demo-macuxi`.
Campo: `vendedor@exemplo.com.br` (Lucas), `promotor@exemplo.com.br` (Joana). Gestão: `supervisor@exemplo.com.br` (Renata).
BKO: https://bko-demo.macuxifdv.com.br com `admin@exemplo.com.br` (ou `analista@`).
Tempo estimado: 60 a 75 min. Faça na ordem: o passo 30 usa o checkout do passo 27.

## 1. Instalar
| # | Ação | Esperado | ✅/❌ |
|---|---|---|---|
| 1 | Desinstale **Macuxi Campo** e **Macuxi Gestão** antigos (não instale por cima) | Os dois somem da gaveta de apps. Motivo: o pedido fantasma 000011 da base antiga (T-0079) fica na cópia local de quem só atualiza | |
| 2 | Instale os dois APKs novos e abra o Campo | Tela de login sem campo de servidor; não aparece "Servidor indisponível" | |
| 3 | Entre como Lucas e espere a primeira sincronização | Termina sem erro; em Pedidos **não** há número repetido nem o 000011 antigo | |

## 2. Início, Cliente 360 e Pedidos
| # | App | Ação | Esperado | ✅/❌ |
|---|---|---|---|---|
| 4 | Campo (Lucas) | Abrir o Início [B] | De cima para baixo: data, "Bom dia, Lucas" (no fuso de Manaus), "N visitas hoje · M feitas"; Recados de hoje; Meta de hoje (barra, "Faltam R$ X hoje", % do mês, **positivação do mês** preenchida); cards Orçamentos e A faturar lado a lado; no fim só Sincronizar + "Última sincronização hh:mm · N na fila". Sem "Seus módulos" | |
| 5 | Campo | Tocar em A faturar e depois em Orçamentos [B] | Cada card abre Pedidos já filtrado; a contagem bate com o card | |
| 6 | Campo | Abrir um cliente da rota (Cliente 360) [B] | Topo longe da barra de status; "Última compra" uma vez só; rodapé com 2 botões: Check-in (ou Visitado) e "+ Novo pedido"; nenhum "Ver catálogo" | |
| 7 | Campo | Pedidos: olhar o topo [B] | Título uma vez, "Novembro 2026" uma vez, uma linha de chips com contagem (chip ativo mostra 0 quando vazio), resumo "N pedidos · R$ X"; número do pedido em destaque; sem seletor de vendedor | |
| 8 | Campo | Buscar "11", depois "000011", depois um nome fantasia sem acento (ex.: "japiim") e uma razão social em minúsculas [B] | "11" e "000011" trazem o mesmo conjunto; nome e razão acham sem acento/maiúscula; trecho destacado; com texto, a busca ignora o período | |
| 9 | Campo | Apagar a busca; trocar Dia / Mês / Ano e usar ‹ › [B] | Dia abre o calendário com marca nos dias com pedido; "Hoje" aparece só como texto; Mês e Ano atravessam a virada sem repetir | |
| 10 | Campo | Modo avião → Mês = Julho (mais de 90 dias) [B] | "Disponível com conexão"; buscas e meses recentes continuam funcionando sem sinal | |
| 11 | Campo | Tirar o modo avião → Julho de novo [B] | A mensagem some e a lista vem do servidor (vazia ou com pedidos antigos, sem erro) | |
| 12 | Gestão (Renata) | Entrar e abrir o Início [B] | Mesma estrutura do Campo, com o nome da equipe (Equipe Manaus), meta da equipe, Pedidos para aprovar, Equipe agora e Sincronizar no fim | |
| 13 | Gestão | Pedidos → seletor **Vendedor** ao lado da busca [B] | Abre em folha; só Lucas e Camila (nenhum promotor, ninguém de fora da equipe); escolher um: chips, resumo e busca valem só para ele; "Todos os vendedores" volta; não há botão Novo | |
| 14 | Gestão | Aba Equipe [C] | Resumo em 2×2; "Parado" em amarelo legível e "Rota concluída" em verde | |
| 15 | Gestão | Modo avião → Alertas [C] | Aviso de sem sinal no topo (como em Aprovações), com o ícone de wifi cortado | |
| 16 | Gestão | Modo avião → abrir a ficha de um vendedor que ainda não estava no aparelho [C] | Título "Não deu para abrir a ficha" e o erro no texto (sem "Tentar de novo", esperado). Tire o modo avião | |

## 3. Vibração [B]
Pré: Android com "Retorno tátil / vibração ao tocar" **ligado** (Configurações → Som e vibração). A vibração é o toque curto do sistema.
| # | Ação | Esperado | ✅/❌ |
|---|---|---|---|
| 17 | Campo: tocar no botão principal de uma tela (ex.: Enviar no pedido), confirmar uma folha/diálogo e tocar em Desfazer no aviso do rodapé | Vibração leve e curta em cada um | |
| 18 | Rolar listas, trocar de aba, voltar | Não vibra | |
| 19 | Ligar "Remover animações" (Acessibilidade; na Samsung, Acessibilidade → Melhorias de visibilidade) e repetir o 17 | Não vibra e o botão não "afunda" (só fica mais claro). Se só mudar depois de fechar e abrir o app, anote como 🟡 | |
| 20 | Desligar "Remover animações" | Volta a vibrar | |

## 4. Visual novo de Promotor, Treinamento e Pesquisa
| # | App | Ação | Esperado | ✅/❌ |
|---|---|---|---|---|
| 21 | Campo (Joana, promotor) | Abrir uma loja da rota (tela da loja) [B/C] | Abas com respiro; textos sem sigla interna; o mix abre em folha (presente/reposição/ruptura dentro dela), com check só na opção escolhida; "Foto antes" e "Foto depois" com **ícone de câmera** [C], que vira check depois da foto [B]; "Concluir com foto" como botão secundário; **nenhum** botão, aba ou atalho de pedido (RN-PRO-01) | |
| 22 | Campo (Lucas) | Treinar → "Visita que vende" → lição "Venda consultiva" (quiz de 3) [B] | Na primeira abertura, o carregamento aparece **dentro do cartão**, sem fundo cinza nem cartão achatado [C]. Marque 2 de 3 e toque Enviar: abre a folha "Enviar com questões em branco?" com "1 em branco conta como errada". "Voltar ao quiz": as 2 marcações continuam. Toque Enviar de novo → **"Enviar assim"**: sai o resultado (nota; reprovado mostra "Não passou" sem fundo rosa). "Tentar de novo" limpa as marcações; "Voltar à trilha" aparece antes e depois do envio. Com as 3 marcadas, envia sem folha | |
| 22b | Campo (Lucas) | Treinar → Ranking [B/C] | Carregamento dentro do cartão [C]; regra de desempate no rodapé [B] | |
| 22c | Campo (Lucas) | Cliente 360 → aba Pesquisas; abrir "Exposição do café no PDV" [B/C] | Cartões das pesquisas tocáveis; respondida há menos de 7 dias mostra "Volta em dd/mm"; pesquisa que não vale para o cliente mostra o chip pequeno **"Não se aplica"** e, embaixo do título, "Não vale para este cliente" (sem espremer o título em tela estreita) [C]. Na resposta: "Obrigatória" em cinza neutro, botão de foto com câmera, chip "Tirada" junto de "Foto n" e a lixeira na ponta; Enviar abre a confirmação; descartar pede confirmação; sem sinal aparece "Na fila" | |

## 5. Checkout com motivo e pesquisa obrigatória (T-0039) [B/C]
Na demo, "Satisfação do cliente na visita" é etapa obrigatória do checkout de todo vendedor.
| # | App | Ação | Esperado | ✅/❌ |
|---|---|---|---|---|
| 23 | Campo (Lucas) | Check-in num cliente da rota → Checkout → "Sem pedido", sem escolher motivo | Não conclui: o motivo de não venda é exigido; a etapa "Satisfação do cliente na visita" aparece como **Obrigatória** | |
| 24 | Campo | Escolher um motivo, ainda sem responder a pesquisa | Continua sem concluir; a etapa segue Obrigatória | |
| 25 | Campo | Responder a pesquisa (com sinal) e concluir | Etapa "Feita"; visita concluída; na rota, "Sem pedido · motivo: …"; nenhum aviso "O servidor não aceitou o checkout" | |
| 26 | Campo | Outro cliente: **modo avião**, check-in, responder a pesquisa, checkout com motivo; depois tirar o modo avião e Sincronizar | Offline conclui normal; ao sincronizar a visita **continua concluída** e não aparece "O servidor não aceitou o checkout". Se aparecer [C]: ❌ (a API não viu a resposta da pesquisa antes do checkout); anote a hora | |
| 27 | Campo | Outro cliente: checkout com motivo do tipo "cliente fechado" | Pede a foto da fachada; as etapas obrigatórias ficam dispensadas; conclui com a foto | |

## 6. Parâmetros do Início no BKO e reflexo no app (T-0073) [B]
| # | Onde | Ação | Esperado | ✅/❌ |
|---|---|---|---|---|
| 28 | BKO (admin@) | Metas → painel "Parâmetros do Início": digitar 141 caracteres na frase padrão do recado; minutos de "parado" = 10 | Contador fica vermelho acima de 140 e o erro aparece no campo; minutos fora de 15–480 dão erro no campo; nada salva | |
| 29 | BKO | Frase = "Teste 05/11: bom trabalho!"; minutos = 15; desmarcar o sábado em dias úteis → "Salvar parâmetros" | Salva sem erro; ao recarregar a página os valores continuam | |
| 30 | Campo (Lucas) e Gestão (Renata) | Sincronizar e abrir o Início | Se a supervisora não marcou recado para hoje, o primeiro de "Recados de hoje" é "Teste 05/11: bom trabalho!"; "Faltam R$ X hoje" sobe (menos dias úteis no mês). No Gestão, Equipe agora mostra Lucas "Parado · Sem check-in há …" se passaram 15 min do checkout do passo 27 e ainda há paradas na rota dele | |
| 31 | BKO → apps | Voltar frase em branco, minutos 60 e o sábado marcado → salvar → sincronizar os dois apps | O app volta à frase padrão e à meta do dia de antes; Lucas sai de "Parado" (60 min) | |

## 7. Regressão rápida (sem efeito visível esperado)
| # | Ação | Esperado | ✅/❌ |
|---|---|---|---|
| 32 | Campo (Lucas): pedido de 8% → Gestão (Renata): Pedidos para aprovar → Aprovar → Campo: Sincronizar | Pedido aparece Aprovado no Campo; Pedidos para aprovar do Gestão diminui. Serve de fumaça da T-0024 (contratos de eventos), que não muda nada na tela | |
| 33 | Campo (Joana) | Início e Cliente 360 | Sem Orçamentos, A faturar, Pedidos para aprovar e "+ Novo pedido"; o Cliente 360 mostra "Compras dos últimos 12 meses" só de leitura | |
| 34 | (opcional; só se for recriar a base) GitHub Actions → "demo — recriar base" (digitar RECRIAR) com um pedido feito em modo avião no Campo antes; depois tirar o modo avião e sincronizar | A sincronização mostra "A base do servidor mudou: enviando a fila"; o pedido da fila chega com número novo; nenhum número repetido; o 000011 antigo some | |

Log sem dado pessoal (T-0078) também não tem efeito na tela: ficou coberto pelos testes automáticos L1 (`docs/testes/T-0078.md`).

## 8. O que NÃO está neste build (não reporte como defeito)
- **Tela de medição da T-0008** (7 toques na versão em Perfil, 20 mil SKUs): depende do `expo-sqlite`, que ficou fora do main por decisão do gerente. Os 7 toques não abrem nada ou mostram um aviso; se o app fechar sozinho, anote ❌.
- **Visual novo do Core (PR #94)**: check-in, checkout, rota, clientes e metas continuam com o visual anterior (botões das folhas no lugar antigo).
- "Tentar de novo" na ficha do vendedor sem sinal (passo 16): fica para uma rodada futura.
- Etapas de checkout do Promotor na API (`promotor.etapas_checkout@1`): ainda não existem; a da Pesquisa só no build do lote C (passo 26).
- O "realizado" da Meta de hoje depende de quem grava o indicador diário (pendente na T-0073); valores podem não mexer ao longo do dia.

Fontes: `docs/testes/T-0071.md`, `T-0072.md`, `T-0076.md`, `T-0077.md`, `T-0078.md`, `T-0079.md`; `git log aab84fa..origin/main`; recados do lote C (R-20261105-013939, -002639, -002709, -002701).
