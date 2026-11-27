# Menu Parâmetros no BKO (simulação 2a, v1.0.18)

Pedido do Alexandre (15/11/2026, 10h40, horário de Manaus, R-20261115-104000): tudo o que é parâmetro e configuração do BKO num menu único **Parâmetros**, com uma seção por funcionalidade.
Decisão R-20261120-191213: simulação 2a agora; as telas só mudam de lugar depois do OK do Alexandre (2b).
Valem as decisões D1 a D11 de 15/11 (R-20261115-121000 e R-20261115-122000) e a ADR 0060. **Só simulação**; nada muda no sistema.
Fonte: main `e6a3a33` (20/11/2026): `modules/*/web/index.ts`, `packages/platform-sdk/src/shell.ts` (`TRANSICAO_GRUPO`, `SECOES_PARAMETROS`, `menuParametros`) e `apps/web/lib/menu-bko.ts`.

## 1. Hoje no main

- O shell web não liga `menuParametros` nem tem a rota `/parametros`: o menu é o de antes (ADR 0050) e os `paineisParametros` não montam.
- **28 dos 32 painéis que já existem não abrem** (sem item nem endereço). Abrem só: Plano de RV (Comercial), Regras de alerta (Comunicação) e o de-para (Parâmetros › Integração, o único item do grupo).

## 2. Inventário e árvore proposta

Seções em ordem alfabética; painéis na ordem do código. **Hoje**: onde abre no menu atual ("sem rota" = não abre). **Leitura**: sem campo editável nem Salvar. **Falta**: o painel não existe (§4).

| Seção | Painel | Hoje | Módulo, ação | Leitura |
|---|---|---|---|---|
| Acesso | Perfis de acesso | sem rota (era Acesso › Perfis de acesso) | core, `perfil.gerir` | |
| Acesso | Módulos | sem rota (era `/usuarios-e-modulos`) | core, `modulo.gerir_licencas` | |
| Acesso | Promotor vê pedidos | sem rota | core, `parametro.promotor_ve_pedidos` (RN-PRO-01) | |
| Alertas | Alertas da equipe | Comunicação › Regras de alerta | gestor, `alerta_regra.gerenciar` | |
| Alertas | Produtividade do dia | Comunicação › Regras de alerta (mesma página) | gestor + core, `parametro.alertas_produtividade` | |
| Calendário | Feriados | sem rota | core, `parametro.inicio` | |
| Calendário | Almoço | sem rota | core, `parametro.inicio` (RN-CORE-44) | |
| Calendário | Rastreamento no expediente | sem rota | core, `rastreamento.configurar` (RN-CORE-13) | |
| Calendário | Ausências | sem rota | core, `ausencia.cadastrar` | |
| Clientes | Farol | sem rota (era painel de Cadastros › Clientes) | core, `parametro.farol` (RN-CORE-28) | |
| Clientes | Curvas ABC | sem rota (idem) | core, `parametro.curva_abc` (RN-CORE-49) | |
| Clientes | Quem vê cada tipo de documento | sem rota | core, `documento.permissoes` | |
| Clientes | Exceções por documento | sem rota | core, `documento.permissoes` | |
| Início | Dias úteis | sem rota (era painel de Análise › Metas) | core, `parametro.inicio` (RN-CORE-26) | |
| Início | Frases do dia | sem rota | core, `frase_dia.editar` (RN-CORE-41) | |
| Integração | De-para | Parâmetros › Integração | integracao, `mapeamento.editar` | |
| Metas e RV | Plano de RV | Comercial › Plano de RV | core, `plano_rv.ver` | |
| Pedidos | Alçadas | sem rota (era Comercial › Alçadas) | vendedor | limites sim; aprovadores de crédito editáveis (`alcada.gerenciar`) |
| Pedidos | Frete padrão | só no título de Comercial › Transportadoras | core (`frete_modalidade_padrao`, RN-VEN-16) | falta |
| Pesquisa 🔒 | Vigência · Construtor · Fotos | sem rota | pesquisa (RN-PES-04/06/07) | sim |
| Produtos | Desconto máximo padrão | sem rota (era aba de Produtos › Preço e custo) | core, `produto.parametros` | |
| Produtos | Medidas | sem rota (idem) | core, `produto.editar_preco` (RN-CORE-19) | |
| Produtos | Catálogo (limite da aplicação, D6) | nenhum | catalogo (RN-CAT-11) | falta |
| Trade 🔒 | Validade · Visita e coleta · Gôndola | sem rota | promotor (RN-PRO-04/07/08/11) | sim |
| Treinamento 🔒 | Quiz e lição · XP · Níveis e ranking | sem rota | treinamento (RN-TRE-01/02/04) | sim |
| Visitas | Motivos de não venda | sem rota (era Cadastros › Motivos) | core, `motivo.editar` | |
| Visitas | Fotos do PDV | sem rota (era Cadastros › Fotos do PDV) | core, `foto_tipo.editar` | |
| Visitas | Etapa pendente | sem rota (era painel de Análise › Metas) | core, `parametro.checkout_pendencia` (RN-CORE-12) | |

