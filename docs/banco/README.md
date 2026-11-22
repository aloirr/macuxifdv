# Banco de dados — como subir, testar e derrubar

Dono: `banco-dados`. Pacote `@macuxi/db` em `db/`. Postgres 16 + pgvector via Docker Desktop
(imagem `pgvector/pgvector:pg16`, a mesma do CI — T-0005).

> **Situação em 2026-10-31:** Docker Desktop instalado (motor 29.9.2). Migrações up/down/up, seed
> Fase M, fixture dois-tenants e a suíte inteira de `db/testes/` rodam no container `macuxi-postgres`
> (74 testes, 0 pulados). Medição do sync em [desempenho-sync.md](desempenho-sync.md).
> SQLite do aparelho (esquema local, FTS5 do Catálogo, limpeza RN-CORE-02/15 e medições da T-0008):
> [aparelho-sqlite.md](aparelho-sqlite.md).
> **2026-11-01 (T-0029):** migrações até a `0009` (0008 preço do Catálogo, 0009 pedido completo do Vendedor); suíte de
> `db/testes/` com 300 casos, 0 pulados. Dicionários: [plataforma.md](plataforma.md), [core.md](core.md),
> [catalogo.md](catalogo.md), [vendedor.md](vendedor.md).
> **2026-11-01 (T-0032):** `0010_integracao` (schema `integracao` do Hub: 17 tabelas, `autenticar_chave`, `expurgar_retencao`)
> e `0011_plataforma_outbox_retencao` (expurgo da outbox + comentário de legado em `tenant_modulo.parametros`); dicionário
> [integracao.md](integracao.md); fixture com Conector, chave (HMAC com `PEPPER_HUB_FIXTURE`) e linhas de A e B em toda tabela nova.
> **2026-11-02 (T-0055, nuvem):** `0014_gestor` (schema `gestor`: `evento_aplicado`, `projecao_fato`, `alerta`, `alerta_regra`;
> retenção pela API sob RLS, sem função SECURITY DEFINER); dicionário [gestor.md](gestor.md); fixture com linhas de A e B nas 4 tabelas;
> seed da demo do Gestor em `db/seeds/demo/gestor.ts` (licença + projeção). **Depende da `0013` (Catálogo) na pasta** (o
> executor recusa buraco na numeração).
> **2026-11-02 (T-0056):** `0015_promotor` (schema `promotor`: 9 cadastros de trade e 11 coletas com payload jsonb + colunas
> derivadas por gatilho, FK composta coleta → visita de loja, sem DELETE); dicionário [promotor.md](promotor.md); seed da demo em
> `db/seeds/demo/promotor.ts` (`gravarDemoPromotor`) e fixture em `db/seeds/fixtures/promotor.ts` (ids nos grupos 0x84–0x97; o Gestor usa 0x70–0x73).
> **2026-11-02 (T-0057, nuvem):** `0016_pesquisa` (schema `pesquisa`: questionário, versões, respostas, itens e fotos;
> RN-PES-01 e RF-PES-04 no banco); dicionário, consultas do repositório SQL e passos de integração em [pesquisa.md](pesquisa.md);
> seed demo da Pesquisa em `db/seeds/demo/pesquisa.ts` (ligar no `carregarDemo`, ver pesquisa.md).
> **2026-11-02 (T-0058):** `0017_treinamento` (schema `treinamento`: 14 tabelas — conteúdo, publicação, progresso, tentativas,
> XP, medalhas e desafio de vendas); dicionário [treinamento.md](treinamento.md); fixture própria (`db/testes/fixture-treinamento.ts`,
> carregada pelo globalSetup, ids nos grupos 0x170–0x17d) e seed da demo `db/seeds/demo/treinamento.ts` (licença do módulo na demo;
> ligar no `carregarDemo`, ver treinamento.md).
> **2026-11-02 (T-0063, nuvem):** `0018_medidas` (`core.medida` com lista inicial em todo tenant, FKs compostas de
> `produto.unidade`/`embalagem_medida` e `produto_unidade.unidade`, item do pedido com `medida`/`quantidade_embalagem`/
> `quantidade_unidades` derivados de `unidade`/`fator`/`quantidade` por gatilho que sempre sobrescreve + CHECKs; embalagem do
> produto de 2 a 9999; sigla fora do formato em produto aborta com tenant e sigla, em item antigo vira medida nula); dicionário em [core.md](core.md) e [vendedor.md](vendedor.md); seed da demo em
> `db/seeds/demo/medidas.ts` (`gravarDemoMedidas`, ligado no `carregarDemo` na T-0070). **Depende da `0016` e da `0017` na pasta** (o executor recusa buraco).
> **2026-11-03 (T-0066 e T-0065):** `0019_core_nota_erp_meta_tipo` (aditiva: `core.nota_erp` — notas de faturamento/devolução do ERP,
> base idempotente do recálculo de `historico_compra`, fora do pull, único vivo por `external_id` e índices por cliente/mês e por mês —
> e `core.meta.tipo` `pedido | faturamento`, padrão `pedido`, RN-CORE-21); dicionário em [core.md](core.md).
> **2026-11-03 (T-0071):** `0020_pedido_ajuste_valor_produto_relacao` (aditiva: ajuste em R$ no pedido — `desconto_valor_cents`/`acrescimo_valor_cents`/`ajuste_em` — e no item por unidade da medida vendida — `desconto_unitario_cents`/`acrescimo_unitario_cents`/`ajuste_em` — com CHECKs de exclusividade, sentido coerente com o %, R$ do item <= tabela e preço unitário coerente; índice `pedido_orcamento_aberto_ix`; nova `catalogo.produto_relacao` (complementar/superior/substituto, sem FK para o Core, pull tenant)); dicionário em [vendedor.md](vendedor.md) e [catalogo.md](catalogo.md); base demo com a referência do novo pedido (Mini Box Japiim C5110). **Não aplicada na demo (5432) até o gerente decidir.**
> **2026-11-05 (T-0084/T-0085):** `0033_catalogo_aplicacao_referencia`. Detalhes no [catalogo.md](catalogo.md) e no [vendedor.md](vendedor.md):
> - aplicação até 2.000 e `etiquetas` no `produto_conteudo`;
> - `aplicacao` (peso C) e `referencias` (peso A) no documento de busca do servidor;
> - nova `catalogo.produto_referencia`: até 3 por produto, `marca_id` = concorrente do Promotor sem FK, `codigo_compacto` gravado pela API e indexado;
> - `vendedor.pedido_item.aplicacao` (retrato, até 1.000).
>
> Nada em `core.*` nem em `promotor.*`, pela correção do gerente: a ADR 0027 não vale.
>
> Aparelho **v3**: FTS recriada com `aplicacao` e `referencias` ([aparelho-sqlite.md](aparelho-sqlite.md) §4.2).
>
> Seed demo em `db/seeds/demo/catalogo-cadastro.ts`. Os testes de banco rodam no CI (sem Docker no PC).
>
> **2026-11-06 (T-0085):** `0034_catalogo_referencia_marca_nome` (aditiva): `catalogo.produto_referencia.marca_nome`, retrato **nulo**
> do nome da marca do Promotor (1..120), sem backfill (a migração do Catálogo não lê `promotor.*`), sem índice; vai no pull de
> `produto_referencia`; aparelho continua na v3. Detalhes no [catalogo.md](catalogo.md).
>
> **2026-11-06 (T-0087):** `0035_plataforma_super_admin` (aditiva; ADR 0029): super-admin de plataforma **fora dos tenants**
> (`plataforma.super_admin`, `super_admin_desafio`, `super_admin_sessao`, `auditoria_plataforma` append-only, sem `tenant_id`:
> exceção à regra 5, `TABELAS_SO_POR_FUNCAO`); RLS forçado sem política nem grant para app/worker; 20 funções `plataforma.sa_*`
> SECURITY DEFINER só ao `macuxi_app`; `provisionar_tenant` com `sem_admin`, `parametros` e `ator_id`. Nada vai ao aparelho.
> Detalhes no [plataforma.md](plataforma.md) ("Super-admin de plataforma") e no [rls.md](rls.md).
>
> **2026-11-06 (T-0087 fatia E):** `0036_core_usuario_convite` (aditiva; RN-CORE-31): `core.usuario_convite` (convite de 1º acesso
> por link, só o sha256 do segredo, único por tenant `(tenant_id, token_hash)`, no máximo 1 pendente por usuário, autor `criado_por_id`/`criado_por_tipo` sem FK;
> fora do sync; app sem DELETE; **sem SECURITY DEFINER**: o tenant vem no token), `core.usuario.telefone` e
> `anonimizar_usuario` apagando o telefone e revogando os convites. Detalhes no [core.md](core.md) ("0036").
>
> **2026-11-06 (T-0089):** `0037_forma_prazo_escalonada` (aditiva; RN-VEN-23/24/25): `vendedor.forma_pagamento` e
> `vendedor.prazo_pagamento` (parcelas `int[]` e prazo médio gravado pela API), forma/prazo e retrato do pagamento em
> `vendedor.pedido` (8 colunas juntas ou nenhuma), `core.cliente.prazo_medio_max_dias` e `formas_pagamento` (códigos, sem FK),
> `catalogo.tabela_escalonada` (preço da unidade base, vigência em data civil, tabela opcional) e a forma **"À vista"** semeada em
> todo tenant (backfill + gatilho `tenant_semear_pagamento`). A condição antiga fica como legado. Detalhes no
> [vendedor.md](vendedor.md), [core.md](core.md) e [catalogo.md](catalogo.md) ("0037").
>
> **2026-11-06 (T-0091):** `0038_plataforma_papel_portal` (aditiva; ADR 0029, condição do aceite): papel **`macuxi_portal`**
> (NOLOGIN pela migração, LOGIN pelo `garantirPapelPortal` com `MACUXI_PG_PORTAL_SENHA`; sem grant de tabela, sem filiação), o
> **único** com EXECUTE nas 20 `plataforma.sa_*`; `macuxi_app` e `macuxi_worker` perdem o EXECUTE (42501). `@macuxi/db` exporta
> `PAPEL_PORTAL`, `urlPortal` e `garantirPapelPortal`; o banco dos testes traz `urlPortal` (`banco().urlPortal`). A migração
> sozinha deixa o portal em 42501: vai junto da API com o 2º pool. Detalhes no [plataforma.md](plataforma.md) e no [rls.md](rls.md).
>
> **2026-11-07 (T-0093):** `0039_plataforma_portal_email_senha` (ADR 0031): o portal entra só com e-mail e senha. Tabelas novas
> só por função, sem `tenant_id`: `plataforma.portal_tentativa` (bloqueio por chave HMAC do e-mail), `portal_sessao` e
> `portal_sessao_empresa` (super-admin ou admin do cliente, empresa escolhida na sessão); `auditoria_plataforma` ganha `ator_tipo`
> e `usuario_id`; índice `core.usuario_admin_email_ix`. 12 `sa_*` (EXECUTE só ao `macuxi_portal`), a `criar_super_admin` do deploy
> (sem EXECUTE para app, worker ou portal) e saem as 14 do convite/TOTP/desafio. Vai no mesmo commit do Core e da API.
> Detalhes no [plataforma.md](plataforma.md) ("Portal só com e-mail e senha") e no [rls.md](rls.md).
>
> **2026-11-07 (T-0095):** seção separada "T-0095: guarda de ordem do ERP" no fim da `0039` (up e down): `erp_alterado_em
> timestamptz(3)` nula em `core.cliente`, `core.usuario` e `core.produto` (último `alterado_em` do ERP aplicado; reentrega mais
> antiga é ignorada) e `core.usuario.desligado_no_bko_em timestamptz(3)` nula (o BKO marca ao desativar; a carga do ERP não
> reativa). Aditiva, sem backfill, sem índice, fora do pull. Detalhes no [core.md](core.md); teste `db/testes/erp-ordem.test.ts`.
>
> **2026-11-07 (T-0094):** `0040_core_senha_email_saida` (aditiva, ADR 0032): `core.usuario` ganha o estado da senha
> (`trocar_senha`, `senha_expira_em`, `senha_temporaria_*` do "Esqueci a senha") e a `sessao_versao`; outbox de e-mail
> `plataforma.email_saida` (carga cifrada só no pendente; app só insere e lê; worker marca só a pendente; fora do sync);
> `portal_sessao_empresa.sessao_versao` e as 4 `sa_*` do login do portal leem a versão e o `trocar_senha`; admin inicial nasce
> com `trocar_senha`; anonimização limpa a temporária e a carga; convites pendentes revogados. Vai no mesmo commit do Core
> (fatia C). Detalhes no [core.md](core.md) e no [plataforma.md](plataforma.md) ("Outbox de e-mail").
>
> **2026-11-07 (T-0111/T-0112):** `0041_plataforma_perfis_de_acesso` (em cima da 0040, mesmo lote; ADR 0033): perfis de acesso
> do tenant (`plataforma.perfil`, 7 de fábrica semeados em todo tenant e pelo gatilho do tenant novo), sobreposições por chave
> (`plataforma.perfil_permissao`, vazia = padrão de fábrica do SDK; travas RN-CORE-33, RN-PRO-01 e RN-CORE-04 no banco) e
> multiperfil (`plataforma.usuario_perfil`; todo usuário com o perfil principal de `core.usuario.perfil`, conferido no COMMIT,
> e sempre um admin ativo com a gestão, RN-CORE-35). `perfil_modulo.perfil` vira o código do perfil (FK). Leitura da API:
> `plataforma.perfis_do_usuario(uuid)`. Detalhes no [plataforma.md](plataforma.md) ("Perfis de acesso") e no [rls.md](rls.md).
>
> **2026-11-08 (T-0094, padrão de fábrica da T-0111):** `0042_plataforma_portal_redefinir_senha_admin` (em cima da 0041, mesmo
> lote; só funções): o super-admin redefine pelo portal a senha do admin do cliente. `sa_admins_da_empresa(sid, tenant)` lista os
> admins vivos; `sa_redefinir_senha_admin(sid, tenant, usuario, senha_hash, email, email_id, carga)` grava a temporária de 72 h
> com `trocar_senha` e `sessao_versao + 1`, revoga os refresh, enfileira o e-mail cifrado na `email_saida` na mesma transação e
> audita sem dado pessoal; idempotente por `email_id`. EXECUTE só ao `macuxi_portal` (agora 14 `sa_*`). Detalhes no
> [plataforma.md](plataforma.md) ("Redefinir a senha do admin pelo portal").
>
> **2026-11-08 (T-0114):** `0043_integracao_cancelamento_erp` (em cima da 0042; aditiva, só no schema integracao):
> `conector.aceita_cancelamento` (false) e `pedido_fila_erp.cancelamento_estado|motivo|solicitado_em|enviado_em|tentativas`,
> 4 CHECKs e o índice parcial do poll `pedido_fila_erp_cancelamento_ix`. Detalhes no [integracao.md](integracao.md)
> ("Cancelamento para o ERP (0043)").
>
> **2026-11-08 (T-0106):** `0044_treinamento_xp_referencia` (em cima da 0043; só `treinamento.xp_lancamento`): `referencia_id`
> 1..160 e `xp_lancamento_tenant_id_uk (tenant_id, id)`; a chave natural da 0017 fica total. Detalhes no
> [treinamento.md](treinamento.md) ("Lançamento de XP (0044)").
>
> **2026-11-08 (T-0113, ADR 0034):** `0045_catalogo_marca_concorrente` (em cima da 0044; lote único com o Catálogo e o
> Promotor): `catalogo.marca_concorrente` copiada de `promotor.concorrente` com os mesmos ids (conferida campo a campo), FK
> `produto_referencia_marca_fk` e retrato preenchido; o Promotor perde a FK do produto do concorrente e a escrita no cadastro
> antigo. Detalhes no [catalogo.md](catalogo.md) ("0045 — marcas concorrentes no Catálogo").
>
> **2026-11-08 (D-MP2, T-0094/T-0111):** `0046_plataforma_portal_multiperfil` (em cima da 0045; só funções): o portal decide a
> entrada do admin do cliente pelos perfis (`plataforma.usuario_entra_no_portal`: todos de base admin + `acesso.portal`) nas 4
> `sa_*` do login e da sessão. `0047_plataforma_portal_admin_multiperfil` (em cima da 0046; só funções): o suporte lista
> (`sa_admins_da_empresa`, com a coluna nova `entra_no_portal`) e redefine (`sa_redefinir_senha_admin`) a senha de quem tem
> algum perfil de base admin, mesmo que o principal seja outro (`plataforma.usuario_tem_perfil_admin`). Continuam 14 `sa_*`.
> Detalhes no [plataforma.md](plataforma.md) ("Portal e multiperfil" e "Resgate da senha do admin pelos perfis").
>
> **2026-11-08 (T-0114):** `0048_integracao_cancelamento_recusado` (em cima da 0047; aditiva, só `integracao.pedido_fila_erp`):
> `cancelamento_recusado_em` e `cancelamento_recusa_motivo` (1..300), estado `recusado` nos CHECKs (a recusa fica de histórico no
> `confirmado`) e o índice parcial do monitor `pedido_fila_erp_cancelamento_recusado_ix`. Detalhes no [integracao.md](integracao.md)
> ("Cancelamento recusado pelo ERP (0048)").
>
> **2026-11-08 (defeito R-20261108-130423-testes, T-0093/T-0094):** `0049_plataforma_conferencias_no_commit_definer` (em cima da
> 0048; só `ALTER FUNCTION`): as 4 funções dos gatilhos adiáveis da 0041 viram `SECURITY DEFINER` (search_path fixo, EXECUTE só do
> dono). Criar empresa com o admin pelo portal dava 500 no COMMIT (a conferência rodava como `macuxi_portal`). Detalhes no
> [plataforma.md](plataforma.md) ("0049 — conferências do COMMIT como dono").
>
> **2026-11-08 (T-0054, RN-VEN-37):** `0050_vendedor_pedido_devolucao` (em cima da 0049; aditiva, 1 tabela nova):
> `vendedor.pedido_devolucao`, uma linha viva por nota de devolução do ERP (único parcial por `external_id`, soft delete por
> update), FK composta para o pedido, fora do sync; o devolvido é a soma das linhas vivas. Detalhes no [vendedor.md](vendedor.md)
> ("0050 — devolução do pedido").
>
> **2026-11-08 (RD-0014, T-0111):** `0051_plataforma_perfil_assistente` (em cima da 0050; função e dados): o perfil de fábrica do
> assistente se chama "Assistente" (semeadura do tenant novo e os tenants que ainda tinham "Assistente de BKO"). Detalhes no
> [plataforma.md](plataforma.md) ("0051 — nome do perfil Assistente").
>
> **2026-11-09 (T-0122 N5):** `0052_plataforma_tenant_por_codigo_minimo` (em cima da 0051; funções e 2 CHECKs):
> `tenant_por_codigo` só com (id, status) antes da senha, `tenant_da_sessao()` para o nome e o fuso depois, CHECKs de evento sem
> hífen (= `EVENTO_RE`). **Só com o Core no mesmo lote.** Detalhes no [plataforma.md](plataforma.md) ("0052 — login sem nome do tenant").
>
> **2026-11-09 (T-0115, RN-PES-05):** `0053_core_cliente_canal` (em cima da 0052; aditiva, só `core.cliente`): coluna `canal`
> (1..60, nula) e índice parcial `cliente_canal_ix`. Detalhes no [core.md](core.md) ("0053 — canal do cliente").
>
> **2026-11-09 (T-0115, RN-PES-05):** `0054_integracao_mapeamento_canal` (em cima da 0053; só `integracao.mapeamento`): CHECK
> `mapeamento_tipo_valido` com `canal`; `vw_macuxi_cliente` com a coluna `canal`. Detalhes no [integracao.md](integracao.md).
>
> **2026-11-10 (T-0149, RN-CORE-39, ADR 0040):** `0056_core_filial` (em cima da 0055; aditiva): `core.filial` (padrão `0001`
> semeada pelo gatilho `tenant_semear_filial` e nos tenants existentes), `filial_id` NOT NULL em `core.cliente` (FK),
> `catalogo.deposito` e `catalogo.tabela_preco_item` (sem FK; nulo vira a padrão por gatilho), `filial_id` nulo (= todas) em
> `catalogo.tabela_escalonada`, `filial_id` + retrato `filial` em `vendedor.pedido` e a entidade `filial` no Hub. Views do
> Conector com `vw_macuxi_filial` e `filial_external_id`; modelo da entrada de pedidos com a filial. Detalhes no
> [core.md](core.md), [catalogo.md](catalogo.md), [vendedor.md](vendedor.md) e [integracao.md](integracao.md).
>
> **2026-11-10 (T-0147, RN-CORE-38, ADR 0041):** `0057_core_foto_pdv` (em cima da 0056; aditiva): `core.foto_tipo` ("Fachada"
> semeada pelo gatilho `tenant_semear_foto_tipo`), `core.cliente_foto`, `core.cliente.inativado_em` (relógio da retenção) e
> `plataforma.arquivo.perfis_leitura`. Detalhes no [core.md](core.md), [plataforma.md](plataforma.md) e [lgpd.md](lgpd.md).
>
> **2026-11-10 (T-0158, ADR 0043):** `0058_plataforma_diagnostico` (em cima da 0057; aditiva): `plataforma.diagnostico`
> (diagnóstico do aparelho, só dado técnico; protocolo global da sequência `plataforma.diagnostico_protocolo_seq`; app só
> insere e lê o próprio tenant, worker só marca `alerta_*`), `sa_listar_diagnosticos` e `sa_diagnostico` (portal, só
> super-admin; 16 `sa_*` no portal) e `expurgar_diagnosticos` (worker, 90 dias com o print). Detalhes no
> [plataforma.md](plataforma.md), [rls.md](rls.md) e [lgpd.md](lgpd.md).
>
> **2026-11-11 (T-0095):** `0062_core_catalogo_erp_ordem` (em cima da 0061; aditiva): `erp_alterado_em timestamptz(3)` nula em
> `core.cliente_endereco`, `produto_unidade`, `titulo`, `nota_erp`, `rota`, `filial` e `catalogo.tabela_preco_item`,
> `estoque_saldo`, `cliente_tabela_preco`; `desligado_no_bko_em` em `core.filial` e `catalogo.tabela_preco`. Gatilhos
> `<tabela>_versao_erp` (versão do ERP mais antiga não grava, nas 12 tabelas com a coluna) e `<tabela>_desligado_no_bko` (a carga
> não reativa o que o BKO desligou: usuario, filial, tabela_preco), funções `plataforma.manter_versao_erp` e
> `plataforma.manter_desligado_no_bko`, 5 índices `<tabela>_erp_versao_ix`. Detalhes no [core.md](core.md) e no
> [catalogo.md](catalogo.md); teste `db/testes/erp-ordem.test.ts`.
>
> **2026-11-12 (T-0168, RN-VEN-11a):** `0063_core_usuario_limite_desconto` (em cima da 0062; aditiva): `core.usuario` ganha
> `desconto_limita_item` (padrão true), `desconto_limita_pedido` (padrão false) e `desconto_maximo_pedido_permil` (‰, 0..1000,
> nulo) com os CHECKs `usuario_desconto_pedido_permil_faixa` e `usuario_desconto_pedido_com_limite`. Usuários antigos ficam com o
> padrão. Detalhes no [core.md](core.md); teste `db/testes/usuario-limite-desconto.db.test.ts`.
>
> **2026-11-14 (decisões do dono do produto, R-20261114-153500, R-20261114-153800 e R-20261114-154000):**
> `0069_core_cargo_hierarquia` (em cima da 0068): `plataforma.perfil.cargo` NOT NULL sem padrão (`vendedor`, `promotor`,
> `supervisor`, `gerente`, `administrativo`; mapeamento `plataforma.cargo_da_base`, promotor → promotor); **promotor com
> gerente obrigatório e supervisor opcional** (gatilhos adiados `promotor_sem_gerente` e `promotor_gerente_do_supervisor`, hint
> RN-CORE-56, em gravações novas ou alteradas do promotor com equipe; sem equipe = domain/API do Core; função de gatilho
> SECURITY DEFINER, como a 0049, para o COMMIT do portal); **um perfil vivo por usuário** (exclusão adiada
> `usuario_perfil_um_vivo`; quem tinha vários fica com o de nível mais alto); hierarquia pela árvore `core.equipe` com a view
> `core.v_usuario_hierarquia`; código ERP = `core.usuario.external_id` (já único por tenant). Detalhes no
> [plataforma.md](plataforma.md) e no [core.md](core.md); teste `db/testes/cargo-hierarquia.db.test.ts`; diagnóstico
> `db/scripts/diagnostico-0069.sql`.
>
> **2026-11-14 (ADR 0047, planos e licenças; portal config. enxuto, R-20261114-170600 e R-20261114-181000):**
> `0070_plataforma_plano_assinatura` (em cima da 0069; aditiva): `plataforma.plano` (catálogo da plataforma, sem `tenant_id`, só
> por função) e `plataforma.assinatura` (uma viva por tenant, RLS por tenant, o app só lê), e a
> `plataforma.sa_gravar_assinatura(p_sid uuid, p_tenant uuid, p jsonb)` (só super-admin; o portal passa a 17 `sa_*`).
> `0071_plataforma_listar_tenants_plano`: a `sa_listar_tenants` ganha `plano`, `teste_ate` e `paga` em cada empresa. Detalhes no
> [plataforma.md](plataforma.md); teste `db/testes/plano-assinatura.db.test.ts`.
>
> **2026-11-15 (ADR 0052, inativar, backup e excluir a empresa no portal):**
> `0072_plataforma_empresa_acoes` (em cima da 0071): `plataforma.tenant` ganha `inativada_em` e `motivo_inativacao` (inativa =
> `suspenso`); `backup_empresa`, `backup_empresa_parte`, `exclusao_empresa` e `empresa_excluida` (sem `tenant_id`, sobrevivem à
> exclusão, só por função); 8 `sa_*` do portal (25 no total) e as funções do worker (backup por keyset, exclusão em 2 etapas,
> retenção); código da licença nunca reaproveitado (gatilho e sorteio); despachante e e-mail pulam a empresa inativa (políticas
> do worker). Detalhes no [plataforma.md](plataforma.md); teste `db/testes/empresa-acoes.db.test.ts`.
>
> **2026-11-15 (ADR 0054, pacote pronto da primeira carga):** `0074_plataforma_sync_pacote` (em cima da 0073; aditiva):
> `plataforma.sync_pacote` (um `.sqlite.gz` por tenant, módulo e partição; um só pronto vivo por partição; chave do arquivo com o
> tenant da linha) e `plataforma.sync_pacote_pedido` (pedido de geração idempotente por partição), fora do sync; app lê e pede,
> worker gera; índice `catalogo.tabela_preco_item_filial_sync_ix (tenant_id, filial_id, updated_at, id)`. Detalhes no
> [sync-pacote.md](sync-pacote.md); teste `db/testes/sync-pacote.db.test.ts`.
>
> **2026-11-15 (decisão do dono do produto, R-20261115-073000-alexandre, item 3):** `0075_catalogo_referencia_marca_opcional`:
> `catalogo.produto_referencia.marca_id` aceita nulo (referência só com o código) e o único vivo passa a ser
> `produto_referencia_produto_codigo_uk (tenant_id, produto_id, codigo_compacto)`; as vivas que repetiam o código no produto ficam
> só na de menor ordem. Detalhes no [catalogo.md](catalogo.md); teste `db/testes/referencia-marca-opcional.db.test.ts`.
>
> **2026-11-15 (T-0176, R-20261115-093000 e R-20261115-094500):** `0077_core_usuario_filial` (0070–0073 no main; 0074–0076 de outros lotes):
> `core.usuario.filial_cadastro_id` (nula = bloqueado) e `core.usuario_filial` (filiais de venda); a de cadastro está entre as
> de venda (gatilho adiado `usuario_filial_inclui_cadastro`, 23514, hint RN-CORE-39). Backfill: na empresa com uma filial viva,
> todo usuário vivo recebe a filial (cadastro e venda); os demais ficam bloqueados. A `provisionar_tenant` (CLI, seeds e portal)
> cria o admin inicial com a filial padrão (cadastro e venda). Detalhes no [core.md](core.md); teste `db/testes/usuario-filial.db.test.ts`.
>
> **2026-11-15 (T-0174, RN-CAT-14, ADR 0058; R-20261115-074500):** `0079_catalogo_foto_lote` (número 0079, correção da sessão principal em 15/11):
> `plataforma.arquivo` aceita PNG, WEBP (imagens até 8 MiB) e ZIP (até 500 MiB); `plataforma.trabalho` com
> `trabalho_reservar`/`trabalho_devolver`/`trabalho_renovar` (só ao worker); `catalogo.foto_lote` (idempotência pelo SHA-256 do
> ZIP) e `catalogo.foto_lote_item` (checkpoint por índice); `catalogo.produto_midia.hash_conteudo` (repetido) e a principal
> sempre na ordem 1 (dados antigos sem andar o `updated_at`); `core.produto_sku_lower_ix`. Detalhes no [catalogo.md](catalogo.md)
> e no [plataforma.md](plataforma.md); teste `db/testes/foto-lote.db.test.ts`.
>
> **2026-11-15 (ADR 0047, planos e licenças, telas 2 a 6 do portal; R-20261115-123000, item 1):**
> `0086_plataforma_planos_troca_licencas` (em cima da 0085; aditiva): os 4 planos de venda no
> catálogo (Light, PME, Enterprise e Corporate, números do §11.3 da spec do portal); `plataforma.assinatura_historico` (uma linha
> por troca, idempotente por `pedido_id`); 3 `sa_*` do portal (`sa_listar_planos`, `sa_assinatura_da_empresa` e
> `sa_trocar_plano`); a trava do cadastro de usuários `plataforma.licencas_do_tenant()`; o app passa a ler o plano do
> próprio tenant. Detalhes no [plataforma.md](plataforma.md);
> teste `db/testes/planos-troca-licencas.db.test.ts`.
>
> **2026-11-21 (RN-CAT-18, RF-CAT-04, R-20261120-235317-alexandre; v1.0.19):** `0092_catalogo_no_codigo_por_pai` (em cima da
> 0091; só índice): o código do nó da árvore passa a ser único entre os irmãos (`catalogo_no_pai_codigo_uk`) no lugar de
> único no tenant (`catalogo_no_codigo_uk`, 0013). Detalhes no [catalogo.md](catalogo.md) ("0092"); teste `db/testes/catalogo-no-codigo-por-pai.db.test.ts`.
>
> **2026-11-21 (T-0191, RN-CORE-75 a 77):** `0093_core_usuario_base_cliente_geocodificacao` (aditiva, em cima da 0092):
> `core.usuario` ganha a casa (`casa_*`) e a base (`base_tipo`, `base_*`, `base_alterada_em`); `core.cliente` ganha
> `coordenada_origem`, `coordenada_precisao`, `geocodificacao_tentada_em` e `geocodificacao_chave` (backfill `'erp'`), e o
> `macuxi_leitura` passa a SELECT por coluna nela. Detalhes no [core.md](core.md) ("0093"); teste
> `db/testes/usuario-base-cliente-geocodificacao.db.test.ts`.
>
> **2026-11-22 (integração por ERP, F2; desenho aprovado em R-20261122-005500):** `0094_integracao_busca_erp` (aditiva, em
> cima da 0093; número provisório): 5 tabelas no schema `integracao` — `conector_api` (busca na API do ERP, frequência por
> entidade com piso de 15 min por CHECK), `credencial_erp` (segredo cifrado, uma viva por Conector, **sem** `macuxi_leitura`,
> worker e portal), `implantacao`, `implantacao_dia` (assistente e painel dos 30 dias) e `coleta_execucao`. Detalhes no
> [integracao.md](integracao.md) ("0094"); teste `db/testes/integracao-busca-erp.db.test.ts`.

