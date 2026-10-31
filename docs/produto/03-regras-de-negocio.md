# 03 — Regras de negócio e permissões

Cada regra mora no `domain` do módulo dono, como função pura testada, e roda igual no app (offline), na web e na API. **A API sempre revalida.** Valores entre colchetes são parâmetros do tenant (tabela no fim).

## 1. Módulos e acesso
- **RN-CORE-01** Módulos efetivos do usuário = módulos ativos do tenant ∩ módulos do perfil ∩ exceções do usuário. Core é sempre ativo.
- **RN-CORE-02** Módulo desativado: some do app no próximo sync, os dados locais dele são apagados do aparelho e as rotas da API respondem 403 `MODULO_INATIVO`. Os dados na nuvem ficam guardados por [90] dias para reativação.
- **RN-CORE-03** Um módulo só aparece se suas dependências estão ativas; funcionalidades que usam extensão opcional (ex.: "pedido em nome" precisa do Vendedor) somem sem erro quando o módulo provedor está inativo.
- **RN-CORE-04** Escopo de dados: vendedor/promotor veem a própria carteira; supervisor vê a carteira da equipe; gerente vê as equipes abaixo; analista/assistente/admin veem o tenant.
- **RN-CORE-05** Isolamento total entre tenants (`tenant_id` do token + Row Level Security).
- **RN-CORE-15** Bloqueio de aparelho vale para o **tenant inteiro** (decisão do Alexandre, 2026-10-31): aparelho bloqueado (perda, roubo, desligamento) não autentica nenhum usuário daquele tenant; a resposta segue a regra do login (423 só revelado a quem acertou a senha). Na próxima conexão o app apaga os dados locais do tenant e a fila não enviada, com aviso na tela, e volta ao login. Bloqueio e desbloqueio no BKO por admin ou analista, com auditoria.

> **Esclarecimentos (gerente-projetos, 2026-10-30, T-0003/T-0006)**
> - **RN-CORE-01 — exceções só restringem.** Na Sprint 0 a exceção do usuário só **remove** módulos; nunca acrescenta módulo que o perfil não tem. Exceção que acrescenta vai para o backlog. A licença é checada **a cada requisição**, não fica congelada no JWT.
> - **RN-PRO-01 vale pelo perfil, não pelo módulo.** Mesmo que um promotor ganhe o Vendedor, as ações de pedido continuam negadas (UI e API).
> - **RN-CORE-02 — fila offline de módulo desativado.** Antes de apagar os dados locais, o app tenta enviar a fila (outbox) do módulo. A API rejeita os itens com 403 `MODULO_INATIVO`, e eles aparecem na tela de sync como "não enviado — módulo desativado". Os dados locais do módulo só são apagados depois que o usuário confirma que viu (nada some em silêncio).
> - **Login e e-mail (premissa).** O e-mail é único **por tenant** (`unique(tenant_id, email)`). A tela de login pede **código da empresa + e-mail + senha**; o código da empresa fica salvo no aparelho depois do primeiro login.
> - **Promotor e vendedor não acessam o BKO** na Sprint 0; usam só o app Macuxi Campo. O BKO é para admin, analista, assistente, supervisor e gerente.

## 2. Matriz de permissões (perfil × ação)
| Ação | Vendedor | Promotor | Supervisor/Gerente | Analista | Assistente | Admin |
|---|---|---|---|---|---|---|
| Ver Cliente 360 (inclui financeiro) | carteira | carteira | equipe | tenant | tenant | tenant |
| Criar/editar pedido | ✅ próprio | ❌ | ✅ em nome do vendedor | ✅ | ✅ | ❌ |
| Cancelar pedido (antes do envio ao ERP; depois, só no ERP) | ✅ próprio | ❌ | ✅ equipe | ✅ | ✅ | ❌ |
| Excluir rascunho | ✅ próprio | ❌ | ✅ próprio | ✅ | ✅ | ❌ |
| Ver pedidos | próprios | carteira (leitura) | equipe | tenant | tenant | tenant |
| Aprovar desconto/crédito | ❌ | ❌ | ✅ até a alçada | ✅ acima | ❌ | ❌ |
| Coletas de trade (gôndola, share, preço, ruptura, validade, pontos extras) | ❌ | ✅ | leitura | leitura | leitura | ❌ |
| Cadastros de trade (mix, metas de share, concorrentes, planogramas, checklists, tarefas) | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Consultar catálogo (vitrine, busca, ficha) | ✅ com preço e estoque | ✅ sem preço de tabela e sem estoque [`promotor_ve_preco_estoque` = não] | ✅ | ✅ | ✅ | ✅ |
| Conteúdo, sinônimos, destaques e termos sem resultado do catálogo | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Responder pesquisa | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Criar pesquisa / trilha | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Ativar/desativar módulos e usuários | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

