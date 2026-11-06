# 02 — Módulos e requisitos

Prioridade: **P0** obrigatório no lançamento do módulo · **P1** desejável · **P2** depois. Canais: 📱C = app Campo · 📱G = app Gestão · 🖥️ = Web BKO · ⚙️ = API.
Cada módulo declara: depende de, eventos que **publica** e **consome**, e pontos de extensão que **oferece** ou **usa**. O catálogo oficial fica em `.coord/contratos/` no repositório.

---

## CORE — obrigatório
**Depende de**: nada. **Publica**: `core.cliente.atualizado@1`, `core.visita.checkin@1`, `core.visita.checkout@1`, `core.usuario.modulos_alterados@1`. **Oferece extensões**: `cliente.abas`, `cliente.acoes`, `visita.etapas_checkout`, `inicio.cards`, `menu.itens`.

- **RF-CORE-01 (P0)** Login e-mail/senha, sessão persistente, funciona offline após o 1º login; bloqueio remoto de usuário/aparelho. 📱C📱G🖥️
- **RF-CORE-02 (P0)** Perfis e hierarquia (gerente → supervisor → vendedor/promotor); carteira N:N cliente × usuário × papel. 🖥️
- **RF-CORE-03 (P0)** **Licenciamento de módulos**: tela no BKO para ativar/desativar módulo por tenant, padrão por perfil e exceção por usuário; tela "Meus módulos" no app. 🖥️📱
- **RF-CORE-04 (P0)** Cliente 360: cadastro, contatos (ligar/WhatsApp em 1 toque), mapa, financeiro (limite, saldo, crédito disponível, títulos vencidos/a vencer, bloqueio), histórico de compras (últimos pedidos, última compra, ticket médio, frequência). 📱C📱G🖥️
- **RF-CORE-05 (P0)** Rotas: rota do dia (lista + mapa + status), agenda por frequência, visita extra; editor de rotas no BKO (reordenar, adicionar da carteira, 2-opt, copiar dia — herdado da Fase M). 📱C🖥️
- **RF-CORE-06 (P0)** Visita: check-in com GPS e raio, um atendimento aberto por vez, checkout com resultado; módulos acrescentam etapas (ex.: pesquisa obrigatória). 📱C
- **RF-CORE-07 (P0)** Sincronização offline: carga inicial, pull incremental, outbox, tela de sincronização com pendências e erros. 📱
- **RF-CORE-08 (P0)** Metas e indicadores básicos: meta × realizado, positivação, cobertura de rota (base para Vendedor e Gestor). 📱🖥️
- **RF-CORE-09 (P0)** Central de notificações e recados para o usuário (push + caixa no app). 📱
- **RF-CORE-10 (P1)** Pré-cadastro de cliente pelo campo, aprovado no BKO.
- **RF-CORE-11 (P0)** Cadastro mínimo do cliente: verificação dos campos obrigatórios do tenant (RN-CORE-16), etiqueta "Cadastro incompleto" e linha automática em Observações (RN-CORE-17) no app (Campo e Gestão) e no BKO. 📱C📱G🖥️
- **RF-CORE-13 (P0)** Cadastro do produto no BKO: custo e preço de venda (do ERP; editáveis quando o tenant não integra), margem, markup e lucro calculados, desconto máximo aplicável (vazio = padrão do tenant, 15%), preço mínimo e margem no mínimo; aba Parâmetros com o desconto máximo padrão (admin/analista). Custo e derivados só no BKO (RN-CORE-18). 🖥️
- **RF-CORE-14 (P0)** Medidas por tenant em Parâmetros → Produtos (sigla até 4 letras, única; descrição; ativo; não apaga em uso), com a lista inicial UN, CX, PCT, FD, LT, BD, TB, GL, KG, DZ, DP; produto com medida da unidade e embalagem opcional (RN-CORE-19). 🖥️
- **RF-CORE-12 (P0)** Endereços de entrega do cliente vindos do ERP (principal + outros), visíveis no Cliente 360 e escolhidos no pedido (RN-VEN-17). 📱C🖥️