## Windows: subir, derrubar e recriar o banco de teste (5 passos)
1. **Abra o Docker Desktop** e espere "Engine running". No Git Bash, se `docker` não for encontrado:
   `export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"` (no PowerShell:
   `$env:Path += ";C:\Program Files\Docker\Docker\resources\bin"`). O CLI e os testes acham esse
   caminho sozinhos; o PATH só importa para usar `docker` à mão.
2. **Subir** (baixa `pgvector/pgvector:pg16` na 1ª vez, cria o banco `macuxi` e migra):
   `pnpm --filter @macuxi/db banco subir` → `[banco] pronto: localhost:5432/macuxi`.
3. **Carregar dados**: `pnpm --filter @macuxi/db banco seed fase-m` e/ou
   `pnpm --filter @macuxi/db banco fixture dois-tenants` (idempotentes; `banco status` confere).
4. **Testar**: `pnpm --filter @macuxi/db test` (ou `pnpm test` na raiz). Cada execução cria e apaga um
   banco efêmero `macuxi_teste_*` no **Postgres dos testes** (abaixo), nunca no da demo; se o container dele
   estiver parado e o Docker aberto, o teste o sobe sozinho.
5. **Derrubar ou recriar**: `banco derrubar` (para o container, mantém o volume),
   `banco derrubar --limpar` (apaga também o volume) ou `banco recriar` (apaga volume e sobe do zero,
   migrado e vazio). Bancos de teste esquecidos por execução interrompida: `banco apagar-teste --todos`
   (no Postgres dos testes) ou `pnpm --filter @macuxi/db limpar-testes [-- --apagar]` (sobras no da demo, abaixo).

