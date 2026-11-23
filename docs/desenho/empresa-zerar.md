# Desenho — "Zerar dados" da empresa no portal (v1.0.30)

- **Origem**: pedido do dono do produto na v1.0.30: "coloque um botão ao lado do excluir chamado 'zerar dados'. vou clicar lá para zerar os dados".
- **Decisão**: ADR 0068 (proposta). **Contrato**: `packages/platform-sdk/src/empresa-zerar.ts`. **Base**: ADR 0052 e `docs/desenho/empresa-acoes.md`.
- **Autor**: engenheiro-software. **Tarefa**: o gerente atribui o número. **Migração**: 0099 (a 0098 é da sessão C, v1.0.29).

## 1. Onde a regra mora e por quê
A lista do que sai, a ordem e a cópia moram **só no banco**, na função `plataforma.zerar_tenant(p_zerar uuid)` da 0099. O worker do portal e o workflow `producao-limpar-cadastros.yml` chamam essa função. Nenhum dos dois tem lista própria.

Por que no banco:
1. A ordem vem do catálogo (FKs), como na `excluir_tenant` (0032). Uma tabela nova com `tenant_id` entra sozinha no conjunto, e a ordem segue as FKs dela.
2. A função apaga numa transação só, com o dono migrador e a política `manutencao`. O TS do worker não tem acesso ao catálogo nem às tabelas de todos os módulos (regra 1), e o workflow roda `psql` sem a API.
3. Uma lista no TS e outra no workflow divergiriam na primeira tabela nova.

O conjunto é **derivado**: toda tabela com `tenant_id` (como a `excluir_tenant`) **menos** a lista explícita de mantidas da `plataforma.tabelas_mantidas_no_zerar()`, mais três tabelas parciais (§4). Para nenhuma tabela nova de configuração ser apagada sem ninguém decidir, o teste de banco **tem a lista das tabelas que saem**. Uma tabela nova com `tenant_id` que não esteja nem nela nem nas mantidas derruba o teste, e o autor da migração decide onde ela fica.

A ordem por FK é a mesma da 0032. O banco-dados extrai o laço dela para `plataforma.apagar_em_ordem_fk(p_tenant uuid, p_alvos jsonb, p_copia uuid)`, com o predicado por tabela e a cópia opcional, e recria a `excluir_tenant` chamando-o, com a mesma assinatura, o mesmo retorno e os testes da 0032 verdes. Se a extração não couber na v1.0.30, a `zerar_tenant` traz o laço, e um 🟡 fica aberto para unificar depois.

## 2. Backup antes: decisão
**Achado**: no `main` (6b2cfd4) não existe o worker TS do backup e da exclusão (`docs/desenho/empresa-acoes.md` §7). Existem só o SQL da 0072 e os testes de banco. Um backup `pronto` nunca é produzido, e a exclusão nunca libera.

**Decisão (c) — cópia no banco, na mesma transação.** A `zerar_tenant` copia cada linha antes de apagá-la, como `to_jsonb(linha)`, para `plataforma.zerar_empresa_copia`. Copia também o "antes" das linhas mantidas que ela altera (§4). Os bytes das fotos e dos pacotes de sync **não** são apagados na hora: as chaves vão para `plataforma.zerar_empresa_objeto`.

A cópia e os bytes ficam **7 dias** (`RETENCAO_COPIA_ZERAR_DIAS`). Nesse prazo, o time desfaz com `plataforma.restaurar_zerar(p_zerar)`, uma operação manual, só do dono do banco. Depois o worker expurga a cópia e apaga os objetos.

As alternativas e por que ficaram de fora:
- **(a) exigir um backup `pronto` como a exclusão**: deixaria o botão sempre travado, porque ninguém gera backup hoje.
- **(b) fazer o worker do backup agora** (cifra AES-256-GCM, S3, manifesto, restauração): é a maior parte da ADR 0052 e não cabe na v1.0.30. Continua devido, com o worker da exclusão, como pendência da ADR 0052.

**Premissas**:
- a empresa a zerar tem volume de implantação ou teste. Acima de `LIMITE_LINHAS_ZERAR` (2 milhões de linhas), o portal recusa com `ZERAR_VOLUME_ALTO`;
- o dump diário do banco (RN-PLA-11) é a segunda rede;
- a cópia fica no mesmo banco, que já guardava os dados. O RLS fica ligado, sem GRANT a nenhum papel da aplicação.

