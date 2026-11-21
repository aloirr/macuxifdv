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

## 3. Menu: hoje × proposto

| Hoje | Proposto |
|---|---|
| Comercial › Plano de RV | Parâmetros › Metas e RV |
| Comercial › Transportadoras | Cadastros › Transportadoras (o grupo Comercial sai, D4) |
| Comunicação › Regras de alerta | Parâmetros › Alertas |
| Parâmetros (grupo) › Integração | Parâmetros (item direto, D3/D10) › seção Integração |
| Pesquisa (grupo) › Pesquisas | Pesquisa (item direto, D9) |
| Treinamento (grupo) › Trilhas | Treinamento (item direto, D9) |
| Parâmetros em ordem alfabética, entre Operação e Pesquisa | Parâmetros fixo logo acima de Sistema (D1) |

Os demais grupos e itens ficam como hoje. Pior caso de altura (Cadastros aberto, 6 itens): 562 px dos 571 px livres em 1366×768; o menu não rola.
Comportamento (item direto, cadeado, balão "Contrate o módulo para usar", Salvar só no painel alterado, endereços antigos redirecionados): como na versão de 15/11, ADR 0060 e `docs/desenho/menu-parametros.md` §2.

## 4. O que precisa de trabalho além do shell (estimativa do 2b)

Shell (`engenheiro-apps`): ligar `menuParametros: true`, a rota `/parametros/<secao>` com a lista de seções e os redirecionamentos de `destinoParametros`; em `apps/web/lib/menu-bko.ts`, a ordem com `compararGrupoMenu` (D1), o item direto (D9) e o item com cadeado.

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

Gerador: `node docs/design/menu-parametros/gerar.mjs` (escreve os `.html` e `.png` desta pasta; falha se balão ou nota cobrir conteúdo, se o menu rolar com qualquer grupo aberto ou se um item for cortado). Dados fictícios. Cenário: empresa sem Pesquisa e Treinamento, com Trade; perfil Administrador.

| Arquivo | O que mostra |
|---|---|
| `01-menu-hoje-e-proposto.png` | Menu proposto à esquerda, com Parâmetros selecionado; ao lado, o menu de hoje (com o destino do que muda), o proposto aberto e a árvore da página Parâmetros |
| `02-parametros-calendario.png` | Parâmetros › Calendário: Feriados, Almoço, Rastreamento no expediente (alterado, Salvar ativo) e Ausências |
| `03-parametros-pesquisa-sem-licenca.png` | Seção de módulo sem licença: cadeado na lista; o conteúdo mostra só "Contrate o módulo para usar" |

O `03-parametros-pedidos.html` (versão de 15/11) fica só como base do `docs/design/pedido-aprovacao/gerar.mjs`; este gerador não o reescreve.

## 6. Para o Alexandre decidir

- OK da árvore (§2) e do menu (§3) para o 2b.
- Frete padrão em Parâmetros › Pedidos (proposta) e quais parâmetros do doc 03 sem tela entram (§4).
- Ausências fica em Calendário (como no código, T-0156) ou vai para Acesso › Usuários (é cadastro por pessoa).