### Dois Postgres locais: demo × testes (02/11)
A carga dos testes derrubou duas vezes o Postgres da demo (crash recovery com fsync de ~190 bancos de teste
esquecidos). Desde então são **dois serviços** no `db/docker-compose.yml`:

| Serviço | Container | Porta | Dados | Quem usa |
|---|---|---|---|---|
| `postgres` | `macuxi-postgres` | 5432 (`MACUXI_PG_PORTA`) | volume `macuxi-pgdata`, durável | demo, `subir-demo`, API/worker locais, `banco subir/migrar/seed` |
| `postgres-testes` | `macuxi-postgres-testes` | 5434 (`MACUXI_PG_TESTES_PORTA`) | **tmpfs** (4 GB), `fsync`/`synchronous_commit`/`full_page_writes` **off** | `globalSetup`, `criarBancoDeTeste`, `banco criar-teste/apagar-teste`, `medir-sync` |

- `banco subir` sobe **só** o `postgres`; `banco subir-testes` (ou o próprio `globalSetup`) sobe só o `postgres-testes`.
  O dos testes não tem `restart`: um reinício do Docker o deixa parado até o próximo teste. Queda = zero recuperação
  (tmpfs, nada a fazer fsync); os bancos de teste somem junto — são efêmeros.
- Endereço dos testes (`lerConfigTestes` em `db/src/config.ts`), nesta ordem:
  1. `MACUXI_PG_TESTES_URL=postgres://usuario:senha@host:porta` (explícito);
  2. `MACUXI_PG_HOST` ou `MACUXI_PG_PORTA` definidos no ambiente → o mesmo servidor de `lerConfig` (é o caso do **CI**,
     cujo workflow define os dois para o service container na 5432; e do `varrer-relogio`, com porta 1);
  3. padrão: `localhost:5434` (`MACUXI_PG_TESTES_PORTA`).
  Atenção: quem põe `MACUXI_PG_PORTA` no `.env` local (ex.: 5433 por porta ocupada) volta a testar no servidor da demo;
  nesse caso defina também `MACUXI_PG_TESTES_URL`.
