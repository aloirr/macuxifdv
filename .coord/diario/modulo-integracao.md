# Diário — modulo-integracao

2026-10-31 — T-0001 — Fase C: esqueleto modules/integracao (manifest, testes, pastas); verde
2026-10-31 — T-0009 — desenho do Hub, contracts Zod (8 entidades, lote, pedido/retorno, eventos) e domain RN-INT-01..09 (97 testes); manifesto +6 eventos; manifest.test.ts bloqueado só por platform-sdk/ambiente.ts ausente
2026-10-31 — T-0009 — revisão do dono: 🟢; trava de inativação em massa (RN-INT-06), perguntas do desenho decididas, eventos novos pedidos ao engenheiro
2026-10-31 — T-0009 — estado 'cancelado' vindo do ERP no retorno (RN-INT-08), contrato e desenho atualizados
2026-10-31 — T-0013 — Conector v1 (apps/conector): config Zod JSON/YAML, segredos (env/Credential Manager), delta com cursor leitura/confirmado, lotes+idempotência, fila node:sqlite, retry, retorno de pedidos, CLI, WinSW, logs mascarados; 118 testes (7 com Postgres); doc conector.md
2026-10-31 — T-0013 — revisão pós-merge (somente leitura): aprovada sem 🔴; intermitência = powershell sem timeout + afterAll PG; correções pela T-0023
2026-10-31 — T-0023 — Conector v1.1.0: linhas inválidas com motivo (500/lote), política de versão mínima/recomendada (resposta do sinal), chave por Conector + trocar-chave, itens_faturados e 2ª nota parcial (estados.ts), adaptador Oracle thin; conector 191 testes (+9 pulados), integracao 122.
2026-10-31 — T-0023 — teste de integração PostgreSQL ajustado à chave por Conector
2026-11-01 — T-0023 — achados da revisão da T-0013: máscara de número, bloqueio quando a página só repete o cursor, consulta numeroErp antes de regravar pedido, Retry-After em data HTTP, aviso de ERP sem TLS fora da LAN (sqlite/Node 22 mantido, documentado)
2026-11-01 — T-0013 — Conector: testes sem PowerShell real (dublê injetado via ES/prepararAmbiente), timeout de 10 s no powershell.exe, limpeza do banco de exemplo tolerante (aviso, não falha)
2026-11-01 — T-0025 — Hub /integracao/v1: hub-api.md (7 endpoints, chave por Conector, Idempotency-Key, limites, política de versão 426, trava de inativação, fila de pedidos/retorno, monitor, entregas por agente), contratos hub.ts/bko.ts, 9 módulos novos no domain com testes (274 no módulo), exceção RN-INT-01, ações no manifesto; 4 recados (engenheiro, banco, vendedor, entrega).
2026-11-01 — T-0025 — revisão do banco: guarda monotônica (linha obsoleta, empate = atualizada), contagem obsoletas, respostas aos 14 amarelos em hub-api.md/desenho.md
2026-11-01 — T-0027 — (registrado pelo gerente; sessão da nuvem) alinhamento Conector ↔ Hub no main pelo PR #24 (fa837c4): linha inválida nunca inativada, Conector 1.2.0, P-1/P-2/P-5/P-6, seção 16 do hub-api.md fechada; integracao 300 testes, Conector 240
2026-11-01 — T-0032 — onda 2: handlers do Hub (modules/integracao/api: autenticar/antes, 7 rotas do Conector, monitor, conectores, política de versão, decidir inativação), hashRegistro SHA-256 (64 hex), itens faturados idempotentes por nota, sequência repetida vira descarte, retido/reativar/elegíveis no domain, external_id ≤ 200 nos erros; consumidores A7/A8 pendentes
2026-11-01 — T-0048 — (registrado pelo gerente; sessão da nuvem) Conector 1.2.1 no main pelo PR #36 (12e45b3): nota faturada sem itens repetidos no fechamento sem nota nova; a fila de retornos mantém a ordem por pedido; Conector 263 testes
2026-11-01 — T-0032 — lint verde (SHA-256 puro no domain), parcial->total sem nota nova testado, piso 1.2.1 do Conector (RN-INT-11)
2026-11-02 — T-0032 — 🔴 A7/A8 entregue (aplicar-lote.ts, consumidores-pedido.ts, 16 testes × Postgres), política efetiva no BKO (montarResumo), textos do piso 1.2.1 corrigidos, RN-INT-14 (aviso cadastro_incompleto; falta ctx.consultar no SDK); T-0061 fica para 03/11
2026-11-02 — correção CI — sha256.test.ts sem node:crypto (vetores UTF-8 fixos); fronteiras e teste verdes
2026-11-02 — T-0060/T-0061 — RN-INT-14 com ctx.consultar direto; 4 entidades novas (catalogo_no, produto_unidade, cliente_endereco, transportadora) com contrato, ordem, eventos e testes; medidas via core.medidas@1 (liga quando o Core publicar); PedidoParaErp ampliado (ADR 0016) com exigeConector 1.3.0, A5 filtrando pela versão do Conector e alerta pedido_aguardando_conector
2026-11-02 — T-0051 — rótulos das 4 entidades novas e avisos de linha em web/lib/apresentacao.ts; suíte do pacote verde
2026-11-02 — T-0063 — medidas no Hub: embalagem_medida/embalagem_quantidade no produto (conferidas), core.medidas@1 tipado (usaConsultas), mensagem com sigla+campo, inativa pede reativar; testes dois-tenants com Postgres real
2026-11-03 — T-0063 — rev. engenheiro 🟡4/🟡5: sigla de medida fora de ^[A-Z]{1,4}$ = formato_invalido não reprocessável (verificarMedidas, sempre conferida); embalagem_quantidade 2..9999 e fator ≤ 9999 no contrato; consumidores.db.test.ts sem SQL em core.medida (stub em memória por tenant; S0-014)
2026-11-03 — T-0063 — Hub separado do #54: branch nuvem/T-0063-medidas-hub (wt-hub) independente do Core (lookup dinâmico de core.medidas@1, usaConsultas sem ela até o Core publicar); principal devolvido ao origin/main; integracao 478 testes verdes
2026-11-02 — T-0065 — monitor do Hub no BKO usa sync_auto_min (RN-CORE-23) e botão Atualizar; saem os timers de 30 s
2026-11-03 — T-0070 — core.medidas@1 em usaConsultas do Hub e import estático de CONSULTA_MEDIDAS (fecha o 🟡 da re-revisão da T-0032); mock do teste removido
2026-11-05 — T-0024 — 16 definições integracao.* no contracts, consumo tolerante do vendedor.pedido.*, espelho removido
2026-11-05 — T-0024 — contracts da integração: import do subpath @macuxi/platform-sdk/eventos (2 arquivos do SDK no bundle do Conector) e registro do evento por entidade com tipo próprio (só tipo, @1)
2026-11-06 — T-0087 — prazo da sessão da carga em partes: aplicar-lote passa a ler ttlSessaoMin do tenant (lerParametrosHub), igual à rota; testes >24 h e padrão
2026-11-06 — T-0087 — fatia P: superAdmin aceita nas rotas da carga por arquivo, lotes e conectores; erros.csv; ordem-carga; conferir sem gravar; export da divisão para o portal
2026-11-06 — T-0087 — PATCH conectores/:id com superAdmin aceita (revogada_por nulo p/ super-admin), teste
2026-11-06 — T-0087 — ctx.parametros ausente no consumidor: leitura defensiva em aplicar-lote.ts + parametros/fuso nos contextos dos testes de banco
2026-11-06 — T-0087 — aplicar-lote usa limite/ttl de inativação do tenant; padrão da sessão 24 h conferido; testes em parametros.test.ts
2026-11-06 — T-0084/T-0085 — ProdutoPayload ganha aplicacao, referencias, oferece_junto e etiquetas (opcionais, @1); Hub corta com aviso (aplicacao_cortada, referencias_cortadas, oferece_junto_cortado); domain/catalogo-produto.ts + testes. Pendente: A7 marca_concorrente_ausente, ItemPedidoErp.aplicacao, Conector (lote 2).
2026-11-06 — T-0084 — ItemPedidoErp.aplicacao (1000, aditivo v1) repassada pela fila; referência inválida descarta só a referência (aviso referencia_descartada); K11 aviso de marca vai ao backlog
2026-11-06 — T-0089 — I1/I2: forma_pagamento, prazo_pagamento e tabela_escalonada no Hub v1 (contratos, ordem de carga, CSV com listas por barra, aviso prazo_medio_divergente), cliente com prazo_medio_max_dias e formas_pagamento, pagamento no pedido ao ERP com condição pelo prazo_external_id; docs hub-api §19, conector, carga-arquivo
2026-11-06 — T-0089 — conferência da 0037: medida da tabela_escalonada passa a exigir sigla 1..4 letras; demais nomes batiam; AVISTA é do consumidor do Vendedor
2026-11-06 — T-0089 — ordem de carga: tabela_escalonada depois de preco (Conector e DEPENDENCIAS), com testes
2026-11-07 — T-0092 — ajv, ajv-formats e tsx como devDependency (lock pedido ao engenheiro-software); respostaOpenApiPublica (200/304, ETag, cache 1 h) pronta para a rota pública; texto da §15 enviado ao gerente
2026-11-07 — T-0092 — §15 do hub-api.md (OpenAPI e guia do TI) aplicada; §4b do carga-arquivo aguarda #97
2026-11-07 — T-0092 — rota pública GET openapi.json declarada no módulo (60/min, cache 1 h), publico.ts simplificado, rota BKO openapi removida, nota da §15 atualizada
2026-11-07 — T-0092 — comentário do ajv no openapi.test.ts corrigido (devDependencies); §15 do hub-api.md enxuta sem perda de informação
2026-11-07 — T-0092 — chave mxk_ corrigida para mxc_ no OpenAPI/guia/hub-api.md; regex do publico.test.ts apertada
2026-11-07 — T-0089 I2 — exemplos do Conector (SQL Server 15 entidades, Oracle com as 3 novas e cliente) lendo vw_macuxi_<e>; teste de cobertura; conector.md alinhado à premissa de nulo; teste de fila com pagamento; mxk_ -> mxc_
2026-11-07 — T-0087 — §4b (modelos CSV e dicionário, N1) aplicada em carga-arquivo.md, conferida contra o código; v1 só super-admin
2026-11-07 — T-0089 — I2: desempate binário do cursor nos exemplos SQL Server/Oracle, teste e doc (🔴 da revisão)
2026-11-07 — T-0099 — Conector sobe para 1.3.0 (VERSAO_MINIMA_NULO, changelog no conector.md, teste de que o nulo exige a versão nova); chave numérica do conector.md conferida
2026-11-07 — T-0103 — teste de banco do aplicar-lote com limite 50%/10% e prazo 3 dias do tenant; desenho do retorno do Catálogo (desenho.md §14) e recado ao modulo-catalogo
2026-11-08 — T-0114 — cancelamento devolvido ao ERP: config conector.aceita_cancelamento (BKO), consumidor de vendedor.pedido.cancelado@1, cancelamentos[] aditivo no GET /pedidos/pendentes (v1), confirmação pelo retorno cancelado, Conector executa pedidos.cancelamento.executar (tabela local cancelamento); depende da migração pedida ao banco-dados (R-20261107-235216).
2026-11-08 — T-0114 — consumidor de vendedor.pedido.cancelado@1 e GET /pedidos/pendentes (cancelamentos) com os nomes da 0043; consulta integracao.cancelamento_erp@1 ({aceita}) oferecida (contrato, domain erpAceitaCancelamento, API, manifesto); 5 testes de banco novos (rodam no CI).
2026-11-08 — T-0114 — aviso de recusa do cancelamento pelo ERP: retorno aditivo cancelamento_recusado (contrato, rota, Conector), alerta cancelamento_recusado no monitor, evento integracao.pedido.cancelamento_recusado@1, configuracaoDoTenant em integracao.cancelamento_erp@1 (D-1); 0047 pedida ao banco-dados
2026-11-08 — T-0114 — consumidores.db.test.ts: limite_pct lido como número (A7) e limpar() apaga pedido_retorno antes da fila (A8); lint/typecheck/test verdes
2026-11-08 — T-0114 — RD-0026 (alerta de recusa único, frase curta) e RD-0027 (aceiteDoTenant), teste PG do Conector com MACUXI_PG_TESTES_URL, 8 recados antigos encerrados
2026-11-08 — T-0099/T-0103/T-0116/T-0120 — ordem_divergente em operação (log+status), aviso de marca desconhecida no monitor, atualização automática ligada ao executor (desligada), de-para no BKO (rotas, domain, painel) e tabela_preco_external_id no cliente; 13 recados antigos encerrados; protegerFormula unificado; useAgora (T-0140)
2026-11-09 — T-0100 — carga por arquivo self-service no BKO (modelos e carga pela ação carga.arquivo do motor, página Carga por arquivo com partes e chave de idempotência), SinalConector.atualizacao aditivo (Conector, Hub, monitor, OpenAPI), suíte do Conector verde, 137 avisos da caixa lidos
2026-11-09 — T-0115 — ClientePayload.canal (aditivo v1), de-para tipo canal (traduzirCanalDoCliente no aplicar-lote), rótulo no BKO, OpenAPI regerado; T-0098 não iniciada (porta de URL assinada ainda não está no SDK); pendente banco-dados: view e CHECK
2026-11-09 — T-0115 — canal mapeado nos exemplos do Conector (SQL Server e Oracle); suíte do conector verde
2026-11-09 — T-0098 — rota POST /v1/integracao/conector/download (conector.gerenciar, superAdmin aceita), LinkDownloadConectorSchema, auditoria conector.download_link sem URL, testes
2026-11-09 — T-0141 (item C) — EnderecoEntregaErp.origem aditivo no v1, guia com a regra external_id nulo = textos, 7 testes RN-VEN-17
2026-11-09 — T-0141 (item C) — EnderecoEntregaErp.origem aditivo no v1, guia com a regra external_id nulo = textos, 7 testes RN-VEN-17
2026-11-09 — T-0141 C — coleção Postman regerada do openapi-hub-v1.json (EnderecoEntregaErp.origem); colecao.test.ts verde (12/12); Insomnia sem mudança
2026-11-09 — T-0140 — RD-0043: mascararDadoPessoal do Hub renomeada para mascararMensagemDoConector (regra própria documentada, saída ao ERP/BKO inalterada); RD-0051: BOM local trocado por BOM_CSV do comum em 5 arquivos; célula compacta mantida (variante aguarda engenheiro-software).
2026-11-10 — T-0149 — filial no Hub v1 (entidade, filial_external_id, PedidoParaErp.filial, exigeConector 1.4.0), Conector 1.4.0 empacotado, docs; aguardando banco-dados (views/CHECK) e testes/corretor
2026-11-10 — T-0149 — Conector 1.4.0: parametrosCabecalho repassa frete/entrega/pagamento (23 parâmetros), exemplos SQL Server/Oracle, doc, dist reempacotado; pedido ao banco-dados do modelo; faltam ZIP/assinatura/S3 para publicar
2026-11-10 — T-0098 — script apps/conector/scripts/pacote.mjs (zip win-x64 + sha256 + sig) com testes; workflow de publicação pedido ao engenheiro-software
2026-11-10 — T-0149/T-0098 — conector.md (montagem por pacote.mjs e conector-publicar.yml), UF da filial com regex + teste, roteiro-ensaio-conector-1.4.0.md, 8 recados encerrados
2026-11-10 — OpenAPI do Hub e coleções regerados (ensaio 3)
2026-11-10 — T-0159 — FilialPayload com cnpj/endereco/telefone; carga rejeita filial sem CNPJ valido ou endereco (RN-CORE-39); exemplo do Conector 1.4.0 e roteiro do ensaio; OpenAPI e colecoes regerados
2026-11-11 — T-0159 (checagem pré-ensaio) — tsc/eslint ok; regerada a coleção Postman/Insomnia e exemplos CSV de filial com CNPJ/endereço; testes sem banco verdes
2026-11-11 — T-0159 — FilialPayload usa LIMITES_FILIAL e CAMPOS_OBRIGATORIOS_FILIAL do Core (RD-0122); mensagens iguais; tsc e contracts verdes
2026-11-12 — T-0162 — kit do piloto: Instalar-Piloto.ps1 (idempotente, -Limpar), SQL da ERP_PILOTO, planilhas .xlsx, Conector como serviço, tarefa "ERP via API" (Node, cliente-hub), 2 empresas teste com origem do pedido, roteiro de 1 página e montar-kit (zip); validação do testes/corretor pendente
2026-11-12 — T-0162 — correções do testes e do banco-dados no kit: forma/prazo de pagamento do pedido (D-1), carga que falha não derruba pedidos (D-2), situacao_em no status (D-3), firewall só Privado/Domínio (D-4), erro no log do PS 5.1 (D-5), senha no cofre antes do npm e sem trocar senha do Conector sem zip (D-6); SQL A-H (status com nota/motivo, gatilho, chave da nota_item, GRANT mínimo, baixado_em, DISTINCT, CHECK); roteiro com Se der errado; oracle.exemplo com views novas
2026-11-13 — T-0162 — RD-0219 a RD-0233 aplicados (roteiro enxuto, instalador sem excesso, paridade kit x Conector com teste), defeitos 1 a 6 corrigidos, doc corrigido; kit remontado com o Conector 1.4.0 (C:\Users\domon\Downloads\macuxi-kit-piloto-1.0.0.zip); reteste pedido a testes e corretor
2026-11-13 — T-0162 — RD-0226/0233/0237 aplicados, zip remontado (SHA-256 496471ba…ede8), reteste pedido ao corretor
2026-11-13 — T-0162 — D-T0162-7: passos do instalador numerados 1 a 6; zip do kit remontado com --conector (SHA-256 5a406faec8418f0aa6fd55be4c0dd4ac4a0fa1201cbf1347e86ae96a3763dcb7)
2026-11-15 — fonte do sistema v1.0.13 — web: tamanhos fora da escala ajustados (11→12, 14→13, 18→17); sem fonts./Archivo/Plex no módulo
2026-11-15 — RD-0945 — painéis web de Integração na escala por papel: campo/alerta 15, subtítulo 17, número de cartão 17/600
2026-11-15 — R-20261115-174800 — kit: conversor dos CSVs 1.0.5 para o modelo com marca das referências (scripts/migrar-csv-1.0.5.ts) e regra do código da marca pelo nome (domain/marca-referencia-codigo.ts, RN-CAT-09); os CSVs da empresa não vieram no zip 1.0.5
2026-11-19 — T-0186 — v1.0.15: forma_pagamento_codigo (nota e titulo), nf_numero/nf_serie (titulo) e nf_origem_numero/nf_origem_serie (nota) opcionais no Hub v1; OpenAPI, guia, modelos CSV e kit regerados