## CAT — Catálogo
**Depende de**: Core. **Publica**: `catalogo.produto.visualizado@1`, `catalogo.busca.realizada@1`. **Oferece extensão**: `produto.acoes` (ex.: Vendedor registra "Adicionar ao pedido"). **Consome**: `integracao.produto.atualizado@1`, `integracao.estoque.atualizado@1`, `integracao.preco.atualizado@1`.

- **RF-CAT-01 (P0)** **Busca em linguagem natural** online: "detergente neutro 5 litros com estoque", "o mais barato da marca X para o cliente atual" → interpreta intenção, filtros (categoria, marca, atributo, preço, estoque) e ranking híbrido (texto + semântico). 📱
- **RF-CAT-02 (P0)** Busca offline: texto livre com tolerância a erro de digitação, sinônimos do tenant, código, EAN; aviso discreto "busca inteligente volta quando houver internet". 📱
- **RF-CAT-03 (P0)** Ficha do produto: fotos, atributos, embalagem/múltiplo, preço da tabela do cliente em contexto, estoque disponível com hora da atualização, argumentos de venda, produtos substitutos e complementares.
- **RF-CAT-04 (P0)** Navegação pela **árvore do catálogo** do tenant (níveis e nomes vindos do ERP, ex.: Categoria › Família › Grupo › Subgrupo) com trilha clicável, chips de filtro (marca, com estoque, campanha) e favoritos; offline. Dentro do pedido, mostra só os produtos da tabela de preço do cliente. 📱C📱G
- **RF-CAT-05 (P1)** "Pergunte ao catálogo": perguntas sobre o produto respondidas só com dados cadastrados (ficha, manual, FAQ) e citando a fonte; sem resposta → "não encontrei na base".
- **RF-CAT-06 (P1)** Comparar até 3 produtos; leitor de código de barras pela câmera.
- **RF-CAT-07 (P0)** BKO: enriquecer conteúdo (fotos, vídeos curtos, argumentos, sinônimos, FAQ, PDFs técnicos), ver termos buscados sem resultado. 🖥️
- **RF-CAT-08 (P1)** Pacote de fotos completo só no Wi-Fi; sob demanda no 4G.
- **RF-CAT-09 (P0) Catálogo do cadastro** O catálogo é gerado do cadastro dos produtos, sem conteúdo à parte. Hierarquia **sistema › grupo › linha** (vinda do ERP ou do BKO). Por item: código, medida e embalagem, descrição, **aplicação**, **oferece junto** (códigos complementares), **equivale a** (referências cruzadas), etiquetas curtas (ex.: posição dianteiro/traseiro, lado, "novo"), foto e preço/estoque no contexto do cliente. App: lista por linha com busca e ficha do produto. BKO: exportação do catálogo em PDF por sistema/linha (sumário com contagem de itens e tabela Código · Aplicação · Oferece junto · Equivale a) e em Excel. *(Decisão do Alexandre, R-20261105-112117 e R-20261105-191229; T-0085.)*

## VEN — Vendedor (pedido e pré-venda)
**Depende de**: Core; usa Catálogo se ativo (extensão `produto.acoes`). **Publica**: `vendedor.pedido.criado@1`, `vendedor.pedido.status_alterado@1`, `vendedor.pedido.aprovacao_solicitada@1`. **Consome**: `promotor.ruptura.registrada@1` (opcional), `integracao.pedido.retorno_erp@1`. **Oferece extensão**: `pedido.criar_em_nome` (usada pelo Gestor).