- **Limpeza de sobras de teste** (`node db/scripts/limpar-bancos-teste.mjs`, padrão **5434**, o Postgres dos testes;
  a demo só com `--porta 5432` explícito): sem opção só **lista**; com `--apagar` apaga um por vez. Só sai banco
  com nome no padrão exato de quem cria banco de teste (`macuxi_teste_<base36>_<pid>_<hex6>`, de `criarBancoDeTeste`,
  e `macuxi_conector_teste_<base36>_<hex6>`, do teste do Conector), **sem conexão** em `pg_stat_activity` e **criado há
  mais de 2 h** (`--idade-min-horas H`; idade = a data mais nova entre o `Date.now()` do nome e o `PG_VERSION` do banco).
  Pode rodar com outra rodada de testes em andamento. Nunca `macuxi` (`MACUXI_PG_BANCO`), `postgres` nem `template*`;
  `--forcar` derruba conexões (não ignora a idade). Mostra o espaço liberado. Só host local. Node puro + `pg` (sem tsx).
  04/11: 58 órfãos apagados na 5434 (1.024,5 MB; tmpfs de 1.151 para 138 MB).

Porta ocupada (outro Postgres em 5432)? Defina `MACUXI_PG_PORTA=5433` no `.env` da raiz: o compose e
o CLI usam a mesma variável.

## Pré-requisitos
- Docker Desktop instalado e aberto (`docker version` responde).
- Node >= 24.7 para os seeds/fixtures (usam `crypto.argon2Sync` nativo para o hash argon2id).
- `db` registrado no `pnpm-workspace.yaml` e `pnpm install` rodado (traz `pg`, `drizzle-orm`, `drizzle-kit`).
- Opcional: copiar `db/.env.example` para `db/.env` (ou para a `.env` da raiz). Sem `.env`, valem os
  padrões locais (porta 5432 só em `127.0.0.1`, admin `postgres`/`postgres`, banco `macuxi`, papel `macuxi_app`).