> **Esclarecimento (gerente-projetos, 2026-10-31, observação O-3 da T-0006)**: pela matriz acima, o promotor **lê** os pedidos da própria carteira (somente leitura) e nunca cria, edita, cancela, duplica ou exclui (RN-PRO-01). A API deve liberar a leitura com escopo de carteira e continuar negando toda escrita.

## 3. Core — visita, rota, metas
- **RN-CORE-10** Check-in só dentro de [200 m] do cliente; fora do raio exige justificativa e fica sinalizado. Cliente sem coordenada: o 1º check-in sugere a coordenada para o BKO aprovar.
- **RN-CORE-11** Um atendimento aberto por vez; o esquecido fecha sozinho na virada do dia (fuso do tenant) como "não finalizado".
- **RN-CORE-12** Checkout exige as etapas obrigatórias registradas pelos módulos ativos (ex.: pesquisa obrigatória) e motivo quando não houve pedido (se Vendedor ativo).
- **RN-CORE-14** Visita sem atendimento por **cliente fechado**: motivos `loja_fechada` e `acesso_negado`, com foto da fachada obrigatória, valem para vendedor e promotor. Eles dispensam as etapas obrigatórias do checkout (inclui a pesquisa obrigatória, RN-PES-03, e o checklist da loja, RN-PRO-06). O core informa o motivo às etapas do slot `visita.etapas_checkout`.
- **RN-CORE-13** GPS só no check-in/checkout; sem rastreamento contínuo.
- **RN-CORE-20** Visitado = check-in no dia; positivado = ≥ 1 pedido na [base de apuração] no período; cobertura = visitados ÷ planejados.
- **RN-CORE-21** Realizado da meta = soma dos pedidos na [base de apuração: aprovado | faturado], líquido de cancelamentos; o pedido feito pelo gestor em nome do vendedor conta para o **vendedor**.
- **RN-CORE-22** Necessidade diária = (meta − realizado) ÷ dias úteis restantes.

