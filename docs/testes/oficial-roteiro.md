# Roteiro do aparelho — Campo-Oficial / Gestao-Oficial (produção, sábado 14/11/2026)

Build: **Campo-Oficial-v<versão>** e **Gestao-Oficial-v<versão>**, dos perfis EAS `campo-producao` e `gestao-producao`. A versão é a de
`apps/mobile/scripts/eas/versao.json` no commit do build; no `main` de hoje ela é **1.0.6**. Fuso do tenant: Manaus.
Cobre as tarefas **T-0165 a T-0173**, como estão no `main`. A base são os roteiros `v1.0.5-roteiro.md` e `v1.0.6-roteiro.md`, que trazem
os números de cada caso. Este roteiro diz o que muda na produção e fecha os achados de marca **MC-0001** e **MC-0009**.
Ordem do dia: passo 12 de `docs/producao/sabado.md` (ponta a ponta às 13h). Nenhum APK é distribuído antes deste roteiro passar.

**Como registrar:** tire print dos passos com 📷. Eles vão junto com o relatório do corretor e o parecer de marca. Marque ✅ ou ❌.
Em ❌, anote a tela, o que apareceu, o que era esperado e a gravidade (alta, média ou baixa).
Os passos marcados com 🏷️ **fecham um achado de marca**: o print vai ao design-de-marca com o ID do achado.

---

## 0. O que muda no Oficial (ler antes de começar)
| # | Assunto | Na demo (v1.0.5 e v1.0.6) | No Oficial |
|---|---|---|---|
| 0.1 | Servidor | `api-demo.macuxifdv.com.br` | `api.macuxifdv.com.br`, fixo no build. O login não tem campo Servidor nem "Avançado" |
| 0.2 | Login | Lucas, da demo, com a senha conhecida | Usuário **real**, criado no BKO ou pelo cartão Equipe do portal. Chega por e-mail uma **senha temporária, válida por 72 h** |
| 0.3 | Dados | Base de demonstração (Lucas, AGU-1500, Freiomax CB 3401, 6 pedidos do mock, metas prontas) | **Nada de demonstração.** Só o que o Conector ou as Bases do portal carregaram do ERP do cliente |
| 0.4 | Primeira sincronização | Base pequena; termina em segundos | Carga real de clientes, rota, catálogo, preços, estoque, pedidos e metas. Pode levar minutos. Use Wi-Fi na primeira vez |
| 0.5 | Pedido de teste | Qualquer pedido | **Só o pedido combinado com o TI do cliente.** Ele vai para o ERP e é cancelado no ERP depois |
| 0.6 | Mudança no BKO (limite de desconto, frases, recados) | Livre | **Só na empresa `teste-macuxi`** (fica na produção, sem dado real) ou no usuário de teste combinado. Não mude parâmetro de usuário real |

**Antes de começar**
1. Desinstale o app Macuxi Campo de demonstração (e o Gestão, se houver). O pacote é o mesmo e o APK oficial instalaria por cima, mas a
   assinatura do perfil `*-producao` pode ser outra (o Android diz "App não instalado"), e a sessão e a base da demo não devem ir junto.
2. Data e hora do aparelho no fuso de Manaus, em automático.
3. Tenha à mão: o código da empresa, o e-mail do usuário de teste, o e-mail com a senha temporária e uma calculadora.
4. Confirme com o TI do cliente: as contagens da carga (clientes, produtos, preços) e o pedido que será feito no passo 11.
5. Confira que `https://api.macuxifdv.com.br/v1/saude` responde `"banco":"ok"` (passo 3 do `sabado.md`).

---