## Base de demo
Base para a demonstração com o gestor externo (app novo + API real; R-20261031-233442, item 1). Seed em
`db/seeds/demo/demo.ts`, teste em `db/testes/seed-demo.test.ts`. O `scripts/demo/subir-demo.ps1` (engenheiro) chama o comando abaixo.

| O quê | Comando (na raiz) |
|---|---|
| Carregar ou atualizar (preserva o que o app gravou no ensaio) | `pnpm --filter @macuxi/db banco seed demo` |
| **Recarregar do zero** (apaga TODAS as linhas do tenant demo, inclusive visitas, pedidos e sessões do ensaio) | `pnpm --filter @macuxi/db banco seed demo --recriar` |
| Fixar o "hoje" (ensaio de outro dia) | `... banco seed demo --hoje AAAA-MM-DD` |
| Banco de teste efêmero com a base | `... banco criar-teste --fixture demo` |

Pré-requisito: banco migrado até a `0050` (`banco subir` ou `banco migrar up`); sem isso o seed para com
`rode "banco migrar up" antes`. Só roda no Postgres local (mesma trava do seed da Fase M: `exigirBancoLocal`).

**Login no app** — código da empresa **`demo`** · senha de todos **`demo-macuxi`** (ou o valor de `MACUXI_SENHA_DEMO` no
`.env`, que tem precedência). A senha só existe como hash argon2id; o CLI imprime os e-mails, nunca a senha.

| Perfil | E-mail | Nome (fictício) | O que vê |
|---|---|---|---|
| vendedor | `vendedor@exemplo.com.br` | Lucas Andrade | 18 clientes; **rota de hoje com 6 paradas** (a 1ª é cliente do Atacado); 8 pedidos (1 aguardando a supervisora, 1 rejeitado, 1 cancelado, 2 faturados: o p01 e o p02, este com devolução parcial); recado do supervisor |
| vendedor | `vendedor2@exemplo.com.br` | Camila Freitas | 12 clientes; rota de hoje com 4 paradas; 3 pedidos (1 faturado parcial: o p08) |
| supervisor | `supervisor@exemplo.com.br` | Renata Barros | responsável pela "Equipe Manaus": carteira dos dois vendedores e do promotor (30 clientes), metas e indicadores, 2 pedidos para aprovar no nível dela (11 pedidos da equipe, 3 aguardando aprovação) |
| gerente | `gerente@exemplo.com.br` | Marcelo Tavares | responsável pela "Regional Norte", pai da "Equipe Manaus" (vê a equipe da supervisora, RN-CORE-04); 1 pedido para aprovar no nível dele (12%); app Gestão |
| promotor | `promotor@exemplo.com.br` | Joana Prado | 7 supermercados/lojas na carteira de promotor; rota de hoje com 4 paradas; sem módulo Vendedor (RN-PRO-01) |
| analista | `analista@exemplo.com.br` | Paulo Ribeiro | tenant inteiro (BKO) |
| admin | `admin@exemplo.com.br` | Sérgio Moura | tenant inteiro (BKO) |

Conteúdo (tenant `dd000000-0000-4000-8000-000000000001`, "Distribuidora Exemplo", fuso America/Manaus, plano `demonstracao`):
- **Módulos licenciados:** core, catalogo, vendedor, promotor (`plataforma.tenant_modulo`) e módulos por perfil em
  `plataforma.perfil_modulo` (vendedor: core/catalogo/vendedor; promotor: core/catalogo/promotor; supervisor, analista e
  admin: os quatro). **Gestor (T-0055):** licenciado pelo seed próprio `db/seeds/demo/gestor.ts` (`carregarDemoGestor`,
  chamado dentro de `carregarDemo`): `gestor` no tenant e para supervisor, gerente, analista e admin, mais a projeção do
  Gestor montada pelo domain com os dados da demo (painel, ranking, fila de aprovação e alertas coerentes). Ver
  [gestor.md](gestor.md) §4. Enquanto a linha que chama `carregarDemoGestor` não estiver em `demo.ts`, o Gestor fica sem
  licença na demo.
  **Integração ERP (T-0051):** seed próprio `db/seeds/demo/integracao.ts` (`gravarDemoIntegracao`, dentro de `carregarDemo`):
  `integracao` no tenant e para admin e analista (sem perfis de campo); Conectores "ERP Matriz" (`erp-matriz`, recebe pedidos,
  1.2.1, sinal 2 min antes do seed) e "ERP Filial Itacoatiara" (`erp-filial`, sem pedidos, sinal 3 h antes = alerta de sem
  sinal), **sem credencial** (nenhum autentica no Hub); política 1.2.1; 5 lotes (produto e título concluídos, cliente completo
  concluído, preço com 2 erros de linha sem payload, estoque que falhou) e 1 inativação de cliente **aguardando** (3 de 30,
  limite 5%, validade de 7 dias). Tudo relativo ao `now()` do banco no seed: **rode o seed de novo (sem `--recriar`) antes da
  demonstração** para o sinal da matriz voltar a "agora". Inativação já decidida no ensaio não volta a aguardar. **Fila do ERP
  (T-0155):** os 3 pedidos faturados em `integracao.pedido_fila_erp` (entregues ao ERP Matriz, `faturado_total`/`faturado_parcial`)
  com a trilha `integracao.pedido_retorno` (integrado + faturado), montados pelas funções do Hub (`dadosFilaErpDemo`); o de-para
  da condição vai só no payload (`DE_PARA_CONDICAO_DEMO`), sem linha em `integracao.mapeamento`.
- **30 clientes** de distribuição de alimentos em 30 bairros de Manaus (logradouro, número, CEP, coordenadas), contato
  principal com telefone fictício (prefixos não atribuídos: fixo `92 3000-0xxx`, celular `92 9 0000-xxxx`), financeiro,
  3 títulos por cliente (**8 com título vencido**, 1 bloqueado por atraso: Mercearia do Porto; até a T-0071 era o Mini Box Japiim, hoje o cliente da referência do novo pedido) e 12 meses de histórico.
- **Rota de hoje** no fuso do tenant, calculada na hora do seed (vendedor 6 paradas, vendedor2 4, promotor 4), sem visita:
  a demo faz os check-ins ao vivo. Raio de check-in 200 m (padrão): longe do cliente, o app pede justificativa de
  fora do raio (motivos extras `gps_impreciso` e `endereco_desatualizado`).
- **Pedidos** (T-0029) dos últimos dias úteis, **recalculados pela tabela do cliente com a regra do servidor** (`revalidarPedido`
  do Vendedor), com número `000001`..`000011` (o próximo, 000012, é o do orçamento da referência), retratos e linha do tempo (`vendedor.pedido_evento`): 7 aprovados dentro da
  alçada (automático), 2 aguardando o **supervisor** (Lucas 8%, Camila 7%), 1 aguardando o **gerente** (Camila 12%),
  1 **rejeitado** pela supervisora (com motivo) e 1 **cancelado** depois de aprovado. **T-0155** (R-20261109-202200): 3 dos aprovados
  já passaram pelo ERP (`FATURAMENTOS_DEMO`): **p01** (Lucas) Faturado, **p08** (Camila) Faturado parcial (a Farinha pela metade) e
  **p02** (Lucas) Faturado com **devolução parcial** (6 dos 24 leites, `vendedor.pedido_devolucao`); linha do tempo com Enviado ao
  ERP, Integrado e Faturado (autor "ERP"), número do ERP, nota em `vendedor.pedido_faturamento`, `total_faturado_cents` e
  `quantidade_faturada` pelas funções do consumidor do retorno do Vendedor. Os outros 4 aprovados seguem sem ir ao ERP. Com
  itens e a visita que os gerou; visitas sem pedido com motivo; `core.indicador_diario` coerente com os pedidos.
- **Metas do mês corrente** (venda, positivação, cobertura, visitas) dos vendedores e do promotor, todas com `tipo = 'pedido'`
  (0019, RN-CORE-21; a base é o pedido aprovado: o faturado parcial conta o total e a meta não muda com a T-0155) — BKO de metas da T-0068. **Metas do mês anterior** de Lucas e Camila
  (mesmos 4 indicadores e tipo, valores um pouco menores) para o "copiar do mês anterior" da T-0068; o Gestor as projeta por
  `usuário|mês` (o painel do mês corrente não muda). Na recarga `-Manter`, meta viva do ensaio no mesmo (usuário, período,
  indicador) com outro id é mantida e o seed pula a dele (sem violar `meta_uk`). **Hierarquia** (BKO de usuários da T-0067): a
  Equipe Manaus (Lucas, Camila, Joana e Renata) tem a Renata como responsável e a Regional Norte (Marcelo) como pai: supervisor
  e gerente de cada usuário saem de `core.equipe`. **Medidas** (0018): UN, CX, FD, LT e BD ativas, as outras 6 da lista inicial
  inativas, e a caixa de embarque como embalagem do produto (`gravarDemoMedidas`); 36 produtos com marcas
  fictícias (24 de mercearia/limpeza/higiene + 9 da linha automotiva e o detergente 5 L, 0013; + filtro de papel, leite em pó e água 1,5 L, T-0071); 3 notificações (recado do supervisor ao vendedor, pedidos para aprovar à supervisora e ao gerente).
- Parâmetros: os padrões do Core semeados pelo gatilho (`checkin.raio_m`, `metas.base_apuracao`) e as **alçadas do Vendedor**
  `alcada.vendedor_pct = 5`, `alcada.supervisor_pct = 10`, `alcada.gerente_pct = 15`, `alcada.acima_gerente = "analista"`.