Total: **13 seções, 34 painéis** (32 existem, 2 faltam). 🔒 = seção de módulo de vitrine: aparece com cadeado sem a licença da empresa (ADR 0060).
Ficam fora de Parâmetros (cadastro, operação ou consulta): Formas de pagamento e prazos e Transportadoras (Cadastros, D4/D11), Trade › Cadastros, Metas (inclusive as metas de produtividade), Fotos em lote, Trajeto do dia, Integração ERP e Carga por arquivo, e o portal de configuração (`config.<host>`).
Página `/parametros/<secao>` (v1.0.34, R-20261124-094002): sem lista de seções na página; os painéis da seção usam a largura toda e a seção ativa aparece só no menu (uma informação, um lugar, R-20261110-093124).

## 3. Menu: hoje × proposto

| Hoje | Proposto |
|---|---|
| Comercial › Plano de RV | Parâmetros › Metas e RV |
| Comercial › Transportadoras | Cadastros › Transportadoras (o grupo Comercial sai, D4) |
| Comunicação › Regras de alerta | Parâmetros › Alertas |
| Parâmetros (grupo) › Integração | Parâmetros (grupo com ›) › uma opção por seção (§2), cada uma em `/parametros/<secao>` |
| Pesquisa (grupo) › Pesquisas | Pesquisa (grupo com ›) › os seus itens |
| Treinamento (grupo) › Trilhas | Treinamento (grupo com ›) › os seus itens |
| Parâmetros em ordem alfabética, entre Operação e Pesquisa | Parâmetros fixo logo acima de Sistema (D1) |

**Revisão de 24/11/2026 (R-20261124-094002, teste de campo da v1.0.32):** decisão do Alexandre: Parâmetros tem a seta (›) e abre as opções, como Acesso, Análise e Cadastros. Premissa, a confirmar pelo Alexandre: Pesquisa e Treinamento seguem o mesmo padrão. D3/D10 (Parâmetros item direto) e D9 (grupo de um item vira item direto) deixam de valer no BKO: todo grupo do menu lateral tem a seta, mesmo com um item só. As seções com 🔒 aparecem no menu com o cadeado.

Os demais grupos e itens ficam como hoje. Com Parâmetros aberto (13 seções) o menu passa da altura de 1366×768: só a lista do menu rola, o cabeçalho e o rodapé do menu ficam fixos.
Comportamento (cadeado, balão "Contrate o módulo para usar", Salvar só no painel alterado, endereços antigos redirecionados): ADR 0060 e `docs/desenho/menu-parametros.md` §2.

## 4. O que precisa de trabalho além do shell (estimativa do 2b)

Shell (`engenheiro-apps`): ligar `menuParametros: true`, a rota `/parametros/<secao>` (sem lista de seções, §2) e os redirecionamentos de `destinoParametros`; em `apps/web/lib/menu-bko.ts`, a ordem com `compararGrupoMenu` (D1), Parâmetros, Pesquisa e Treinamento como grupo com seta (sem o item direto da D9; R-20261124-094002), as seções de Parâmetros como opções do grupo (`/parametros/<secao>`) e o item com cadeado.