## 3. Fluxo
```
Portal  GET  …/zerar/previa   → sa_previa_zerar(sid, tenant)                → PreviaZerarEmpresa (contagem por tabela + bloqueio)
Portal  POST …/zerar          → Zod → sa_reautenticar (senha) → sa_pedir_zerar(sid, tenant, id, codigo)
                                 → zerar_empresa em_andamento + auditoria tenant.zerar_pedido → 202 ZerarEmpresa
Worker  pegar_zerar()          (for update skip locked; concessão de 10 min)
        BEGIN; set local statement_timeout = '15min'; set local lock_timeout = '5s';
        executar_zerar(id)     → confere de novo (conferirZerar) → zerar_tenant(id) → semear_pagamento → girar_geracao_base
                                 → zerar_empresa concluido + contagem + copia_expira_em + auditoria tenant.zerado; COMMIT
        erro 23503/40001/40P01/55P03 → ROLLBACK, nova tentativa (2 s, 5 s); na 3ª: fechar_zerar(id, falhou, ZERAR_CONCORRENCIA)
        outro erro → ROLLBACK; fechar_zerar(id, falhou, ZERAR_FALHOU) + auditoria tenant.zerar_falhou
Portal  GET  …/zerar          → sa_ler_zerar(sid, tenant) a cada 5 s até concluido|falhou
Worker  (a cada hora) objetos_do_expurgo_zerar() → remove do armazenamento → fechar_expurgo_zerar(id): apaga cópia e objetos, expurgado_em
Workflow psql (migrador): select plataforma.zerar_tenant_manual('<tenant>', '<codigo>')  → mesma executar, origem 'workflow'
```
Falha = nada muda (uma transação). Não é preciso inativar a empresa antes: escrita concorrente de aparelho ou do Conector derruba a transação por FK, e o worker tenta de novo. Recomendação na tela: zerar fora do horário de uso.

**Estados** de `zerar_empresa`: `em_andamento` → `concluido` | `falhou` (finais). Só um `em_andamento` por empresa (único parcial). O `concluido` ganha `expurgado_em` quando a cópia some.

## 4. Apaga × mantém (conferido na 0097, `pg_class` com `tenant_id`: 159 tabelas)
**Mantém (49, em `tabelas_mantidas_no_zerar()`)**:

| Esquema | Tabelas |
|---|---|
| plataforma | `tenant` (sem `tenant_id`), `assinatura`, `assinatura_historico`, `tenant_modulo`, `perfil`, `perfil_modulo`, `perfil_permissao`, `usuario_perfil`, `usuario_modulo`, `parametro`, `auditoria` (trilha legal); `arquivo` **parcial** |
| core | `usuario`, `usuario_contato`, `usuario_avatar`, `usuario_convite`, `usuario_codigo_fdv_contador`, `equipe`, `sessao`, `dispositivo`, `ausencia_usuario`, `motivo`, `medida`, `foto_tipo`, `frase_dia`, `documento_tipo`, `documento_permissao`, `plano_rv`, `meta_produtividade`; `filial` e `usuario_filial` **parciais** |
| vendedor | `numeracao_pedido` (o número não volta: o ERP já tem os pedidos enviados) |
| integracao | `conector`, `conector_api`, `credencial`, `credencial_erp`, `mapeamento`, `politica_versao`, `implantacao` |
| gestor | `alerta_regra` |
| pesquisa | `questionario`, `questionario_versao` |
| treinamento | `trilha`, `modulo_trilha`, `licao`, `quiz`, `questao`, `alternativa`, `trilha_publicacao`, `medalha` |

**Parciais**:
- **`core.filial`**: fica só a padrão (`padrao and deleted_at is null`), que é a filial semeada pelo gatilho da 0056.
- **Usuários (RN-CORE-39)**: todo usuário com `filial_cadastro_id` de outra filial passa à padrão (o "antes" vai para a cópia, `acao = 'update'`). Em `core.usuario_filial`, saem as linhas de outras filiais e entra a linha (usuário, padrão) onde faltar. O gatilho adiado `usuario_filial_inclui_cadastro` confere no COMMIT. Sem isso, os usuários, o admin inclusive, ficariam bloqueados. Consequência: as filiais de venda de cada usuário são refeitas no BKO depois da nova carga.
- **`plataforma.arquivo`**: fica só o que `core.usuario_avatar.arquivo_id` (vivo) referencia.

**Apaga (110 inteiras + o resto das parciais)**:

| Esquema | Tabelas |
|---|---|
| catalogo | `busca_log`, `catalogo_no`, `cliente_tabela_preco`, `deposito`, `estoque_saldo`, `foto_lote`, `foto_lote_item`, `marca_concorrente`, `produto_atributo`, `produto_busca`, `produto_conteudo`, `produto_midia`, `produto_no`, `produto_referencia`, `produto_relacao`, `sinonimo`, `tabela_escalonada`, `tabela_preco`, `tabela_preco_item`, `uso_ia` |
| core | `carteira`, `cliente`, `cliente_contato`, `cliente_endereco`, `cliente_financeiro`, `cliente_foto`, `deslocamento_dia`, `documento_cliente`, `documento_excecao`, `historico_compra`, `indicador_diario`, `meta`, `nota_erp`, `notificacao`, `ponto_trajeto`, `produto`, `produto_unidade`, `rota`, `rota_parada`, `tarefa`, `tarefa_destinatario`, `titulo`, `visita`, `visita_etapa` |
| vendedor | `cliente_condicao`, `condicao_pagamento`, `forma_pagamento`, `prazo_pagamento`, `transportadora`, `pedido`, `pedido_item`, `pedido_aprovacao`, `pedido_devolucao`, `pedido_evento`, `pedido_faturamento` |
| integracao | `lote`, `lote_linha_erro`, `lote_staging`, `registro_atual`, `cursor_entidade`, `sessao_carga`, `sessao_carga_recebido`, `pedido_fila_erp`, `cliente_fila_erp`, `pedido_retorno`, `pedido_retorno_erro`, `pendencia_inativacao`, `inativacao_auditoria`, `reconciliacao`, `coleta_execucao`, `implantacao_dia` |
| promotor | todas as 20: os registros e também os cadastros do trade (concorrentes, categorias de gôndola, checklists, mix, metas de share, tarefas e fotos de referência), que dependem de cliente e produto |
| pesquisa | `resposta`, `resposta_item`, `resposta_foto` |
| treinamento | `progresso`, `tentativa`, `xp_lancamento`, `medalha_usuario`, `desafio_vendas`, `desafio_vendas_produto` |
| gestor | `alerta`, `evento_aplicado`, `projecao_fato` |
| plataforma | `evento`, `evento_consumo` (toda a outbox do tenant, publicada ou não), `trabalho`, `email_saida`, `diagnostico`, `sync_pacote`, `sync_pacote_pedido` |

**Depois de apagar, na mesma transação**:
- `vendedor.semear_pagamento(p_tenant)` (0037) devolve a forma e o prazo padrão, como na empresa nova;
- `plataforma.girar_geracao_base(p_tenant)` (0022): o aparelho reenvia a fila, limpa a cópia local e puxa tudo. A escrita offline que dependia de cadastro apagado volta com erro, e o testes confere a mensagem.

**Hub**:
- `cursor_entidade` vazio dá `GET /integracao/v1/cursores/{entidade}` com `cursor: null`, e o Conector reenvia desde o início;
- `registro_atual` vazio: o Hub não descarta o reenvio como "sem mudança";
- credenciais, conector e mapeamentos ficam.

**Arquivos no bucket**:
- os bytes de `plataforma.arquivo` (com miniatura e partes `.pNNN.zip`) e de `sync_pacote` apagados saem **no expurgo, 7 dias depois** (assim o desfazer volta completo);
- a linha some na hora, e o GET do arquivo dá 404;
- a logo da empresa (`<tenant>/plataforma/…`, colunas do `plataforma.tenant`) fica.

## 5. Banco (0099, banco-dados)
Tabelas novas, sem `tenant_id` nem FK para `plataforma.tenant`, para sobreviverem à `excluir_tenant`, como as da 0072. O RLS fica ligado, com política `manutencao`, e a exceção da regra 5 vai ao `docs/banco/rls.md`.
- `plataforma.zerar_empresa`: `id`, `empresa_id`, `codigo`, `origem` (`portal`|`workflow`), `situacao`, `pedido_em`, `concluido_em`, `linhas_apagadas`, `contagem jsonb`, `copia_expira_em`, `expurgado_em`, `erro_codigo`, `tentativas`, `bloqueado_ate`, `super_admin_id`, `sessao_id`, mais as 5 colunas padrão. Checks espelham o `ZerarEmpresaSchema`. Único parcial: (`empresa_id`) where `em_andamento`.
- `plataforma.zerar_empresa_copia`: `zerar_id` (FK), `ordem`, `tabela`, `acao` (`delete`|`update`), `linha jsonb`.
- `plataforma.zerar_empresa_objeto`: `zerar_id`, `armazenamento` (`arquivos`|`sync_pacotes`), `chave`, `tipo`, `removido_em`.