## 1. Ícone, splash e entrada (T-0172) — 🏷️ fecha a MC-0001
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 1.1 📷 | Gaveta de apps | Ícone e rótulo | Fundo Azul noite `#1E3350` com o logo v1; rótulo "Macuxi Campo", sem "Demo" nem "Oficial". Gestão: fundo Pérola `#F8F6F1`, logo positivo |
| 1.2 📷 🏷️ | Abra o app (Android 12 ou mais novo) | **Splash nativa** | Logo empilhado negativo **inteiro**, centrado: as pontas de "Macuxi" e de "FORÇA DE VENDAS" **não** são cortadas pelo círculo. Corte = ❌ médio (MC-0001) |
| 1.3 📷 🏷️ | Logo depois da splash | **Tela de entrada** | O logo fica **parado, no mesmo lugar e no mesmo tamanho** (136 dp) da splash, sem salto e sem piscar branco. "Olá, <nome>" abaixo, com respiro do logo (28 dp) |
| 1.4 | Ícones temáticos (Android 13+) | Ícone monocromático | Legível, sem quadrado branco |

Os prints 1.2 e 1.3, num Android 12+, fecham a MC-0001 (parecer `docs/marca/pareceres/2026-11-13-v1.0.5.md`). Mande os dois ao
design-de-marca. Se o aparelho for Android 11 ou mais antigo, anote: a MC-0001 só fecha com um Android 12+.

---

## 2. Permissões e login real
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 2.1 📷 | 1ª abertura | Tela **Permissões** | Vem antes do login: Notificações, Localização o tempo todo, Câmera, Fotos e galeria. Sem as quatro, não segue |
| 2.2 📷 | Tela de login | Campos | Faixa Azul noite com o logo negativo e o formulário no Pérola. **Código da empresa, E-mail e Senha.** **Sem** campo Servidor e sem "Avançado" (0.1) |
| 2.3 | Senha errada | Mensagem | "Código da empresa, e-mail ou senha incorretos". Nenhum dado do usuário no texto |
| 2.4 📷 | Entre com a senha temporária do e-mail | **Crie sua senha** | Pede a nova senha duas vezes. Recusa: menos de 8 caracteres, sem letra, sem número, sem caractere especial, ou igual ao e-mail |
| 2.5 | "Salvar e entrar" | Fluxo | Segue para a carga (seção 3). A senha temporária não entra mais |
| 2.6 | "Esqueci a senha" (com o usuário de teste) | E-mail | Chega uma nova temporária (olhe o spam). Ao entrar, o app pede senha nova |
| 2.7 | Servidor fora do ar (só se o engenheiro-software puder simular) | Mensagem | "Servidor indisponível — tente mais tarde" |

---

## 3. Primeira sincronização (T-0172, `docs/design/entrada-sync.md`)
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 3.1 📷 | Depois do 2.5 | Tela de carga | "Olá, <nome real>"; "Etapa n de N · <nome>" à esquerda e o % à direita; etapas na ordem **Envio do que ficou no aparelho · Clientes e rota · Catálogo e preços · Pedidos e metas · Fotos e materiais** (só as dos módulos contratados) |
| 3.2 | Acompanhe com cronômetro | Barra | O % nunca volta. Sem frase que se alterna, sem contagem de registros, sem nome de tabela. Anote o tempo total e o tamanho da carteira |
| 3.3 📷 | Fim | Entrada no app | "Pronto" e 100%, todas com ✓; o Início abre sozinho, sem botão |
| 3.4 | Compare com o ERP (TI do cliente) | Contagens | Clientes da carteira do usuário, produtos do catálogo e preços da tabela dele batem com o ERP. Diferença = ❌ alto (avise o modulo-integracao) |
| 3.5 📷 | Sair, modo avião e entrar de novo | Erro de rede | "Sem internet na etapa n de N" em vermelho, a etapa com "!", "Tentar de novo", "Continuar sem sincronizar" (só porque já houve carga) e "Trocar usuário" |
| 3.6 | Tire o modo avião e "Tentar de novo" | Retomada | Termina em 100% |
| 3.7 | Mais → Ajustes → Diagnóstico | Registro | A etapa em que parou no 3.5 aparece. Nenhum e-mail, CPF ou senha no registro |
| 3.8 📷 | Mais → Perfil | Linha da versão | **`Campo-Oficial-v<versão>`** (ou `Gestao-Oficial-v<versão>`). "Demo" aqui = ❌ alto: o APK é o errado |

---