Nos módulos:
1. **integracao**: o de-para é página com `grupo: 'parametros'`; com o menu novo, Parâmetros viraria grupo. Precisa virar `PainelParametros` da seção Integração.
2. **gestor**: Regras de alerta entra pela transição como painel único "Alertas", com `PageHeader` próprio, repetindo o nome da seção. Precisa de dois painéis (Alertas da equipe, Produtividade do dia), sem cabeçalho.
3. **core, Plano de RV**: entra pela transição como página inteira (com cabeçalho). Precisa do painel declarado e sair do grupo `comercial`.
4. **core, Frete padrão**: painel novo com gravação de `frete_modalidade_padrao` (hoje só leitura em Transportadoras).
5. **catalogo, Catálogo**: painel novo do limite da aplicação (`aplicacao_max_cadastro`, RN-CAT-11, D6) e a gravação.
6. **SDK**: tirar os grupos `comercial` e `conteudo_campo` (deprecados) e as linhas de `TRANSICAO_GRUPO` quando os módulos declararem os painéis.

Ficam só leitura no 2b (sem rota de gravação): os limites de Alçadas (P6 de 15/11) e Pesquisa, Trade e Treinamento (P4 de 15/11).

Fora da árvore, sem tela no BKO (doc 03, "Parâmetros do tenant"), para o Alexandre dizer se entram: pedido mínimo; crédito excedido e dias de atraso; estoque insuficiente; validade do orçamento; campos obrigatórios do cliente; raio de check-in; atualização automática (`sync_auto_min`); promotor vê preço e estoque; estoque baixo, mostrar quantidade e desatualizado; horário comercial e prazo da aprovação; limite de inativação em massa.
Pronto e sem rota, fora de Parâmetros: `MetasProdutividadePanel` (core), aba Produtividade de Análise › Metas (`docs/desenho/performance-produtividade.md` §6.5).

## 5. Simulações (1366 de largura, escala 2)

Gerador: `node docs/design/menu-parametros/gerar.mjs` (escreve os `.html` e `.png` desta pasta; falha se balão ou nota cobrir conteúdo, se o menu rolar com qualquer grupo fora Parâmetros aberto ou se um item for cortado). Dados fictícios. Cenário: empresa sem Pesquisa e Treinamento, com Trade; perfil Administrador.

| Arquivo | O que mostra |
|---|---|
| `01-menu-hoje-e-proposto.png` | Menu proposto à esquerda, com Parâmetros aberto (a lista do menu rola); ao lado, o menu de hoje (com o destino do que muda) e a árvore das seções de Parâmetros |
| `02-parametros-calendario.png` | Parâmetros › Calendário: Feriados, Almoço, Rastreamento no expediente (alterado, Salvar ativo) e Ausências |
| `03-parametros-pesquisa-sem-licenca.png` | Seção de módulo sem licença: cadeado no menu (Parâmetros › Pesquisa); o conteúdo mostra só "Contrate o módulo para usar" |

O `03-parametros-pedidos.html` (versão de 15/11) fica só como base do `docs/design/pedido-aprovacao/gerar.mjs`; este gerador não o reescreve.

## 6. Para o Alexandre decidir

- OK da árvore (§2) e do menu (§3) para o 2b.
- Frete padrão em Parâmetros › Pedidos (proposta) e quais parâmetros do doc 03 sem tela entram (§4).
- Ausências fica em Calendário (como no código, T-0156) ou vai para Acesso › Usuários (é cadastro por pessoa).

## 7. Painéis da v1.0.37

Decisão R-20261126-155851-alexandre: três parâmetros do doc 03 ("Parâmetros do tenant") que já têm regra e leitura no código ganham painel. Pedido mínimo, crédito excedido e estoque insuficiente entram na v1.0.39 (R-20261126-183412 e R-20261126-205433; §7.5).

### 7.1 Padrão comum (o mesmo de Etapa pendente e Campos obrigatórios)