- **Preço** (schema `catalogo`, [catalogo.md](catalogo.md)): tabelas "Varejo" (todos os 36 produtos) e "Atacado" (≈ 7% menor,
  **sem** açaí `ACA-1K`, suco `SUC-1L` e creme dental `CRD-90` → "Sem preço para este cliente", RN-CAT-06); supermercados e
  atacarejos no Atacado, os demais no Varejo; vigência desde o 1º dia do mês anterior.
- **0013** ([core.md](core.md), [catalogo.md](catalogo.md), [vendedor.md](vendedor.md)): **CNPJ fictício gerado (dígito
  verificador correto) e IE em todos os clientes** (Panificadora Pão Dourado ISENTO); o **Atacado Boto Rosa sem CEP**
  (`cadastro_incompleto`, falta `cep`: pedido dele só como orçamento, RN-VEN-13); pedidos com o CNPJ no retrato (o
  `000010` abre no BKO), frete (FOB com transportadora em 4 clientes, CIF no resto; sem valor de frete, R-20261102-105040) e endereço de entrega
  principal; custo com margem de 20% a 40%, desconto máximo próprio em `OLE-4T-1L` 25%, `VEL-150` 5% e `DET-5L` 10%
  (padrão 15% sem linha de parâmetro); UN e CX em 10 produtos (CX = UN × fator; o preço próprio da CX ligado na T-0071 foi desligado na T-0089, RN-VEN-15); árvore do catálogo de 3 e 4 níveis (raiz com 4 categorias; Freios, Filtros e Suspensão em Automotivo, T-0142); conteúdo, atributos,
  sinônimos e documento de busca ("óleo para moto 150 cilindradas" acha `OLE-4T-1L`); 2 depósitos com rupturas e
  saldos baixos; 2 transportadoras; endereço de entrega extra em 5 clientes.
- **Condições de pagamento** ([vendedor.md](vendedor.md)): À vista (padrão), 28 dias, 28/56 e 30/60/90; os 8 clientes com título
  vencido só À vista e 28 dias (RN-VEN-14); os demais 3 ou 4.
- **Roteiro do ensaio** que a base permite: o Lucas tira pedido de 3% (aprova sozinho), de 8% (vai à Renata) e de 12% (vai
  ao Marcelo), e no Supermercado Bom Preço (Atacado) o açaí aparece sem preço. Os números do ensaio seguem o contador
  (depois do maior número da base); recarregar a base, com ou sem `--recriar`, nunca volta o contador.
- **Número do pedido na recarga** (T-0026, R-20261104-163228; `numerarPedidosDemo` em `db/seeds/demo/demo.ts`): número já
  emitido não volta nem muda de dono. Pedido do ensaio guarda o número; pedido do seed que já tinha número (no banco ou antes
  do `--recriar`) guarda o dele; pedido novo do seed só usa o número da base nova (000001…) se estiver acima do maior já
  emitido (contador e maior número gravado, lidos antes do `--recriar`), senão ganha o próximo do contador. Repetido de
  verdade (só sem o único `pedido_numero_uk`): o mais antigo fica, os outros ganham número novo, e o `seed demo` imprime
  `número do pedido <id> (seed|aparelho): de -> para`. A linha do contador fica travada durante a carga. Roteiro e teste
  só podem contar com o número de um pedido específico do seed (ex.: 000010 no S6 e no M-D19) em **base nova**; numa base
  já usada o número fica com quem o recebeu primeiro. Na VM nada muda no deploy comum: só no `demo — recriar base demo`.
  Com a API no ar, o `--recriar` pode dar `deadlock detected` contra um pedido que converte orçamento do seed (ordens de
  trava opostas: pedido → contador × contador → pedido); tudo volta no rollback e basta rodar o workflow de novo.
- **Limitação no começo do mês** (R-20261101-045314, O-2): pedidos, visitas e `core.indicador_diario` da base são dos dias
  úteis ANTERIORES ao "hoje". Até o 1º dia útil depois do dia 1º, eles caem todos no mês anterior e Metas (app) e
  Indicadores (BKO) do mês mostram 0%. Para o ensaio nesses dias, rode o ensaio a partir do 2º dia útil do mês ou mostre
  os painéis do mês anterior; puxar parte do histórico para o mês corrente fica como melhoria da base (pendência
  registrada na entrega da T-0029).

Idempotência: upsert por id determinístico. Rodar de novo no mesmo dia não muda nada (nem o hash da senha, que só é
refeito se não conferir com a senha informada); zera `tentativas_falhas`/`bloqueio_ate` (ninguém fica travado por senha
errada no ensaio). Em outro dia entra a rota do novo dia (as anteriores ficam como histórico, com paradas não
visitadas) e as datas relativas andam; para a demo, prefira `--recriar`. `--recriar` marca o tenant demo como
`encerrado` e chama `plataforma.excluir_tenant` (0032: ordem de FK, sem `session_replication_role`, gatilhos ligados) na
mesma transação da carga; apaga apenas `tenant_id = demo` e roda também sem superusuário (política `manutencao` da 0031).
O teste confere que nenhuma linha de outro tenant muda e que, pelo `macuxi_app`, os tenants não se enxergam.

## Banco que não é o local (homologação, nuvem)
Os padrões acima são **públicos** e valem só para o Postgres local: host `localhost`, `127.0.0.1`, `::1` ou
`macuxi-postgres` (lista `HOSTS_LOCAIS` em `db/src/config.ts`, a mesma do `global-setup`) **e** `NODE_ENV`
diferente de `production`. Fora disso:
- `lerConfig` **falha** se faltar `MACUXI_PG_ADMIN_SENHA` ou `MACUXI_PG_APP_SENHA` (ou se vierem com a senha
  pública local), com a mensagem `[db] Banco fora do ambiente local (...): defina ... no .env`. Assim
  `banco papeis`/`migrar`/`criar-teste` nunca gravam a senha pública no papel `macuxi_app`;
  `garantirPapelApp` ainda recusa a senha pública se o cliente não estiver num host local (segunda trava).
- `banco seed fase-m` (`carregarFaseM`: senha `demo-macuxi` e usuários fictícios) **recusa** rodar.
- `banco seed demo` (`carregarDemo` e os seeds de módulo em `db/seeds/demo/`) recusa, **salvo com `MACUXI_AMBIENTE=demo`**
  (valor exato; `exigirBancoDemo`): é a permissão explícita do servidor da demo (VM da Magalu, ADR 0020 §5), que vale
  também com `NODE_ENV=production`. Ela não libera a senha pública dos papéis, o seed da Fase M nem a fixture dos testes.
  Na VM, a senha dos logins da demo é `MACUXI_SENHA_DEMO`, se definida, ou a padrão da seção "Base de demo".
- **API e worker usam `lerConfigApp`**: fora do local, exige só `MACUXI_PG_APP_SENHA` (e `MACUXI_PG_WORKER_SENHA` para o
  worker; `MACUXI_PG_PORTAL_SENHA`, opcional, para o 2º pool da API do portal do super-admin, 0038, `urlPortal`); `MACUXI_PG_ADMIN_SENHA` é opcional e, sem ela, `urlAdmin` lança. Migrações, papéis e seeds seguem com
  `lerConfig` (admin obrigatório).
- `garantirPapel` (papéis `macuxi_app`/`macuxi_worker`) desliga o log de comando na própria transação
  (`log_min_duration_statement=-1`, `log_statement=none`, só se o admin for superusuário): a senha do `ALTER ROLE` não
  cai no log do servidor.
- Backup do servidor da demo: [db/backup/LEIA-ME.md](../../db/backup/LEIA-ME.md). Faz `pg_dump` diário para
  `backups/` no bucket, com 7 dias de retenção e restauração testada em `db/testes/backup.test.ts`.
- Segredos só no `.env` (CLAUDE.md regra 8). Testes: `db/testes/ambiente-local.test.ts`.

## Logs do Postgres
O compose local liga `log_min_duration_statement=300` (consultas lentas para EXPLAIN), que registra também os
parâmetros da consulta (aqui só dados fictícios). Em nuvem, para não levar dado pessoal ao log (regra 8), use
`log_parameter_max_length=0` e `log_parameter_max_length_on_error=0`.

## Comandos (rodar na raiz)
| O quê | Comando |
|---|---|
| Subir o Postgres, criar o banco `macuxi` e migrar | `pnpm --filter @macuxi/db banco subir` |
| Estado (conexão, migrações, bancos de teste esquecidos) | `pnpm --filter @macuxi/db banco status` |
| Aplicar migrações pendentes | `pnpm --filter @macuxi/db banco migrar up [--ate 0001]` |
| Desfazer a última / N / todas | `pnpm --filter @macuxi/db banco migrar down [--passos N \| --tudo]` |
| Carregar o seed da Fase M | `pnpm --filter @macuxi/db banco seed fase-m` |
| Carregar a base de demo (`--recriar` = do zero) | `pnpm --filter @macuxi/db banco seed demo [--recriar]` |
| Carregar a fixture dois-tenants | `pnpm --filter @macuxi/db banco fixture dois-tenants` |
| Criar banco de teste efêmero (migrado; cópia do banco modelo, T-0033) | `pnpm --filter @macuxi/db banco criar-teste [--fixture dois-tenants\|fase-m]` |
| Apagar banco(s) de teste | `pnpm --filter @macuxi/db banco apagar-teste <nome> \| --todos` |
| (Re)criar o papel de aplicação | `pnpm --filter @macuxi/db banco papeis` |
| Recriar do zero (apaga volume, sobe e migra) | `pnpm --filter @macuxi/db banco recriar` |
| Medir o sync com volume (EXPLAIN + p50/p95) | `pnpm --filter @macuxi/db exec tsx scripts/medir-sync.ts` |
| Parar o container (mantém os dados) | `pnpm --filter @macuxi/db banco derrubar` |
| Parar e APAGAR o volume de dados | `pnpm --filter @macuxi/db banco derrubar --limpar` |
| Testes do banco | `pnpm --filter @macuxi/db test` |
| Subir só o Postgres dos testes (5434, tmpfs) | `pnpm --filter @macuxi/db banco subir-testes` |
| Listar / apagar sobras de teste (5434; sem conexão e com mais de 2 h) | `pnpm --filter @macuxi/db limpar-testes` · `... limpar-testes -- --apagar` |
| Backup / restauração da demo (VM) | `db/backup/backup-vm.sh` · `db/backup/restaurar-vm.sh` ([LEIA-ME](../../db/backup/LEIA-ME.md)) |