## 4. Vendedor — preço, desconto, crédito, estoque, status
- **RN-VEN-01** Preço base = tabela vigente do cliente na data do pedido; sem preço → item não vendável.
- **RN-VEN-02** Preço final do item = base × (1 − desc. item); total = Σ itens × (1 − desc. total) ± ajuste financeiro da condição. Arredondamento em centavos, meia para cima, por item.
- **RN-VEN-03** Desconto efetivo = 1 − (total final ÷ total pela tabela).
- **RN-VEN-10** Alçada: ≤ [vendedor 5%] aprova; ≤ [supervisor 10%] vai ao supervisor; ≤ [gerente 15%] vai ao gerente; acima → analista. Pedido feito pelo gestor usa a alçada do gestor.
- **RN-VEN-11** Abaixo do preço mínimo do produto → sempre analista.
- **RN-VEN-12** Crédito disponível = limite − saldo em aberto − pedidos aprovados não faturados. Excedeu → [enviar para aprovação | bloquear].
- **RN-VEN-13** Título vencido há mais de [5] dias → só à vista ou com aprovação. Cliente bloqueado/inativo → só orçamento.
- **RN-VEN-14** Condição de pagamento apenas entre as permitidas ao cliente.
- **RN-VEN-20** Disponível = saldo do ERP − reservas; reserva quando a API aceita o pedido; libera em cancelamento, rejeição ou faturamento. Insuficiente → [permitir com aviso | bloquear | cortar].
- **RN-VEN-21** Quantidade múltipla do múltiplo de venda; item repetido soma quantidade.
- **RN-VEN-22** Pedido mínimo [desativado].
- **RN-VEN-30** Status: `rascunho` → `na_fila` → `recebido` → `em_aprovacao` → `aprovado` | `rejeitado` → `integrado_erp` → `faturado` (parcial/total); `cancelado` antes de `integrado_erp`. Cada transição gera evento com autor, data/hora e motivo.
- **RN-VEN-31** Editar/cancelar só antes de `integrado_erp`; editar pedido aprovado volta para revalidação. "Excluir" pedido enviado = cancelar com motivo; só rascunho é apagado.
- **RN-VEN-32** Orçamento não reserva estoque, não consome crédito e expira em [7] dias.
- **RN-VEN-33** UUID do pedido gerado no aparelho; reenvio não duplica.
- **RN-VEN-34** Pedido pode ser para cliente diferente do check-in aberto ("fora de visita").
- **RN-VEN-35** Pedido em nome: `vendedor_id` = vendedor, `autor_id` = gestor; vendedor recebe notificação.
- **RN-VEN-36** Alerta de ruptura do promotor aparece para o vendedor responsável por [7] dias ou até o próximo pedido do cliente.
- **Cancelamento depois do envio ao ERP**: a partir do status 'enviado', o pedido não pode ser cancelado no Macuxi (UI e API respondem 422 com o código da regra e a mensagem "Pedido já enviado ao ERP — cancele no ERP"); o cancelamento é feito no ERP e chega pelo retorno do Hub como status 'cancelado'.

## 5. Promotor (trade marketing)
- **RN-PRO-01** Promotor nunca cria, edita, cancela, duplica ou exclui pedido — regra aplicada na UI **e** na API (403).
- **RN-PRO-02** Coletas (fotos, gôndola, share, preço, ruptura, validade) só com check-in aberto na loja; fotos tiradas na hora pela câmera do app [galeria bloqueada], com data/hora. A coordenada é registrada quando disponível; sem sinal de GPS a foto é aceita com `sem_gps = true`. A prova de presença é o check-in da visita. O gestor vê o % de fotos sem GPS por promotor.
- **RN-PRO-03** Share (%) = frentes nossas ÷ frentes totais da categoria × 100 (ou cm nossos ÷ cm totais, quando medido em centímetros). Atingimento = share ÷ meta de share da loja/categoria.
- **RN-PRO-04** Índice de preço = preço nosso ÷ preço do concorrente de referência × 100. Preço que varia mais de [50%] em relação à última coleta pede confirmação (evita erro de digitação).
- **RN-PRO-05** Ruptura (%) = itens do mix obrigatório em ruptura (ruptura total + ruptura na gôndola com produto no depósito) ÷ itens do mix obrigatório × 100. A ruptura na gôndola com produto no depósito também é mostrada à parte (falha de reposição).
- **RN-PRO-06** Checkout da visita exige as etapas obrigatórias do checklist da loja, exceto cliente fechado (`loja_fechada` ou `acesso_negado`, com foto da fachada — RN-CORE-14).
- **RN-PRO-07** Visita só conta nos indicadores com permanência mínima de [10 min]; abaixo disso é sinalizada ao gestor.
- **RN-PRO-08** Validade: vencido (dias < 0) · crítico ≤ [7] dias · atenção ≤ [30] dias · ok. Validade próxima = vencido + crítico + atenção.
- **RN-PRO-09** Alerta de ruptura vai ao vendedor responsável pelo cliente; se houver mais de um, ao da [linha do produto] ou ao primeiro da carteira.
- **RN-PRO-10** Checklist, mix obrigatório e metas de share valem por vigência; a coleta guarda a versão vigente no momento.
- **RN-PRO-11** Conformidade da gôndola (%) = (conformes + parciais × [peso do parcial]) ÷ gôndolas registradas × 100; peso padrão [0]. Motivo obrigatório quando não conforme; o total de parciais aparece à parte.