## 4. Sem dados de demonstração
| # | Onde | O que conferir | Resultado esperado |
|---|---|---|---|
| 4.1 | Clientes, Catálogo e Pedidos | Nomes | Nenhum "Lucas", "AGU-1500", "Freiomax" ou cliente do mock. Qualquer dado da demo = ❌ alto (o tenant ou o build estão errados) |
| 4.2 | Pedidos | Lista | Só os pedidos reais do usuário que vieram do ERP. Sem histórico do ERP, a lista vazia mostra só o estado vazio, sem os 6 pedidos do mock |
| 4.3 | Performance e Início | Meta | Sem meta carregada para o mês: o card mostra que não há meta ("—" ou `sem_meta`), **nunca** um número inventado nem 0% de uma meta zero |
| 4.4 | Sino | Recados | Só os recados que a empresa mandou. Sem recado, o sino fica sem contador |
| 4.5 | Treinar | Trilhas | Só as trilhas que a empresa criou. Sem trilha, estado vazio, sem as trilhas da demo |

---

## 5. Início (T-0170; RN-CORE-41/42/43)
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 5.1 📷 | Abra o Início | Topo | Data · "DU n de N"; "Olá, <nome>"; a frase do dia abaixo da saudação; à direita, foto, avatar ou iniciais |
| 5.2 | Calculadora | DU | Novembro/2026: N = **23** (segunda a sábado, fora 02/11 e 20/11). Sábado 14/11 = "DU 11 de 23" |
| 5.3 | Frase do dia | Frase | Igual à do BKO (Parâmetros › Início, "Frase de hoje"). Se a empresa desativou todas, a linha some e nada fica no lugar |
| 5.4 📷 | Perfil → "Foto ou avatar", em modo avião | Avatar | Aparece na hora; ao reconectar, sobe uma vez |
| 5.5 📷 | Cartões | O que saiu | **Sem** "Orçamentos", **sem** "A faturar" e **sem** "Recados" no Início (RD-0248, RD-0249). Algum deles = ❌ médio |
| 5.6 | TalkBack | Leitura | Lê a data, o DU, a saudação e a frase; a foto lê "Foto de <nome>" |

## 6. Barra de abas (T-0170)
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 6.1 📷 | Barra inferior (vendedor) | Abas | **Início · Rota · Clientes · Pedidos · Performance · Mais**, aba ativa em Azul noite, sem "Metas" |
| 6.2 | Mais | Itens | Catálogo, Treinar e os módulos **contratados** pela empresa. Módulo sem licença não aparece |
| 6.3 | Botão voltar do Android em cada aba | Navegação | Volta ao Início; não fecha o app |
| 6.4 | Promotor real (se a empresa tiver) | Pedido | Sem a aba Pedidos e sem botão de novo pedido (RN-PRO-01) |
| 6.5 | Gestão | Abas | 5 posições |

## 7. Sino (T-0170) — 🏷️ fecha a MC-0009
Pré-requisito: o admin manda **1** recado ao usuário de teste pelo BKO e, depois, mais 9 ou mais (total **10 ou mais** não lidos).
Com a empresa real, use o usuário de teste combinado; se não houver, faça na `teste-macuxi` (0.6).
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 7.1 📷 🏷️ | Pedidos (sino **na faixa** Azul noite), **1** não lido | Cores | Botão **transparente** com borda `#3A4D68`; ícone **branco**; contador **laranja `#F59A52`** com o "**1**" escuro (`#16202A`) e aro na cor da faixa; o número inteiro, sem corte |
| 7.2 📷 🏷️ | Início (sino **fora da faixa**, no Pérola), **1** não lido | Cores | Botão branco com borda; ícone escuro; contador **`#C2540A`** com o "**1**" branco |
| 7.3 📷 🏷️ | **10 ou mais** não lidos, na faixa e fora dela | Contador | Mostra "**9+**" nos dois lugares, sem cortar o "+" e sem sair do botão |
| 7.4 | Toque no sino | Balão | O recado do dia (se marcado) no topo; "Ver todos" abre Recados e tarefas |
| 7.5 | Leia todos | Contador | Some |
| 7.6 | TalkBack | Leitura | "Recados e tarefas, N não lidos"; sem não lidos, não fala número |