- **Lugar**: painel declarado em `paineisParametros` do módulo (`id`, `secao`, `titulo`, `ordem`, `acao`); a página `/parametros/<secao>` põe o título no `Panel`, sem `PageHeader` no painel.
- **Perfis**: quem tem a ação de ver vê o painel; sem ela o painel não aparece. Quem vê e não edita vê o valor no campo desabilitado e sem Salvar. A API revalida e audita.
- **Componentes** (`@macuxi/ui/web`): `CampoFormulario` (rótulo 15/600, ajuda 13 em `text-ink-2`, erro com `aria-invalid`), campo `CLASSE_CAMPO` com a unidade à direita, `max-w-[260px]`, `inputMode="numeric"`, aceita só dígitos; `Button variant="primary"` (o único principal do painel); `Notice`, `LoadingBlock`, `ErrorBlock`.
- **Estados**: carregando ("Carregando…"); erro de leitura (`ErrorBlock` com Tentar de novo); **alterado** = valor diferente do salvo, e só assim Salvar fica ativo; salvando ("Salvando…", botão desabilitado); salvo (`Notice` de sucesso ao lado do botão; some ao editar de novo); erro da API (`Notice` de perigo no topo do painel, com a mensagem da API); erro de campo (embaixo do rótulo, validado ao tocar em Salvar, sem gravar).
- **Sem licença**: a seção do módulo sem licença aparece com o cadeado no menu e o conteúdo mostra só "Contrate o módulo para usar" (ADR 0060, §5 desta spec). Pedidos depende da licença do Vendedor; Clientes é do Core (sempre contratado).
- **Valor padrão**: sem linha gravada, o GET devolve o padrão e o campo abre com ele.

### 7.2 Parâmetros › Clientes › Campos obrigatórios (modulo-core)

Já declarado no main (`modules/core/web/index.ts`, id `campos-obrigatorios`, ordem 25, entre Curvas ABC e Quem vê cada tipo de documento) com `GET|PUT /v1/core/parametros/campos-obrigatorios`. Falta só alinhar ao padrão de 7.1.

| Item | Especificação |
|---|---|
| Título | Campos obrigatórios |
| Ajuda (uma linha, acima da lista) | Vale para o cadastro e o pré-cadastro do cliente. |
| Campo | Lista de caixas de marcar, uma por linha (alvo ≥ 44 px), nesta ordem: Razão social · CPF/CNPJ · Nome fantasia · Inscrição estadual · Telefone · E-mail · Endereço |
| Fixos | Razão social e CPF/CNPJ marcados e travados, com o selo neutro "Sempre" |
| Endereço | Uma linha só para logradouro, número, bairro, cidade, UF e CEP; marcada se qualquer um deles for exigido |
| Faixa / erro | Sem erro de campo: os fixos garantem a lista mínima. |
| Padrão | Razão social, CPF/CNPJ, Inscrição estadual e Endereço marcados; Nome fantasia, Telefone e E-mail desmarcados |
| Perfis | Ver: `parametro.campos_obrigatorios` (analista, admin). Editar: `parametro.campos_obrigatorios_editar` (admin) |
| Botão e aviso | "Salvar", ativo só com a lista alterada; sucesso "Campos obrigatórios salvos." ao lado do botão |

### 7.3 Parâmetros › Pedidos › Título vencido (modulo-vendedor)

Painel novo: id `titulo-vencido`, seção `pedidos`, ordem 20 (Alçadas fica em 10; o Frete padrão, quando vier, em 40). Chave `titulo_vencido_dias` (módulo `vendedor`), lida por `tituloVencidoDias` no domain.

| Item | Especificação |
|---|---|
| Título | Título vencido |
| Rótulo | Atraso tolerado |
| Ajuda | De 0 a 365 dias. Acima desse atraso, o pedido do cliente vai para aprovação. |
| Campo | Número inteiro, unidade "dias" à direita |
| Faixa / erro | 0 a 365, inteiro; vazio ou fora da faixa: "Use um número de 0 a 365" |
| Padrão | 5 dias |
| Perfis (proposta) | Ver: `parametro.pedidos` (analista, admin). Editar: `parametro.pedidos_editar` (admin) |
| Botão e aviso | "Salvar"; sucesso "Atraso tolerado salvo." |
| Rota (dono) | `GET|PUT /v1/vendedor/parametros/pedidos` com `{ titulo_vencido_dias, validade_orcamento_dias }`; o PUT aceita um ou os dois e audita só o que mudou |