- **RF-VEN-01 (P0)** Montar pedido: cliente, condição de pagamento, depósito, itens (qtd por múltiplo), desconto por item e total, observação; seletor de produtos próprio e, se Catálogo ativo, "adicionar ao pedido" da ficha. 📱C
- **RF-VEN-02 (P0)** Validações offline em tempo real: preço, alçada, crédito, título vencido, estoque, pedido mínimo, cliente bloqueado (RN-VEN).
- **RF-VEN-03 (P0)** Orçamento (pré-venda) × pedido; converter orçamento em pedido.
- **RF-VEN-04 (P0)** Fila offline com indicador, reenvio automático, idempotência.
- **RF-VEN-05 (P0)** Status com linha do tempo; duplicar, editar e cancelar antes de "integrado ao ERP"; excluir só rascunho.
- **RF-VEN-06 (P0)** PDF cliente (preço final) e interno (tabela + desconto %), compartilhar no WhatsApp/e-mail.
- **RF-VEN-07 (P1)** Alertas de ruptura registrados pelo promotor nos clientes da carteira, com atalho para incluir os itens no próximo pedido.
- **RF-VEN-08 (P0)** Painel "Minhas vendas": meta × realizado, quanto falta por dia útil, positivação, pedidos do dia.
- **RF-VEN-09 (P0)** BKO: gestão de pedidos, fila de aprovações acima do gestor, reenvio ao ERP, pedido digitado pelo assistente. 🖥️
- **RF-VEN-10 (P1)** Itens sugeridos do cliente: mais comprados, "não compra há X dias".
- **RF-VEN-11 (P0)** Tela **Novo pedido** (Campo; a mesma no Gestão para pedido em nome): cabeçalho com o cliente e três abas.
  - **Produtos**: busca + árvore do catálogo (RF-CAT-04); "+" adiciona 1 na unidade padrão (3 toques).
  - **Itens (n)**: quantidade, medida da unidade ou embalagem (RN-VEN-15, RN-CORE-19), desconto ou acréscimo do item em % (travado no desconto máximo do produto, RN-VEN-11), preço de tabela, preço final e total da linha; card **Condições** com desconto **ou** acréscimo do pedido, frete (RF-VEN-12) e prazo.
  - **Entrega**: endereço de entrega (RN-VEN-17).
  - **Rodapé fixo**: subtotal pela tabela, descontos e acréscimos, total, desconto efetivo (RN-VEN-03) e a alçada ("Dentro da sua alçada" ou "Vai para o supervisor"); "Enviar pedido". Funciona offline. 📱C📱G
- **RF-VEN-12 (P0)** Frete CIF (padrão, por conta da empresa) ou FOB (por conta do cliente, com transportadora da lista ou digitada obrigatória), sem valor de frete (RN-VEN-16). O detalhe do pedido (Campo, Gestão e BKO) e os dois PDFs mostram endereço de entrega, frete ("Frete: CIF – por conta da empresa" ou "Frete: FOB – por conta do cliente · <transportadora> (CNPJ)") e, por item, a coluna **Medida** (sigla vendida; na embalagem, "CX c/ 12") e desconto ou acréscimo. PDFs com o CNPJ do cliente formatado, o **nome** da tabela de preço (nunca o id) e o nome (e logo, se houver) da distribuidora no cabeçalho; "Gerado pelo Macuxi FDV" só no rodapé. 📱C📱G🖥️
- **RF-VEN-13 (P0)** BKO: cadastro de **transportadoras** (nome, CNPJ, IE, telefone, ativo) por admin, analista e assistente (também podem vir do ERP); parâmetros de frete do tenant; lista das transportadoras digitadas pelos vendedores. 🖥️

## PRO — Promotor (promotoria de mercado / trade marketing)
**Depende de**: Core. **Opcionais**: Catálogo (fotos e ficha dos nossos produtos), Pesquisa (questionário livre anexado à visita), Vendedor (alerta de ruptura). **Publica**: `promotor.visita_loja.concluida@1`, `promotor.gondola.registrada@1`, `promotor.share.medido@1`, `promotor.preco.coletado@1`, `promotor.ruptura.registrada@1`, `promotor.tarefa.concluida@1`. **Usa extensões**: `cliente.abas`, `visita.etapas_checkout`, `inicio.cards`.

> Foco: o promotor trabalha **dentro da loja** (supermercado, atacarejo, farmácia, varejo) cuidando de exposição, espaço e preço. Ele vê os dados do cliente, mas **não vende**.