## 6. Pesquisa
> Decisões do Alexandre em 2026-10-31 (R-20261031-125833), a partir das premissas da T-0012. As demais premissas de `docs/modulos/pesquisa/regras.md` ficam aceitas.
- **RN-PES-01** Pesquisa publicada é imutável; mudanças geram nova versão; respostas guardam a versão. Resultado consolidado entre versões só para perguntas com o mesmo identificador estável; as demais aparecem por versão.
- **RN-PES-02** Frequência conta **por cliente** (não por cliente + usuário), em períodos civis (semana ou mês) no fuso do tenant.
- **RN-PES-03** Pesquisa obrigatória no checkout bloqueia o checkout até ser respondida, exceto cliente fechado (RN-CORE-14).
- **RN-PES-04** Resposta offline guarda a hora do aparelho e o servidor grava `recebido_em`. Relógio do aparelho adiantado mais de [24 h] ou resposta fora da vigência: **aceita e sinalizada** (flag de suspeita visível no resultado), nunca recusada.
- **RN-PES-05** Regras condicionais: "mostrar" combina com OU; "ocultar" vence. Público-alvo: a lista de clientes soma (OU) aos segmentos. "Canal" fica fora do público-alvo até o Core ter esse campo.
- **RN-PES-06** Código de barras com dígito GS1 inválido: aviso, não bloqueio. Foto: no máximo [1600 px] no maior lado, JPEG qualidade [80] (mesma regra do Promotor).
- **RN-PES-07** Limites do construtor (parâmetros do tenant): [50] perguntas, [20] opções por pergunta, [10] fotos, [2000] caracteres por resposta de texto.

## 7. Treinamento
> Decisões do Alexandre em 2026-10-31 (R-20261031-103502), a partir das premissas da T-0011. Valores entre colchetes são parâmetros do tenant.
- **RN-TRE-01** XP: lição concluída [10]; acerto no quiz [5 por questão]; trilha concluída [50]; streak diário [2 × dias, até 20]. Teto diário de [200] XP somando lição, quiz, trilha e streak; com o teto estourado, grava lançamento de 0. XP é append-only e idempotente.
- **RN-TRE-02** Quiz: nota mínima [70%] para concluir; até [3] tentativas por dia no fuso do tenant; XP de acerto só na 1ª tentativa, mesmo reprovada. Refazer quiz aprovado é permitido, sem XP; vale a melhor nota (configurável); intervalo entre tentativas [0] (desligado).
- **RN-TRE-03** Ranking por XP no período; desempate: XP → quem atingiu primeiro → trilhas concluídas → nome → id. Ranking visível apenas dentro do mesmo tenant; padrão só vendedor e promotor (configurável). Semana do ranking: segunda a domingo no fuso do tenant.
- **RN-TRE-04** Progresso feito offline sincroniza e é validado no servidor. Tempo mínimo da lição para contar = o maior entre [30 s] e [50%] da duração estimada (quando informada).
- **RN-TRE-05** Streak: o dia conta com lição concluída ou quiz respondido até o fim (abrir e abandonar não conta); paga 1 vez por dia.
- **RN-TRE-06** Níveis: faixas [0/100/250/450/700/1000/1400/1900/2500/3200] XP. Medalhas padrão: primeira trilha, nota 100, 7 dias seguidos.
- **RN-TRE-07** Público-alvo: perfis e equipes; com os dois preenchidos vale a interseção, com um só vale esse, vazio = tenant todo.
- **RN-TRE-08** Desafio de vendas: paga XP quando o pedido é **faturado** (evento `vendedor.pedido.faturado@1`), não quando é criado; idempotente pelo `evento_id` do envelope (faturamento parcial soma os itens de cada retorno; um segundo faturamento total do mesmo pedido não paga); faturamento parcial sem itens é ignorado; fora do teto diário, com teto próprio [`xp_max_por_desafio`] e `xp_max_por_pedido` acumulado entre eventos. Sem estorno nesta fase. O XP de um mesmo vendedor é processado um de cada vez (tenant + usuário).