Funções. As `sa_*` têm EXECUTE só para o `macuxi_portal`, e a lista de `sa_*` muda: a migração e o teste da lista vão no PR conjunto `alexandre/migracao-zerar`.
- `sa_previa_zerar(sid, tenant) → jsonb` (`PreviaZerarEmpresa`): conta com o mesmo conjunto e os mesmos predicados da `zerar_tenant`, só as tabelas com linhas e na ordem de apagar, e devolve o `bloqueio`.
- `sa_pedir_zerar(sid, tenant, id, codigo) → jsonb`:
  - só super-admin;
  - `advisory_xact_lock` por empresa, e o mesmo `id` devolve o mesmo pedido;
  - revalida a `conferirZerar` e o código;
  - grava o pedido e a auditoria `tenant.zerar_pedido`.
- `sa_ler_zerar(sid, tenant) → jsonb|null`: devolve o mais recente.

Funções do worker (SECURITY DEFINER, EXECUTE só para o `macuxi_worker`; o tenant sai sempre da linha do job): `pegar_zerar()`, `executar_zerar(id)`, `fechar_zerar(id, resultado)`, `objetos_do_expurgo_zerar(limite)` e `fechar_expurgo_zerar(id)`.

Funções só do dono, sem GRANT:
- `zerar_tenant(p_zerar)`, a regra;
- `zerar_tenant_manual(p_tenant, p_codigo)`, a entrada do workflow;
- `restaurar_zerar(p_zerar)`: insere da cópia em ordem inversa (`jsonb_populate_record`), reaplica os `update`, apaga antes a forma e o prazo semeados, gira a geração e audita `tenant.zerar_desfeito`. Recusa (55000) quando há linha nova nas tabelas do conjunto ou quando a cópia já foi expurgada.

Testes (`*.db.test.ts`), na sessão, com o Postgres local:
- classificação (§1);
- dois tenants: o outro fica intacto;
- mantidas iguais antes e depois;
- filial padrão e RN-CORE-39;
- cursores vazios e `geracao_base` girada;
- a cópia tem todas as linhas apagadas;
- `zerar → restaurar → contagem igual por tabela`;
- idempotência do `sa_pedir_zerar`;
- recusas (409/422);
- o `macuxi_app` e o `macuxi_worker` sem acesso às tabelas novas;
- `excluir_tenant` com os testes da 0032 verdes depois da extração.

## 6. API e worker (engenheiro-software)
- **Rotas** em `apps/api/src/empresa-zerar-portal.ts` (arquivo novo), ligadas com as ações da empresa (`MACUXI_EMPRESA_ACOES=1`):
  - `GET …/zerar/previa` dá 200;
  - `POST …/zerar` faz Zod (`PedirZerarEmpresaSchema`), depois a senha (a mesma `reautenticar` das ações, exportada de `empresa-acoes-portal.ts`), e dá 202;
  - `GET …/zerar` dá 200, ou 404 `ZERAR_NAO_ENCONTRADO`;
  - mapeamento: hint do SQLSTATE 55000 dá 409; 22023 com `ZERAR_*`, 422; P0002, 404; 42501, 403 `PERFIL_SEM_ACESSO`. Mensagem por `mensagemDoZerar`.
- **Worker** em `apps/api/src/empresa-zerar-worker.ts` (arquivo novo):
  - laço a cada 10 s, com pool próprio `max: 1`, porque o `poolWorker` tem `statement_timeout` de 30 s;
  - tentativas pela `TENTATIVAS_ZERAR`;
  - expurgo de hora em hora, pelas portas `ArmazenamentoArquivos.remover` (chave, `chaveDaMiniatura`, partes do zip) e dos pacotes de sync;
  - liga só com a 0099 no banco (consulta de existência, como a `SQL_EXISTE_0058`).
- **Log** (pino): `request_id`, `zerar_id`, `tenant_alvo_id`, `erro_codigo` e contagens. Nunca código digitado, senha, nome ou documento.
- **Registro em arquivos compartilhados** (combinar com a sessão C):
  - `app.ts`: 1 import e 1 chamada `registrarRotasZerarEmpresa(app, deps)` dentro do `if (op.empresaAcoesPortal)` já existente (~3 linhas);
  - `worker.ts`: 1 import, `const zerar = await iniciarZerarEmpresa();` ao lado de `iniciarTrabalhos()`, e `await zerar?.parar()` no desligamento (~3 linhas);
  - `empresa-acoes-portal.ts`: exportar a `reautenticar` (refatoração pequena, sem mudar o comportamento).