### 7.4 Parâmetros › Pedidos › Preço do orçamento (modulo-vendedor)

Painel novo: id `preco-orcamento`, seção `pedidos`, ordem 30. O doc 03 chama de "Preço do orçamento (antes Validade)": o orçamento não vence; o parâmetro limita só o preço congelado.

| Item | Especificação |
|---|---|
| Título | Preço do orçamento |
| Rótulo | Preço vale por |
| Ajuda | De 1 a 90 dias corridos, contando o dia em que o orçamento é salvo. Depois, o orçamento vira pedido pelo preço do dia. |
| Campo | Número inteiro, unidade "dias" à direita |
| Faixa / erro | 1 a 90, inteiro; vazio ou fora da faixa: "Use um número de 1 a 90" |
| Padrão | 7 dias |
| Perfis (proposta) | Os mesmos de 7.3 |
| Botão e aviso | "Salvar"; sucesso "Preço do orçamento salvo." |

**Chave a alinhar antes da rota**: o domain lê `orcamento.validade_dias` (`modules/vendedor/domain/orcamento.ts`, `PARAMETRO_VALIDADE_ORCAMENTO`), e o passo Empresa grava `validade_orcamento_dias` (`packages/platform-sdk/src/plataforma.ts`, `linhasDosParametrosIniciais`). A rota grava a chave que o domain lê; o modulo-vendedor e o engenheiro-software decidem qual fica e acertam a outra ponta.

Sem simulação PNG nesta seção: o `gerar.mjs` não tem o cenário de Pedidos com campos editáveis.

> Atualização v1.0.39: a divergência acima já foi resolvida no main. O domain lê `validade_orcamento_dias` e aceita a chave antiga na leitura (`modules/vendedor/domain/orcamento.ts:35-43`). A rota usa a ação `alcada.gerenciar` (`modules/vendedor/api/parametros-pedidos.ts`), não `parametro.pedidos`.

### 7.5 Parâmetros › Pedidos › Pedido mínimo, Crédito excedido e Estoque insuficiente (modulo-vendedor, v1.0.39)

Pedido do dono do produto: R-20261126-183412 (escopo) e R-20261126-205433 (lançar a 1.0.39). Doc 03, "Parâmetros do tenant": Crédito excedido = enviar para aprovação; Estoque insuficiente = permitir com aviso; Pedido mínimo = desativado. Regras: RN-VEN-12 (crédito, P-6/T-0184), RN-VEN-20 (estoque), RN-VEN-22 (pedido mínimo).

**Ordem na seção Pedidos**: Alçadas 10 · Título vencido 20 · Preço do orçamento 30 · Frete padrão 40 (reservado) · **Pedido mínimo 50 · Crédito excedido 60 · Estoque insuficiente 70**. Cada um é um `Panel` próprio, com o seu Salvar (um principal por painel, como 7.3 e 7.4).

**Nenhuma das três chaves existe hoje** (nem no domain, nem no passo Empresa, `linhasDosParametrosIniciais` em `packages/platform-sdk/src/plataforma.ts:224-232`, que grava só alçadas, `validade_orcamento_dias` e `aplicacao_no_orcamento_padrao`). O comportamento está fixo no código:

| Parâmetro | Hoje no código | Doc 03 (padrão) |
|---|---|---|
| Crédito excedido | Sempre vai para aprovação (`exigeAprovacaoPorCredito`, `modules/vendedor/domain/credito-pedido.ts:28`; o servidor usa a mesma regra por `aprovacoesFinanceiras`, `credito-pedido.ts:62-71`, chamada em `domain/aprovacao.ts:504`) | enviar para aprovação (igual) |
| Estoque insuficiente | Pedido só sai como orçamento: o app desliga Enviar (`domain/botoes-resumo.ts:47-60`) e a API recusa com RN-VEN-20 (`api/receber.ts:295-298`). O `estoque_bloqueia` do Transformar (`domain/orcamento.ts:380-381, 470`) vem fixo `false` do app (`app/state/use-vendedor.ts:931`) | permitir com aviso (**diverge**) |
| Pedido mínimo | Não existe regra (RN-VEN-22 sem efeito) | desativado (igual) |