Todas aceitam `--banco <nome>` (padrão: `MACUXI_PG_BANCO` ou `macuxi`).

## Testes
`pnpm --filter @macuxi/db test` (também roda no `pnpm test` da raiz):
- **Estáticos (sempre rodam):** pares up/down, campos comuns, RLS/FORCE/política/grant/índice de sync
  em cada `create table`, Drizzle x SQL, cobertura da fixture e do seed.
- **Com Postgres:** o `globalSetup` cria um banco efêmero `macuxi_teste_<...>`, aplica as migrações,
  carrega a fixture dois-tenants e apaga o banco no fim. Arquivos:
  `migracoes.test.ts` (S0-020/021/022), `conformidade.test.ts` (S0-023/028), `vazamento.test.ts`
  (S0-024/025/026/027), `seed-fase-m.test.ts` (S0-031..034), `seed-demo.test.ts` (base de demo: idempotência, `--recriar`, isolamento), `drizzle-x-banco.test.ts`.
- **Postgres parado, Docker aberto:** o `globalSetup` roda `docker compose up -d --wait postgres-testes` e os testes
  **rodam** (desligue com `MACUXI_PG_AUTO_SUBIR=0`; só vale para host local).
- **Sem Docker/Postgres:** esses arquivos são **pulados** e, no fim, aparece
  `[db] Docker não está rodando: N testes de banco pulados.` (relator `db/testes/aviso-pulos.ts`).
- **CI:** defina `MACUXI_PG_EXIGIR=1` — aí a ausência do banco é **erro** (não pula).
- **Banco modelo** (T-0033, `db/src/banco-modelo.ts`, ADR 0013 §6): o 1º `criarBancoDeTeste` migrado de cada processo
  garante `macuxi_modelo_<chave>` (todas as migrações aplicadas, `IS_TEMPLATE`, `ALLOW_CONNECTIONS false`) e os bancos
  efêmeros saem por `create database <nome> template <modelo>`, já migrados (os papéis são do cluster: GRANTs, RLS e
  `public.macuxi_migracao` vêm na cópia). Chave = 12 hex do sha256 de versão/nome/checksum up/down de cada migração, do
  admin e de `VERSAO_MODELO`: migração nova ou editada = modelo novo. Construção com advisory lock próprio
  (`CHAVE_LOCK_MODELO`, ≠ do migrador e dos papéis) no banco `postgres`; "pronto" = existe e `datistemplate` (sobra de
  construção interrompida é apagada e refeita). Ligado por padrão só em Postgres local (o `localhost` do CI incluído);
  `MACUXI_PG_MODELO=0` desliga (migra do zero, como antes), `=1` força. `migrar: false` cria vazio, como antes. Falha do
  modelo (construção ou cópia) **não derruba** a suíte: aviso no log e o caminho antigo. Modelos de outra chave saem no
  `banco apagar-teste --todos`; `banco status` lista os modelos. Teste: `db/testes/banco-modelo.test.ts`.