## 7. Permissões e auditoria
- Só o super-admin, com a sessão do portal `config.`, o código da empresa digitado (`codigoDeConfirmacaoConfere`) e **a senha de novo**, como no Excluir.
- O admin do cliente recebe 403 `PERFIL_SEM_ACESSO` (`MENSAGEM_SO_SUPER_ADMIN_ACOES`).
- Auditoria em `plataforma.auditoria_plataforma`, que é o histórico da empresa:
  - `tenant.zerar_pedido`;
  - `tenant.zerado`, com os detalhes do `plataforma.tenant.zerado@1` (fora da outbox) e a contagem por tabela na linha do job;
  - `tenant.zerar_falhou`;
  - `tenant.zerar_desfeito`.
- A API também audita a requisição (`marcarPortal`).

## 8. Códigos
`CODIGOS_ZERAR_EMPRESA`:
- 404: `TENANT_NAO_ENCONTRADO`, `ZERAR_NAO_ENCONTRADO`;
- 409: `ZERAR_EM_ANDAMENTO`, `EXCLUSAO_EM_ANDAMENTO`, `BACKUP_EM_ANDAMENTO`;
- 422: `ZERAR_CODIGO_NAO_CONFERE`, `ZERAR_VOLUME_ALTO`;
- 403: `REAUTENTICACAO_FALHOU`.

Worker: `ZERAR_CONCORRENCIA` e `ZERAR_FALHOU`. O texto final é do designer-ux.

## 9. Regra nova (para o doc 03, pelo gerente)
**RN-PLA-12**: só o super-admin zera os dados de uma empresa, ativa ou inativa. Ele vê antes a contagem do que sai, digita o código da empresa e a senha dele de novo.

O zerar apaga numa transação todos os dados da empresa, menos:
- a empresa, o plano e as licenças;
- os usuários (equipes, contatos, avatar, sessões e aparelhos), os perfis e os parâmetros;
- as configurações: motivos, medidas, tipos de foto e de documento, frases, planos de RV, metas de produtividade, regras de alerta, questionários e trilhas;
- os conectores, as credenciais e os mapeamentos;
- a numeração dos pedidos;
- a filial padrão, que passa a ser a de cadastro e de venda de todo usuário.

Na mesma transação:
- os cursores do Hub zeram, e o ERP reenvia tudo;
- a geração da base gira, e os aparelhos limpam a cópia local;
- a forma e o prazo padrão voltam.

O zerar é recusado com exclusão, zerar ou backup em andamento e acima de 2 milhões de linhas. A cópia das linhas e os bytes das fotos ficam 7 dias, para o time desfazer, e depois somem. O resultado vai para a auditoria `tenant.zerado`.

## 10. Quem faz o quê

| Dono | O que faz |
|---|---|
| **banco-dados** | §5 inteiro na 0099, no PR conjunto `alexandre/migracao-zerar` com o teste da lista de `sa_*`; `docs/banco/plataforma.md` e `rls.md` |
| **engenheiro-software** | §6: rotas, worker, expurgo, as linhas de registro combinadas com a sessão C; linha do evento em `.coord/contratos/eventos.md`; revisão final |
| **engenheiro-apps** | `apps/web/components/portal/empresas-acoes.tsx`: item "Zerar dados" no menu ⋯ ao lado de "Excluir" (só super-admin). Diálogo: prévia (`resumirPreviaPorGrupo`), campo do código e campo da senha; botão habilitado só com `bloqueio` nulo e o código conferindo; `id` com `crypto.randomUUID()`; progresso por GET a cada 5 s; resultado com `linhas_apagadas`. Erros por `mensagemDoZerar`. Modo falso do portal com as respostas novas |
| **designer-ux** e **design-de-marca** | Textos e layout do item e do diálogo (o rascunho está nas constantes do SDK); validação da marca na mudança de layout |
| **testes** | `tests/`, na sessão: tenant demo → a prévia bate com a contagem por tabela → zerar → as tabelas da §4 vazias, as mantidas iguais, outro tenant intacto, a filial padrão e os usuários desbloqueados, a geração girada, os cursores nulos, a auditoria `tenant.zerado` → restaurar → contagens iguais. Recusas 403, 409 e 422, e a idempotência do POST. Roteiro manual: aparelho com fila pendente depois do zerar |
| **modulo-integracao** (pergunta) | Confirmar que o Conector, com `cursor: null`, reenvia desde o início em todas as entidades (doc 06) |