## 8. Catálogo
> Decisões do Alexandre em 2026-10-31 (R-20261031-172619), aplicadas no módulo pela T-0021 (texto de `docs/modulos/catalogo/regras.md` §9).
- **RN-CAT-01** Busca inteligente só responde com produtos do tenant e respeita o escopo (preço da tabela do cliente em contexto).
- **RN-CAT-02** "Pergunte ao catálogo" responde só com conteúdo cadastrado e cita a fonte; sem base → informa que não encontrou.
- **RN-CAT-03** Limite de consultas de IA por usuário/dia [200] para controle de custo; só consulta respondida pelo provedor conta. Falha do provedor (erro ou tempo esgotado), resposta do cache, busca offline e busca simples não consomem. O dia vira no fuso do tenant.
- **RN-CAT-04** Consulta do catálogo (busca, ficha, fotos, "pergunte ao catálogo") para todos os perfis; conteúdo, sinônimos, destaques e termos sem resultado só analista e admin.
- **RN-CAT-05** O promotor vê a ficha e as fotos, mas não vê preço de tabela nem estoque, nem filtra/ordena por eles [`promotor_ve_preco_estoque` = não]; com o parâmetro ligado, vê como o vendedor.
- **RN-CAT-06** Item fora da tabela de preço do cliente em contexto aparece como "Sem preço para este cliente" e não é vendável; nunca cai na tabela padrão do tenant.
- **RN-CAT-07** Estoque: "baixo" de 1 até [10] unidades, número exato visível [sim], "desatualizado" depois de [24 h] sem atualização; a tela sempre mostra "atualizado às hh:mm" (fuso do tenant).
- **RN-CAT-08** Ranking da busca: pesos [semântico 0,4; estoque 0,10; mais vendido 0,10; campanha 0,05] e cache [10 min, a partir da 2ª repetição] são parâmetros do tenant; serão calibrados no critério de aceite da Sprint 3.

## 9. Integração (Hub `/integracao/v1`)
> Registradas na T-0009 (2026-10-31) a partir das "Regras técnicas" do doc 06. Valores entre colchetes são parâmetros do tenant.
- **RN-INT-01** Lote: uma entidade por lote, `modo` completo | delta, até [5.000] registros; o Hub responde 202 com o id do lote e processa de forma assíncrona. Envelope inválido (entidade desconhecida, lote vazio, acima do limite, versão de contrato não suportada) é recusado inteiro, sem processar linha.
- **RN-INT-02** Idempotência: a chave do registro é (tenant, entidade, `external_id`) + hash do conteúdo canônico. Reenvio com o mesmo hash não altera nada nem publica evento; hash diferente atualiza e publica `integracao.<entidade>.atualizado@1`. `external_id` repetido no mesmo lote: vale a **última** ocorrência e as anteriores ficam como aviso `duplicado_no_lote` (não é erro).
- **RN-INT-03** Erro por linha: linha inválida vai para `lote_linha_erro` com código, campo e motivo legível no BKO, sem o valor de dado pessoal; não trava o lote. Resultado do lote: `concluido` (sem erro), `concluido_com_erros` (parte das linhas com erro) ou `falhou` (todas as linhas com erro ou falha de processamento). Erros de referência ausente são reprocessáveis; erros de validação exigem reenvio corrigido.
- **RN-INT-04** Ordem de dependência da carga: vendedor → cliente → (rota, título, nota/histórico); produto → (preço, estoque). Linha que cita `external_id` de outra entidade ainda inexistente fica com erro `referencia_ausente` (reprocessável), nunca cria registro órfão.
- **RN-INT-05** Delta por cursor: o cursor é por (tenant, conector, entidade) e vale o maior par (`alterado_em`, `external_id`) das linhas aceitas; só avança quando o lote termina (`concluido` ou `concluido_com_erros`) e nunca retrocede (reenvio antigo é aceito sem voltar o cursor).
- **RN-INT-06** Carga completa: pode ocupar vários lotes da mesma sessão (parte n, último = sim); só ao concluir o último lote os registros da entidade ausentes da carga são inativados (`deleted_at`), nunca apagados. Sessão incompleta não inativa nada.
  - **Trava de inativação em massa** (confirmada pelo Alexandre em 2026-10-31): se uma carga for inativar mais de [30%] dos registros ativos de uma entidade, o lote fica parado aguardando confirmação no BKO. Parâmetro `limite_inativacao_pct`.