- **Admin sem superusuário** (DBaaS da Magalu; modo do CI com `db/scripts/admin-sem-superusuario.ts` e
  `MACUXI_PG_ADMIN_SEM_SUPER=1`): o globalSetup mede `adminIgnoraRls` e `local` e os põe no estado. Up/down com dados numa
  versão anterior à 0031 pulam com `motivoSemSuperusuario('<versão>')`, e o seed da Fase M pula fora do local com
  `motivoForaDoLocal`. Os dois põem o motivo no título (`comMotivo`, marca `[pulado: ...]`). Com superusuário e Postgres
  local, tudo roda. Teste novo de up/down com dados: passe a versão em que os dados entram (ver
  [dbaas-magalu.md](dbaas-magalu.md#suíte-do-c34-sem-superusuário-3ª-execução)).
- **Apagar a base efêmera sem superusuário** (T-0075): `apagar()` usa `apagarBancoForcado` (`db/src/apagar-banco.ts`).
  O `drop database ... with (force)` dá 42501 "permission denied to terminate process" se ainda houver na base uma
  sessão de papel que o admin não pode sinalizar (o admin tem só SET, sem INHERIT, no `macuxi_app`/`macuxi_worker`, e não
  tem `pg_signal_backend`) — ex.: o cliente do `macuxi_app` que acabou de dar `end()` e ainda sai do servidor, ou um
  autovacuum worker. Aí ele faz o DROP comum (o Postgres encerra o autovacuum e espera até 5 s) e repete com espera
  crescente até 8 s (`PRAZO_APAGAR_MS`, abaixo dos 10 s de ociosidade do pg.Pool: pool sem `end()` não passa escondido;
  R-20261106-042954); passado o prazo, o erro sobe com quem segura a base (papel/tipo e quantidade). Não se concede
  `pg_signal_backend` nem filiação com INHERIT ao admin (as políticas `to macuxi_app` passariam a valer para ele).
  Regra para teste: feche cliente/pool antes do `apagar()`; DROP DATABASE com FORCE em TS do `@macuxi/db` só por essa
  função (trava em `db/testes/apagar-banco.test.ts`).
- **Relógio simulado:** `MACUXI_AGORA=2026-11-04T03:59:00Z pnpm --filter @macuxi/db test` carrega a fixture como se
  fosse esse instante (prova de que nada depende da hora do dia nem da virada de data no fuso). Regra: teste não
  compara instante da fixture com `now()` — use `checkin_em + interval` ou instante fixo (ver fixture-dois-tenants.md).
- Vários processos ao mesmo tempo (ex.: `pnpm test` da raiz + `tests/`) são seguros: cada um usa o
  próprio banco efêmero; a criação do papel `macuxi_app` é serializada por advisory lock.
- **Timeouts:** `db/vitest.config.ts` usa `testTimeout` e `hookTimeout` de 300 s (o caso do aparelho SQLite tem 600 s
  próprios). Tempo de caso não mede desempenho (quem mede é o EXPLAIN): up/down/up (S0-021), seeds e `--recriar`
  levam segundos sozinhos, mas passam de 60 s com o `pnpm test` da raiz carregando todos os pacotes no mesmo Postgres.

## Testes de banco na sessão da nuvem
Sem Docker (R-20261115-213600-alexandre: só nas sessões da nuvem, Linux root). `db/scripts/pg-local.sh` sobe com o
PostgreSQL 16.15 do Ubuntu os dois servidores do CI: **5432** (superusuário `postgres`/`postgres`) e **5433** (servidor limpo
para o admin sem superusuário). TZ UTC, UTF8, locale `en_US.UTF-8` e pgvector (0.6.0 do apt; o CI tem 0.8.2), dados em
`/var/lib/postgresql/macuxi` (fora do repositório; `MACUXI_PG_LOCAL_DIR` muda), fsync desligado. Nunca atualiza o
`postgresql-16` (o CI trava a 16.15). Sem pgvector, o `--env` inclui `MACUXI_PG_SEM_VECTOR=1`.
Dados em `/tmp` são recusados e vão para o padrão (a nuvem restaura `/tmp/claude-0` e derruba o servidor); sem o usuário
`postgres`, o script cria o `pgrun` sem privilégio para rodar o servidor; pode ser chamado de qualquer diretório.

**Node 24.7 ou mais** (engines; o seed usa `crypto.argon2Sync`): com o Node 22 da sessão a suíte falha no globalSetup. O
`--env` põe `/opt/node24/bin` no PATH quando ele existe (`MACUXI_NODE24_DIR` muda). Para instalar, baixe
`node-v24.x-linux-x64.tar.xz` de `nodejs.org/dist/latest-v24.x/`, confira o `SHASUMS256.txt` e extraia com
`tar -xJf <arquivo> -C /opt/node24 --strip-components=1`.

| Quero | Comando |
|---|---|
| Subir (instala o que faltar; idempotente) | `bash db/scripts/pg-local.sh` (ou `--subir`) |
| Ver as variáveis do CI e o `PATH` | `bash db/scripts/pg-local.sh --env` |
| Ver se estão de pé | `bash db/scripts/pg-local.sh --status` |
| Parar (os dados ficam) | `bash db/scripts/pg-local.sh --parar` |
| Recriar a 5433 limpa (repetir o admin sem superusuário) | `bash db/scripts/pg-local.sh --limpar-5433` |

Suítes, como no CI:
```bash
eval "$(bash db/scripts/pg-local.sh --env)"
pnpm --filter @macuxi/db test                                  # 5432, superusuário
MACUXI_PG_PORTA=5433 pnpm --filter @macuxi/db admin-sem-superusuario
MACUXI_PG_PORTA=5433 MACUXI_PG_ADMIN_USUARIO=macuxi_admin_sem_super MACUXI_PG_ADMIN_SENHA=macuxi_admin_sem_super_ci \
  MACUXI_PG_ADMIN_SEM_SUPER=1 pnpm --filter @macuxi/db test   # 5433, sem superusuário
```
O `admin-sem-superusuario` recusa servidor com banco modelo/teste de uma rodada anterior: rode `--limpar-5433` antes de
repetir. Tempos medidos: [docs/testes/antes-do-push.md](../testes/antes-do-push.md).

## Para o agente `testes` (tests/)

**Opção 1 — mesmo setup do db/ (recomendada para o vazamento):** em `tests/vitest.config.ts`:
```ts
import AvisoPulos from '@macuxi/db/teste/aviso-pulos';
// ...
test: {
  globalSetup: ['../db/testes/global-setup.ts'],   // relativo ao root (tests/): sobe o Docker se preciso,
  reporters: ['default', new AvisoPulos()],         // cria macuxi_teste_*, migra, carrega dois-tenants e apaga no fim
  hookTimeout: 120_000,
}
```
E no teste: `import { banco, semBanco } from '@macuxi/db/teste/estado'` +
`describe.skipIf(semBanco())(...)`; `banco().urlApp` (papel `macuxi_app`, RLS), `banco().urlPortal` (papel `macuxi_portal`, só as `plataforma.sa_*`, 0038) e `banco().urlAdmin`.
**Relógio da fixture** (T-0042): `agoraDaFixture()` e `hojeDaFixture(fuso)` (de `@macuxi/db/teste` ou `.../estado`) dão o
instante e o "hoje" com que o globalSetup carregou a fixture; use-os no lugar de `new Date()` para o dia/mês da fixture
([fixture-dois-tenants.md](fixture-dois-tenants.md)).
Utilitários do vazamento (`tabelasComTenant`, `emTransacao`, `erroDe`, `comCliente`) em
`@macuxi/db/teste/util`. O próprio `db/testes/vazamento.test.ts` é o modelo.

**Opção 2 — banco por arquivo, sem globalSetup:**
```ts
import { agoraDaFixture, carregarFixtureDosTestes, criarBancoDeTeste, comTenant, DOIS_TENANTS, TABELAS_SEM_TENANT_ID } from '@macuxi/db/teste';
import pg from 'pg';

// a fixture COMPLETA (dois-tenants + Treinamento), a mesma do globalSetup; só carregarDoisTenants deixa o schema treinamento vazio (T-0033)
const banco = await criarBancoDeTeste({ preparar: (admin) => carregarFixtureDosTestes(admin, { agora: agoraDaFixture() }) });
const pool = new pg.Pool({ connectionString: banco.urlApp });           // papel macuxi_app (sujeito a RLS)
const linhas = await comTenant(pool, DOIS_TENANTS.A.tenantId, (c) => c.query('select * from core.usuario'));
await pool.end(); await banco.apagar();
```
- `banco.urlAdmin` ignora RLS: use só para preparar dados ou ler o catálogo, **nunca** para provar isolamento.
- `postgresDisponivel()` devolve `{ ok }` para decidir `describe.skipIf`.
- IDs determinísticos em `DOIS_TENANTS` (prefixo `aaaaaaaa-` para A, `bbbbbbbb-` para B). Detalhe em
  [fixture-dois-tenants.md](fixture-dois-tenants.md).

## Arquivos
| Caminho | Conteúdo |
|---|---|
| `db/docker-compose.yml` | serviço `postgres` (pgvector/pgvector:pg16), volume `macuxi-pgdata`, porta 5432 só em `127.0.0.1`, UTC |
| `db/migrations/NNNN_nome.up.sql` / `.down.sql` | migrações versionadas (SQL), sempre com caminho de volta |
| `db/src/migrador.ts` | executor up/down com checksum do up e do down (migração aplicada não pode ser editada) e advisory lock |
| `db/src/contexto.ts` | `comTenant` / `definirTenant` (contexto do tenant por transação) |
| `db/src/papeis.ts` | papéis `macuxi_app` e `macuxi_worker` (`garantirPapelApp`, `garantirPapelWorker`) e diagnóstico (S0-028) |
| `db/src/banco-teste.ts` | banco efêmero, disponibilidade do Postgres |
| `db/esquema/plataforma.ts`, `modules/core/db/nuvem.ts`, `modules/vendedor/db/nuvem.ts` | espelho Drizzle (tipado) das tabelas |
| `db/src/ids.ts`, `db/src/datas.ts` | ids fixos/determinísticos (`idDeChave` = `plataforma.uuid_de_chave`, `idMotivoPadrao`) e datas relativas a hoje no fuso |
| `drizzle.config.ts` | Drizzle Kit; `drizzle:rascunho` gera só rascunho em `db/drizzle-rascunho/` (ignorado) |
| `db/seeds/fase-m/fase-m.ts` | seed de demonstração da Fase M |
| `db/seeds/demo/demo.ts` | base de demo (tenant `demo`, seção "Base de demo") |
| `db/seeds/fixtures/dois-tenants.ts` | fixture dos testes de RLS e licenças |
| `db/scripts/banco.ts` | CLI acima |
| `db/src/docker.ts` | acha o Docker (inclusive fora do PATH no Windows), diz se está rodando, sobe o compose |
| `db/testes/global-setup.ts`, `db/testes/aviso-pulos.ts` | setup dos testes de banco (sobe/pula/exige) e aviso de pulados |
| `db/scripts/medir-sync.ts` | medição do sync com volume ([desempenho-sync.md](desempenho-sync.md)) |
| `db/scripts/limpar-bancos-teste.mjs` | limpeza das sobras de teste (lista; `--apagar`; idade e conexão) |
| `db/backup/` | backup da demo para o Object Storage: `backup.mjs`/`s3.mjs` (Node puro, SigV4), `backup-vm.sh`, `restaurar-vm.sh`, `contagem.sql` |

## Migrações: regras
1. Uma migração = `NNNN_nome.up.sql` + `NNNN_nome.down.sql`, numeração contínua (o executor recusa buraco).
2. **Nunca edite migração aplicada** — checksum (sha256, fim de linha normalizado) do `.up.sql` diferente aborta o `up`;
   o do `.down.sql` diferente aborta o `up` e o `down`. Crie a próxima.
3. Toda tabela nova: campos comuns, `enable` + `force row level security`, política `isolamento_tenant`
   para `macuxi_app`, grant explícito, índice `(tenant_id, updated_at, id)` se for sincronizada. O teste
   estático reprova o `create table` que esquecer algum.
4. O `down` apaga dados (DROP SCHEMA ... CASCADE). Em produção, só com backup e decisão registrada.
5. Drizzle é espelho: ao mudar o SQL, ajuste `db/esquema/*.ts` ou `modules/<m>/db/nuvem.ts` (o teste Drizzle x banco acusa).
6. Perfis: a fonte única é `PERFIS` de `@macuxi/platform-sdk`. O Drizzle importa de lá; os `check (perfil in (...))`
   das migrações são comparados com ela em `db/testes/estatico.test.ts` (perfil novo = migração nova trocando o CHECK).

Modelo e políticas: [rls.md](rls.md) · dicionários: [plataforma.md](plataforma.md), [core.md](core.md), [catalogo.md](catalogo.md), [vendedor.md](vendedor.md), [integracao.md](integracao.md).

Migrações: 0001 plataforma · 0002 core · 0003 worker/outbox · 0004 sessão e aparelho · **0005 `plataforma.arquivo` +
`uuid_de_chave`** · **0006 lote A do core** (Cliente 360, rotas, visitas, motivos, notificações, metas, indicador diário;
padrões em todo tenant por gatilho) · **0007 schema `vendedor`** (pedido e pedido_item, mínimo do pull) · 0008 preço do Catálogo ·
0009 pedido completo do Vendedor · **0010 schema `integracao`** (Hub) · **0011 retenção da outbox** (`plataforma.expurgar_outbox`) ·
**0012 `pg_temp` no fim do `search_path`** das 4 funções SECURITY DEFINER (T-0042).
O executor roda como admin (superusuário no Docker/CI): a semeadura dos padrões e as fixtures dependem disso (FORCE RLS).

## Pendências
Feitas na **T-0004** (migração `0003_plataforma_worker`): `carteira_usuario_sync_ix`, papel `macuxi_worker` com as
políticas `despacho_outbox*` (ADR 0007), `plataforma.evento_consumo` e colunas `usuario_id`/`request_id` em
`plataforma.evento`. Feitas na **T-0003 Fase 2** (migração `0004_core_sessao`): `core.sessao`, `core.dispositivo`,
`core.usuario.tentativas_falhas`/`bloqueio_ate` e `equipe_responsavel_ix` ([core.md](core.md)). Pendentes:
- Limpeza de `core.sessao` expirada (job no worker ou por tenant; índice `sessao_expira_ix` pronto).
- pg-boss (schema `pgboss`, criado pelo migrador) junto do primeiro consumidor real (ADR 0007 item 5).
- `MACUXI_PG_WORKER_SENHA` nos `.env.example` (raiz: engenheiro-software; `db/.env.example`: sem permissão de leitura nesta sessão).
- Cursor do pull com transação longa (`updated_at = now()` é o início da transação): tratado na rota de pull (T-0004).