As chaves abaixo são **propostas** (módulo `vendedor`); o modulo-vendedor confirma o nome no domain e o engenheiro-software decide se o passo Empresa as grava (ponto em aberto PA-1). Sem linha gravada, o GET devolve o padrão (7.1).

**Perfis (os três)**: os mesmos de 7.3 e 7.4 como estão no main: ver e editar com `alcada.gerenciar` (admin, analista, gerente). Quem vê e não edita vê o valor desabilitado e sem Salvar.

**Componentes**: `CampoFormulario` e `CLASSE_CAMPO` (7.1) para o valor; `GrupoOpcoesCartao` + `OpcaoCartao` (`packages/ui/src/web/opcao-cartao.tsx`, cartão de 52 px, radio nativo) para as escolhas; `Button variant="primary"` "Salvar"; `Notice`.

#### 7.5.1 Pedido mínimo (id `pedido-minimo`, ordem 50)

Chave proposta: `pedido_minimo_cents` (inteiro, centavos; `0` = sem pedido mínimo). Domain a criar: `pedidoMinimoCents(p)` e `validarPedidoMinimoCents(v)`, citando RN-VEN-22.

| Item | Especificação |
|---|---|
| Título | Pedido mínimo |
| Campo | Duas opções em cartão (`OpcaoCartao`, nome `pedido-minimo`): **Sem pedido mínimo** · **Exigir a partir de**. Com "Exigir a partir de" marcada, abaixo dela aparece o campo de valor |
| Rótulo do valor | Valor mínimo |
| Ajuda do valor | Abaixo desse valor, o pedido só sai como orçamento. |
| Valor | Dinheiro: "R$" à esquerda dentro do campo, digitado com vírgula (1.500,00), `inputMode="decimal"`, `max-w-[260px]`; guardado em centavos (150000) |
| Faixa / erro | Com "Exigir" marcada: R$ 0,01 a R$ 100.000,00; vazio, zero ou fora: "Use um valor de R$ 0,01 a R$ 100.000,00" |
| Padrão | Sem pedido mínimo (`0`) |
| Botão e aviso | "Salvar", ativo só com a escolha ou o valor alterados; sucesso "Pedido mínimo salvo." |
| Estados | 7.1. Voltar para "Sem pedido mínimo" grava `0` e esconde o campo (o valor digitado não fica guardado) |

#### 7.5.2 Crédito excedido (id `credito-excedido`, ordem 60; P-6)

Chave proposta: `credito_excedido_acao` = `aprovacao` | `orcamento` | `avisar`. Domain a criar: `acaoCreditoExcedido(p)` (padrão `aprovacao`, também com valor ausente ou inválido), lida por `exigeAprovacaoPorCredito` e `aprovacoesFinanceiras` (`domain/credito-pedido.ts:28, 62`). Vale também para o cliente sem limite informado pelo ERP, a prazo (P4 A da T-0184). À vista nunca conta (RN-VEN-12).

| Item | Especificação |
|---|---|
| Título | Crédito excedido |
| Rótulo do grupo | Pedido a prazo acima do crédito disponível |
| Opções (`OpcaoCartao`, nome `credito-excedido`) | **Enviar para aprovação** — apoio: "Quem aprova está em Alçadas." · **Só como orçamento** — apoio: "O vendedor não consegue enviar o pedido." · **Avisar e enviar** — apoio: "O pedido segue sem aprovação." |
| Faixa / erro | Sem erro de campo: sempre há uma opção marcada |
| Padrão | Enviar para aprovação |
| Botão e aviso | "Salvar", ativo só com a opção alterada; sucesso "Crédito excedido salvo." |
| Estados | 7.1 |
| Uma informação, um lugar | "Quem aprova crédito" continua só em Alçadas (`aprovacao.credito_nivel`, `domain/aprovacao.ts:73`); aqui não se repete o nível (PA-5) |

#### 7.5.3 Estoque insuficiente (id `estoque-insuficiente`, ordem 70)