- **RN-INT-07** Reconciliação diária por entidade: compara contagem de registros ativos e soma de controle (centavos ou quantidades) informadas pelo ERP com as do Macuxi; divergência acima da tolerância [contagem 0; soma 0,5%] gera alerta no monitor.
- **RN-INT-08** Devolução de pedido ao ERP: só pedido `aprovado` entra na fila de pendentes; a entrega é idempotente pelo UUID do pedido. Retorno: `pendente` → `enviado` (Conector retirou) → `integrado` (nº ERP) | `rejeitado_erp` (motivo); `integrado` → `faturado_parcial` → `faturado_total`. `enviado` sem confirmação em [10 min] volta a `pendente`. Cancelamento feito no ERP volta pelo retorno como `enviado`/`integrado`/`faturado_*` → `cancelado`, com o motivo quando o ERP informar; o Macuxi nunca escreve cancelamento no ERP. Cada retorno publica `integracao.pedido.retorno_erp@1`.
- **RN-INT-09** Contrato `/integracao/v1`: dinheiro em centavos inteiros, datas ISO 8601 UTC, `external_id` obrigatório; campo novo opcional é compatível; mudança incompatível vira `/v2` com ADR e a versão anterior fica ativa por [6 meses].

> **Conector (decisões do Alexandre em 2026-10-31, T-0013)**: linhas inválidas vão ao Hub com o motivo, até [500] por entidade por lote (acima disso, só a contagem). Atualização na v1 = pacote assinado para baixar + aviso no monitor do Hub quando o Conector estiver abaixo da versão mínima ou recomendada (atualização automática na v2). Uma chave de API por Conector (não por tenant), rotacionável no BKO, escopo só `/integracao/v1`, guardada no Windows Credential Manager. Bancos: Oracle primeiro, Firebird depois, MySQL sob demanda.

## 10. Auditoria
- **RN-AUD-01** Ficam na auditoria: alterações de preço, limite, alçada, status de pedido, licenças de módulos, perfis, parâmetros e publicações de pesquisa/trilha (quem, quando, antes/depois).

## 11. Gestor
> Decisões do Alexandre em 2026-10-31 (R-20261031-165536), a partir das premissas da T-0014.
- **RN-GES-01** Alerta "cliente sem visita": frequência de visita do cliente + [50%] (semanal → 10 dias; quinzenal → 21; mensal → 45); [30] dias só para cliente sem frequência. O alerta dispara quando **passa** do limite (quinzenal: dia 21 não alerta, dia 22 alerta). Outros alertas: ritmo mínimo da meta [80%], aprovação parada além do prazo da RN-GES-03, [3] rupturas em [14] dias, [20%] de fotos sem GPS.
- **RN-GES-02** Cliente nunca visitado só gera alerta depois de **passar** da carência de [15] dias na carteira (dia 15 não alerta, dia 16 alerta).
- **RN-GES-03** Prazo da aprovação em **dias úteis** [1] (não em horas): pedido de sexta 17:00 vence segunda 17:00. Dias úteis pelo calendário de ${BT}packages/comum${BT} (herdado da Fase M), com feriados nacionais e os feriados cadastrados pelo tenant, no fuso do tenant. O alerta de aprovação parada usa o mesmo prazo.
- **RN-GES-04** O gerente pode decidir item do nível do supervisor; fica na auditoria e o supervisor é avisado.
- **RN-GES-05** Cobertura de rota = visitas planejadas realizadas ÷ planejadas (máximo 100%); visitas fora da rota viram o indicador "visitas extras".
- **RN-GES-06** Dois números de venda: "vendido" (valor do pedido) e "faturado" (o que o ERP faturou); a diferença aparece como "a faturar".
- **RN-GES-07** Analista e admin veem os painéis do tenant em modo leitura no BKO.
- **RN-GES-08** Comentário obrigatório só na rejeição; aprovar continua em 1 toque.