Os prints 7.1, 7.2 e 7.3 fecham a MC-0009 (parecer `docs/marca/pareceres/2026-11-13-v1.0.6.md`). Contador em Azul noite sobre a faixa,
botão branco na faixa, "1" ou "9+" cortado = ❌ médio, e a MC-0009 continua aberta.

## 8. Performance (T-0170; RN-CORE-21/22/26)
Números com os casos R-1 em diante: `docs/testes/T-0170-performance.md`. Na produção, use a meta real do usuário e os pedidos dele.
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 8.1 📷 | Resultados, Este mês | Barras | Barra de meta de todos os cards em laranja `#C2540A`, abaixo e acima da meta (MC-0010) |
| 8.2 📷 | Produtividade | Ponto e valor | Ponto "fora" laranja, "dentro" verde; o valor em tinta escura `#16202A`, não em Azul noite |
| 8.3 | Faturamento (calculadora) | Valor × regra | Atingimento = real ÷ meta (1 casa); Gap = max(0, meta − real); Meta/dia = ⌈Gap ÷ DU restantes, contando hoje⌉; Real/dia = real ÷ DU decorridos. Real = pedidos aprovados, integrados ou faturados pela **data de emissão**, sem frete. Confira o real com o relatório do ERP do mês |
| 8.4 | Hoje (sábado é dia útil) | Meta do dia | A mesma do Início: ⌈(meta do mês − realizado até ontem) ÷ DU restantes⌉. Realizado do mês no lugar da meta do dia = ❌ alto |
| 8.5 | Meta batida | Texto | "batida"; nunca Meta/dia negativa |
| 8.6 | Modo avião | Base | Números do aparelho; o rodapé diz de quando é a base |

## 9. Clientes (T-0171)
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 9.1 📷 | Abra Clientes | Linha | Nome; embaixo **só** a última visita; à direita **uma** tag; a seta. Sem cidade, segmento, "N vencidos" ou "Curva A" |
| 9.2 | Tag | Ordem | **Bloqueado** > **Devendo** > **Pré-Cadastro** > **Em dia**. Confira na ficha 1 cliente real de cada (bloqueado no ERP, com título vencido, sem código do ERP) |
| 9.3 📷 | Última visita | Texto | "Visitado hoje/ontem/há N dias" ou "Nunca visitado". Se a carga trouxe visitas, elas aparecem: "Nunca visitado" em todos = ❌ alto (defeito antigo da regex de `ultima_visita_data`) |
| 9.4 📷 | Check-in num cliente em modo avião e volte | Offline | "Visitado hoje" sem sinal |
| 9.5 | Filtros | Rótulos | "Devendo", "Sem compra 45+ dias", "Bloqueados" |
| 9.6 | Gestão | Carteira | Mesma linha sobre a carteira da equipe |

## 10. Catálogo e busca (T-0173, T-0167)
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 10.1 📷 | Mais → Catálogo | Faixa | "Catálogo" e, **abaixo**, a contagem real ("N produtos"; "1 produto" no singular), igual ao total do ERP para a tabela do usuário. Selo do sync à direita |
| 10.2 📷 | Grade | Cartão | 2 colunas; foto (ou a inicial, se o cliente não mandou foto); nome em até 2 linhas; marca; preço em Archivo; uma tag de estoque. Sem código e sem hora |
| 10.3 | Tag de estoque | Cores | 10+ verde; 1 a 9 laranja; 0 vermelho "Sem estoque"; sem saldo "Estoque sem informação". Confira 3 produtos com o ERP |
| 10.4 | 1 e 2 letras; depois a 3ª | Busca | Só busca a partir da 3ª letra, depois de ~0,25 s |
| 10.5 📷 | Termo com mais de 20 resultados | Paginação | 20 na lista; "Mostrando 20 de N" e "+ Mostrar mais" no fim; contagem não repetida |
| 10.6 📷 | Código exato e EAN de um produto real | Ordem | O produto vem em 1º |
| 10.7 | Palavra com erro de digitação | Sugestão | "Você quis dizer “…”?"; o toque busca a sugestão |
| 10.8 📷 | Modo avião e uma busca | Aviso | Só o selo "Sem sinal". **Sem** o banner "A busca inteligente volta quando houver internet." (RD-0243) |
| 10.9 📷 | Categoria sem produto | Estado vazio | "Nenhum produto em <categoria>", sem "Ver todos" (RD-0244) |
| 10.10 | Código de concorrente (se o ERP manda equivalência) | Linha da marca | "Equivale a <marca> <código>"; o trecho não vem destacado (D-V106-3b, baixa) |
| 10.11 | Pela ficha de um cliente | Preço | Preço da tabela do cliente; "Sem preço" quando não há preço nessa tabela |
| 10.12 | Cronômetro, com o catálogo real | Tempo | Anote se a 1ª lista passa de ~0,3 s ou se o "+ Mostrar mais" demora. Anote também o número de produtos |