- **RF-PRO-01 (P0)** Dados do cliente da carteira em **somente leitura** (Cliente 360, pedidos, histórico) — sem nenhuma ação de pedido (bloqueado também na API).
- **RF-PRO-02 (P0)** Roteiro de lojas (rota do Core) com check-in/checkout, **tempo de permanência** e **checklist do dia** gerado pelo BKO por loja, rede ou canal ("o que fazer hoje nesta loja").
- **RF-PRO-03 (P0)** **Arrumação de gôndola**: fotos antes/depois por categoria, comparação lado a lado com a foto/planograma de referência, conformidade (conforme | parcial | não conforme) com motivo.
- **RF-PRO-04 (P0)** **Share de gôndola** por categoria: frentes (facings) nossas × total da categoria e, opcionalmente, centímetros lineares; % calculado na hora e comparado com a meta de share da loja/categoria.
- **RF-PRO-05 (P0)** **Pesquisa de preço**: preço de prateleira dos nossos itens e dos concorrentes cadastrados, se está em promoção/encarte e o preço promocional; índice de preço (nosso ÷ concorrente).
- **RF-PRO-06 (P0)** **Presença e ruptura** do mix obrigatório da loja: presente | ruptura na gôndola com produto no depósito (falha de reposição) | ruptura total; quantidade reposta pelo promotor.
- **RF-PRO-07 (P0)** **Validade e avarias**: itens com vencimento próximo (data e quantidade) e produtos avariados, com foto.
- **RF-PRO-08 (P1)** **Pontos extras e material de PDV**: ponta de gôndola, ilha, display, cartaz, checkout — registro com foto e conferência dos pontos extras negociados com a loja (existe? no lugar combinado? abastecido?).
- **RF-PRO-09 (P1)** **Concorrência**: lançamentos, ações e promoções dos concorrentes, com foto e observação.
- **RF-PRO-10 (P1)** **Tarefas pontuais** criadas no BKO (ex.: "montar display da campanha X em 20 lojas até sexta"), com prazo e comprovação por foto.
- **RF-PRO-11 (P0)** BKO de trade: cadastros (mix obrigatório por loja/rede/canal, categorias de gôndola, concorrentes e seus produtos, metas de share, fotos/planogramas de referência, checklists, tarefas) e relatórios (share × meta, ruptura, índice de preço, conformidade, validade, pontos extras), galeria de fotos com filtros e exportação Excel/CSV. 🖥️
- **RF-PRO-12 (P0)** Indicadores do promotor no app (e para o Gestor): lojas visitadas × planejadas, tempo médio em loja, % conformidade, share médio × meta, % ruptura, índice de preço.
- **RF-PRO-13 (P1)** Alerta de ruptura ao vendedor responsável pelo cliente, se o módulo Vendedor estiver ativo (o promotor continua sem fazer pedido).
- **RF-PRO-14 (P2)** Reconhecimento de imagem por IA: contagem automática de frentes e detecção de ruptura pela foto, sempre revisada pelo promotor.

## GES — Gestor
**Depende de**: Core. **Usa extensões**: `pedido.criar_em_nome` (se Vendedor ativo). **Consome**: eventos de Core, Vendedor, Promotor (visita de loja, gôndola, share, preço, ruptura, tarefa), Pesquisa e Treinamento para os painéis.

- **RF-GES-01 (P0)** Visão da equipe (subordinados diretos e indiretos): vendedores e promotores, status do dia (em rota, em visita, sem check-in), mapa de check-ins.
- **RF-GES-02 (P0)** Ficha de cada vendedor: meta × realizado, positivação, cobertura de rota, ticket médio, mix, pedidos, conversão de visita em pedido, tempo médio de visita, desconto médio, evolução mensal.
- **RF-GES-03 (P0)** Ranking da equipe por indicador e período.
- **RF-GES-04 (P0)** Aprovações da sua alçada (desconto, crédito, estoque) com contexto do cliente; aprovar/rejeitar com comentário.
- **RF-GES-05 (P0)** **Pedido em nome do vendedor**: usa o motor do módulo Vendedor; o pedido conta para o vendedor e registra o gestor como autor.
- **RF-GES-06 (P0)** Ver tudo dos clientes da carteira da equipe (Cliente 360, pedidos, execuções, pesquisas).
- **RF-GES-07 (P1)** Alertas: vendedor sem check-in até [10h], cliente da rota não visitado, cliente sem compra há [30] dias, desconto fora do padrão.
- **RF-GES-08 (P1)** Ajustar rota do vendedor pelo app Gestão.
- **RF-GES-09 (P0)** Painéis equivalentes no BKO Web. 🖥️
- **RF-GES-10 (P0, se Promotor ativo)** Ficha do promotor: lojas visitadas × planejadas, tempo em loja, conformidade de gôndola, share × meta, ruptura, índice de preço, tarefas cumpridas e galeria de fotos por loja.