## Parâmetros do tenant (padrões)
| Parâmetro | Padrão |
|---|---|
| Alçadas vendedor / supervisor / gerente | 5% / 10% / 15% |
| Crédito excedido | enviar para aprovação |
| Dias de atraso para restringir | 5 |
| Estoque insuficiente | permitir com aviso |
| Pedido mínimo | desativado |
| Raio de check-in | 200 m |
| Validade do orçamento | 7 dias |
| Alerta de ruptura ao vendedor | 7 dias |
| Permanência mínima na loja (promotor) | 10 min |
| Validade crítica (`validade_critica_dias`) | 7 dias |
| Janela de validade próxima (`validade_proxima_dias`) | 30 dias |
| Peso do parcial na conformidade de gôndola (`peso_parcial_conformidade`) | 0 |
| Tolerância de variação de preço | 50% |
| Fotos de trade só pela câmera | sim |
| Base de apuração de metas | aprovado |
| Retenção de dados de módulo desativado | 90 dias |
| Limite de consultas de IA | 200/usuário/dia |
| Registros por lote de integração | 5.000 |
| Tolerância da reconciliação (contagem / soma) | 0 / 0,5% |
| Reenvio de pedido ao ERP sem confirmação | 10 min |
| Teto diário de XP (`xp_teto_diario`) | 200 |
| Teto de XP por desafio de vendas (`xp_max_por_desafio`) | definido no desafio |
| Tempo mínimo da lição (`licao_tempo_min_s` / `licao_tempo_min_pct`) | 30 s / 50% da duração |
| Nota mínima do quiz / tentativas por dia | 70% / 3 |
| Intervalo entre tentativas de quiz | 0 (desligado) |
| Ranking padrão (perfis) | vendedor, promotor |
| Limite de inativação em massa na integração (`limite_inativacao_pct`) | 30% |
| Limites do construtor de pesquisa (perguntas / opções / fotos / caracteres) | 50 / 20 / 10 / 2000 |
| Tolerância do relógio do aparelho (pesquisa) | 24 h (acima disso, sinaliza) |
| Foto (maior lado / qualidade JPEG) | 1600 px / 80 |
| Promotor vê preço de tabela e estoque no catálogo (`promotor_ve_preco_estoque`) | não |
| Estoque baixo até (`estoque_baixo_ate`) / mostrar quantidade (`estoque_mostrar_quantidade`) / desatualizado após (`estoque_defasado_horas`) | 10 / sim / 24 h |
| Cache da busca (`cache_ttl_s` / `cache_min_ocorrencias`) | 600 s / 2 |
| Ranking da busca (semântico / estoque / mais vendido / campanha) | 0,4 / 0,10 / 0,10 / 0,05 |
| Linhas inválidas enviadas pelo Conector por entidade e lote | 500 |
| Alertas do gestor: tolerância sobre a frequência (`pct_tolerancia_frequencia`) / sem frequência (`dias_sem_visita_padrao`) | 50% / 30 dias |
| Alertas do gestor: carência de cliente novo (`dias_carencia_cliente_novo`) / ritmo mínimo / rupturas / fotos sem GPS | 15 dias / 80% / 3 em 14 dias / 20% |
| Prazo da aprovação (`prazo_aprovacao_dias_uteis`) | 1 dia útil |
| Horário comercial (`horario_comercial`) | seg–sex 08:00–18:00, fuso do tenant, feriados nacionais + do tenant |
| Fuso horário | America/Manaus |