## 11. Novo pedido (T-0165, T-0166, T-0168) — só o pedido combinado
Use o cliente e os produtos combinados com o TI do cliente (0.5). Os números de exemplo dos roteiros da demo (AGU-1500, R$ 59,76) não
existem aqui; refaça as contas com os preços reais. Os passos que mudam parâmetro no BKO (11.9 a 11.11) vão para a `teste-macuxi`.
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 11.1 📷 | Novo pedido sem tocar em nada | Alertas | **0 alertas**; campos vazios em "Escolher", sem vermelho (T-0166) |
| 11.2 📷 | Venda | Cliente | Endereço, filial e CNPJ do cliente |
| 11.3 📷 | Folha do item | Totais | Valor de tabela · Desconto (%) · Desconto (R$) · Valor final; estoque ao lado da embalagem, igual ao "Est." da lista |
| 11.4 | Busca de item | Lista | "+" no lugar de "Adicionar"; item no pedido com o lápis |
| 11.5 📷 | Entrega | Campos | CIF/FOB antes do endereço; "Transportadora" numa linha, com a lista do BKO da empresa e "Outra (digitar)" por último |
| 11.6 📷 | Resumo | Ordem e tabela | Condição de pagamento · Itens · Entrega · Observação do pedido · Totais. Código (balão "nome - marca") · Emb. · Qtd · Valor tabela · % sempre · Total |
| 11.7 | Calculadora | Valor × regra | Σ Valor tabela = Valor de tabela; Desconto (R$) = tabela − final; Desconto (%) = Desconto (R$) ÷ tabela, 1 casa |
| 11.8 | Remover e Desfazer um item | Desfazer | "Item removido" com Desfazer por ~5 s; o item e o Valor final voltam |
| 11.9 | `teste-macuxi`: "Limitar desconto por pedido" com 8,0 no usuário de teste; sincronize | Limite | Totais "8,0%": não trava (só a alçada); "8,1%": trava com "Pedido acima do desconto máximo (8,0%)" e só "Salvar como orçamento" |
| 11.10 | `teste-macuxi`: orçamento de 9% → Transformar | Trava | Transformar desligado com a mesma frase; o orçamento continua orçamento |
| 11.11 | `teste-macuxi`: 11.9 em modo avião | Offline | Mesma decisão; ao reconectar, nada acima do limite sobe |
| 11.12 📷 | Empresa real: envie o pedido combinado acima da alçada | Fluxo | "Enviar para aprovação?"; o pedido sobe **uma vez** (sem duplicar ao reconectar) |
| 11.13 | Gestão: aprove | Histórico | Enviado → Em aprovação → Aprovado → Recebido no ERP; o número do ERP volta ao app |
| 11.14 📷 | PDF do cliente e do escritório | Logo e totais | Logo **da distribuidora** (o PNG do cliente), nítido e sem esticar; sem logo cadastrado, o padrão da marca v1. "PEDIDO" em Azul noite. Cliente: só "Valor final". Escritório: as 4 linhas. Dados da filial no cabeçalho |
| 11.15 | Avise o TI | Limpeza | O pedido é cancelado no ERP |