Chave proposta: `estoque_insuficiente_acao` = `orcamento` | `aprovacao` | `avisar`. Domain a criar: `acaoEstoqueInsuficiente(p)`, que passa a alimentar `estoque_bloqueia` (`domain/orcamento.ts:381`), os botões do resumo (`domain/botoes-resumo.ts`) e a recusa da API (`api/receber.ts:298`). O motivo `estoque` já existe em `MOTIVOS_APROVACAO` (`domain/aprovacao.ts:25`) sem regra de entrada. "Cortar" (doc 03) fica de fora (PA-8).

| Item | Especificação |
|---|---|
| Título | Estoque insuficiente |
| Rótulo do grupo | Item com quantidade acima do estoque da filial |
| Opções (`OpcaoCartao`, nome `estoque-insuficiente`) | **Só como orçamento** — apoio: "O vendedor não consegue enviar o pedido." · **Enviar para aprovação** — apoio: "Quem aprova está em Alçadas." · **Avisar e enviar** — apoio: "O pedido segue com o item sem estoque." |
| Faixa / erro | Sem erro de campo |
| Padrão | Só como orçamento (o comportamento de hoje; PA-6) |
| Botão e aviso | "Salvar", ativo só com a opção alterada; sucesso "Estoque insuficiente salvo." |
| Estados | 7.1 |

**Rota (dono modulo-vendedor)**: a mesma `GET|PUT /v1/vendedor/parametros/pedidos`, ganhando `pedido_minimo_cents`, `credito_excedido_acao` e `estoque_insuficiente_acao`; o PUT aceita qualquer subconjunto, revalida no domain (422 com a RN) e audita só o que mudou.

**Simulação** (`node docs/design/menu-parametros/gerar-v1039-pedidos.mjs`, 1366 de largura, escala 2):

| Prancha | O que mostra |
|---|---|
| `v1039-pedidos-padrao.png` | Os três painéis com o padrão, abaixo de Título vencido e Preço do orçamento; Salvar desligado |
| `v1039-pedidos-alterado-erro.png` | Pedido mínimo com "Exigir a partir de" e o valor vazio, erro de campo após Salvar; Crédito excedido alterado para "Só como orçamento" (Salvar ativo); Estoque insuficiente salvo, com o aviso de sucesso |

**Pontos em aberto (para o Alexandre)** — recomendação em negrito:

- **PA-1 Chaves no passo Empresa.** A: o passo Empresa grava as três com o padrão. **B: não grava; sem linha, vale o padrão do domain (como `titulo_vencido_dias`).**
- **PA-2 Nome das chaves.** **A: `pedido_minimo_cents`, `credito_excedido_acao`, `estoque_insuficiente_acao` (sem prefixo, como `titulo_vencido_dias`).** B: com prefixo de grupo (`pedido.minimo_cents`, `credito.excedido_acao`, `estoque.insuficiente_acao`), como `alcada.*` e `aprovacao.*`.
- **PA-3 Pedido abaixo do mínimo.** **A: só sai como orçamento (igual a estoque e desconto acima do máximo, RN-VEN-11/20).** B: vai para aprovação. C: só avisa.
- **PA-4 Base do pedido mínimo.** **A: valor final do pedido (depois de desconto e acréscimo, sem frete).** B: soma dos itens pela tabela, antes do desconto.
- **PA-5 Quem aprova crédito.** **A: continua em Alçadas; o painel Crédito excedido só diz "Quem aprova está em Alçadas."** B: a lista "Quem aprova crédito" sai de Alçadas e vem para este painel, embaixo da opção "Enviar para aprovação".
- **PA-6 Padrão do estoque (código × doc 03).** **A: "Só como orçamento", o que o app e a API fazem desde 10/11 (R-20261110-093124); o doc 03 é corrigido.** B: "Avisar e enviar", como está no doc 03 (muda o comportamento de todos os tenants na atualização).
- **PA-7 Opções do crédito.** **A: as três (aprovação, só orçamento, avisar).** B: só duas (aprovação e só orçamento), sem "Avisar e enviar".
- **PA-8 "Cortar" no estoque (doc 03).** **A: fora da v1.0.39 (mexe na quantidade do vendedor sem ele ver; precisa de desenho no Campo).** B: entra como 4ª opção "Cortar para o disponível".
- **PA-9 Teto do pedido mínimo.** **A: R$ 100.000,00.** B: sem teto.