## PES — Pesquisa
**Depende de**: Core. **Usa extensão**: `visita.etapas_checkout`, `cliente.abas`. **Publica**: `pesquisa.resposta.registrada@1`.

- **RF-PES-01 (P0)** BKO: construtor de questionários — tipos sim/não, múltipla escolha, única escolha, número, texto, escala, data, foto, código de barras; obrigatória/opcional; lógica condicional simples ("se X, mostrar Y"). 🖥️
- **RF-PES-02 (P0)** Público-alvo: perfis, equipes, segmentos, regiões ou lista de clientes; período de vigência; frequência (uma vez por cliente, a cada visita, semanal, mensal).
- **RF-PES-03 (P0)** Modo: avulsa (aba "Pesquisas") ou etapa obrigatória do checkout da visita.
- **RF-PES-04 (P0)** Responder offline, com fotos comprimidas; rascunho salvo automaticamente.
- **RF-PES-05 (P0)** Versões: questionário publicado não muda; editar cria nova versão.
- **RF-PES-06 (P0)** Resultados no BKO: taxa de resposta, gráficos por pergunta, filtros, galeria de fotos, exportar Excel/CSV. 🖥️

## TRE — Treinamento
**Depende de**: Core. **Consome (opcional)**: `vendedor.pedido.criado@1` para desafios de vendas. **Publica**: `treinamento.licao.concluida@1`, `treinamento.medalha.conquistada@1`.

- **RF-TRE-01 (P0)** BKO: trilhas → módulos → lições (texto, imagem, vídeo curto, PDF) + quiz; pré-requisitos; público-alvo; prazo. 🖥️
- **RF-TRE-02 (P0)** App: jornada visual (mapa da trilha), progresso, retomar de onde parou, download para offline.
- **RF-TRE-03 (P0)** Gamificação: XP por lição e acerto, níveis, sequência de dias (streak), medalhas.
- **RF-TRE-04 (P0)** Ranking por equipe, regional e geral; semanal, mensal e acumulado; o vendedor vê a própria posição e a dos colegas.
- **RF-TRE-05 (P0)** Gestor/BKO: adesão, conclusão, notas por pessoa e por trilha.
- **RF-TRE-06 (P1)** Desafios de vendas ligados a campanhas (XP ao vender itens da campanha).
- **RF-TRE-07 (P2)** Geração de quiz por IA a partir da ficha do produto (revisado pelo BKO antes de publicar).
- **RF-TRE-08 (P1)** Certificado de conclusão da trilha (PDF).

## INT — Integração (plataforma)
**Depende de**: Core. **Publica**: `integracao.<entidade>.atualizado@1`, `integracao.pedido.retorno_erp@1`. **Consome**: `vendedor.pedido.status_alterado@1` (pedidos aprovados para exportar).

- **RF-INT-01 (P0)** Hub REST de integração (`/integracao/v1`) com contratos canônicos por entidade, carga em lote, delta por cursor, idempotência e OpenAPI publicado.
- **RF-INT-02 (P0)** Conector Macuxi on-premise (serviço Windows) que lê views SQL do ERP e envia delta ao Hub por HTTPS de saída; recebe pedidos aprovados e grava em tabela de entrada do ERP ou chama a API do ERP.
- **RF-INT-03 (P0)** Carga por arquivo (Excel/CSV no BKO ou SFTP) como alternativa e para implantação.
- **RF-INT-04 (P0)** Monitor no BKO: últimos lotes, linhas ok/erro, reprocessar, saúde do Conector. 🖥️
- **RF-INT-05 (P1)** Adaptadores nuvem-a-nuvem para ERPs que têm API própria.
- **RF-INT-06 (P1)** Reconciliação diária (contagens e totais por entidade) com alerta de divergência.