## 12. Pedidos (T-0170; RN-VEN-43)
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 12.1 📷 | Pedidos, Este mês | Cards | **Orçamentos em aberto**, **Pedidos enviados** e **Total**, cada um com quantidade e valor |
| 12.2 | Calculadora | Valor × regra | Total = orçamentos em aberto + enviados. Valor sem frete. Rascunho, na fila, recusado e cancelado fora; "Em aprovação" dentro. O pedido do 11.12 entra nos enviados |
| 12.3 | Pedido de um mês faturado no outro (se houver) | Data de emissão | Conta no mês de emissão |
| 12.4 📷 | Toque em "Orçamentos em aberto" e em "Pedidos enviados" | Filtro | A lista filtra; o chip usa o rótulo do card (RD-0247). "Total" não navega |
| 12.5 | Busca e chip de situação | Cards | Filtram só a lista; os cards não mudam |
| 12.6 | Período longo, com mais de 1.000 pedidos (se o ERP trouxe) | Corte | **Não há aviso de lista cortada** (D-V106-4). Na produção é **médio**: anote se o período passa de 1.000 pedidos e se os cards parecem completos |
| 12.7 | Gestão | Cards | Os mesmos 3 cards, somando a equipe ou o vendedor do filtro |

## 13. Treinar (T-0171; RD-0213)
Só se a empresa contratou Treinamento e criou trilhas; senão, anote "sem trilha" e confira o estado vazio (4.5).
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 13.1 📷 | Mais → Treinar | Trilha | Uma tag com o prazo (ou "Obrigatória", "Em andamento", "Concluída"); a barra; "N de M lições"; Começar/Continuar. "Atrasada" uma vez só |
| 13.2 | Abra a trilha | Cabeçalho | O mesmo da lista; sem "Abra a trilha para ver o que falta." |
| 13.3 | "1 de 1 lição" | Plural | Singular correto |

## 14. Gestão (Gestao-Oficial)
| # | O que fazer | O que conferir | Resultado esperado |
|---|---|---|---|
| 14.1 📷 🏷️ | Ícone, splash e entrada | Marca | Pérola `#F8F6F1` com o logo positivo, inteiro na splash (MC-0001 também no Gestão) |
| 14.2 | Login real do supervisor e carga | Etapas | Envio do que ficou no aparelho · Equipe · Aprovações · Metas · Alertas; Perfil `Gestao-Oficial-v<versão>` |
| 14.3 | Equipe | Dados | Só os vendedores reais da equipe dele; nenhum da demo |
| 14.4 | Aprovação do 11.13 | Fluxo | Aparece na fila de aprovações e some depois de aprovado |

---

## T-0169 (agente design-de-marca)
Sem tela no aparelho. Ela aparece aqui pelos 🏷️: o design-de-marca recebe os prints 1.2, 1.3, 7.1, 7.2, 7.3 e 14.1 e fecha a MC-0001 e
a MC-0009 no `docs/marca/catalogo.md`.

## Só o aparelho prova
- Splash nativa sem corte no Android 12+ (1.2, 14.1) e passagem sem salto (1.3).
- Cores do sino com 1 e com 9+ (7.1 a 7.3), da Performance (8.1, 8.2) e logo do PDF da distribuidora (11.14).
- Tempo da primeira sincronização (3.2) e da busca com o catálogo real (10.12).
- Contagens da carga contra o ERP (3.4) e o pedido indo e voltando do ERP (11.12, 11.13).
- TalkBack (5.6, 7.6).

## Desvios conhecidos que continuam abertos
| ID | O que é | Gravidade no Oficial | Dono |
|---|---|---|---|
| D-V106-4 | Lista de Pedidos cortada em 1.000 sem aviso (`orders-screen.tsx`, `cortada` sem uso) | **média na produção** (baixa na demo). Segura só se o 12.6 mostrar período com mais de 1.000 pedidos | modulo-vendedor e designer-ux |
| D-V106-3b | Trecho que casou com a busca sem destaque no cartão do Catálogo | baixa | modulo-catalogo |
| MC-0011 | Números dos cards de Pedidos em Plex Medium, não em Archivo | baixa | modulo-vendedor |
