# ADR 0073 — Perfis de acesso sem "perfil base": cada perfil é um conjunto explícito de permissões, editado numa tabela com caixas

- **Status**: **aceita** em 24/11/2026 pelo Alexandre (R-20261124-191902-alexandre: todas as opções A do item 12; §2.0).
  Código na v1.0.35; migrações a partir da 0103.
- **Data**: 2026-11-24
- **Origem**: pedido do Alexandre, R-20261124-094327, item 12 de 24/11: perfis de acesso **sem "perfil base"** (cada perfil é um
  perfil, independente) e permissões numa **tabela com caixa de marcar** (uma linha por permissão, agrupadas por área; a caixa liga
  e desliga).
- **Autor**: engenheiro-software
- **Revê**: [0033](0033-motor-de-permissoes-por-perfil.md) §2 (fábrica + sobreposições), §3 (perfil base × personalizado),
  §5 (limites travados pela base) e §7 (`RotaModulo.perfis` pela base); [0049](0049-cargos-fixos-e-um-perfil-por-usuario.md) §2
  ("o personalizado nasce com o cargo da base"). Continuam valendo: as chaves estáveis (0033 §1), a resolução por requisição sem
  JWT (0033 §4), a licença antes da permissão (0033 §7), os cargos fixos e um perfil por usuário (0049 §1, §3 e §4).
- **Regras**: revê RN-CORE-01, RN-CORE-04, RN-CORE-33, RN-CORE-34, RN-CORE-35, RN-PRO-01 e RN-PLA-02; mantém RN-CORE-02,
  RN-CORE-32, RN-CORE-53 a 57 e RN-AUD-01.

## 1. Situação atual

### 1.1 O modelo
- **Perfil base** = um dos 7 nomes fixos de `PERFIS` (`packages/platform-sdk/src/nomes.ts`): vendedor, promotor, supervisor,
  gerente, analista, assistente, admin. É o valor de `core.usuario.perfil`, do `perfil` do token e de `ctx.usuario.perfil`.
- **Padrão de fábrica** (`matrizDeFabrica`, `packages/platform-sdk/src/permissoes-perfil.ts`): as chaves da plataforma por base
  (`FABRICA_PLATAFORMA`: `acesso.*`, `dados.escopo`, `usuario.*`, `senha.redefinir`, `perfil.gerir`) + o `perfis` de cada ação dos
  manifestos (ADR 0004).
- **Perfil do tenant** (`plataforma.perfil`, migração 0041; `cargo` desde a 0069): `codigo`, `nome`, `descricao`, `base`,
  `fabrica`, `ativo`, `cargo`. Os 7 de fábrica (código = base) não se apagam nem se desativam; o personalizado nasce de uma base que
  não muda depois (`BASE_ALTERADA`).
- **Sobreposições** (`plataforma.perfil_permissao`): só o que o tenant mudou em relação à fábrica da base (`concedida`, `nivel`,
  `alvos`). "Restaurar o padrão" = apagar as linhas.
- **Resolução por requisição**: `plataforma.perfis_do_usuario` → `resolverPerfil` (fábrica da base → sobreposições → travas da base)
  → `ctx.usuario.perfis: PerfilDaRequisicao[]` (`{ codigo, base, permissoes }`). Um perfil por usuário (RN-CORE-54, ADR 0049):
  `combinarPerfis` continua, com lista de no máximo um item.
- **Página do BKO** (`modules/core/web/components/perfis/perfis-page.tsx`, `novo-perfil.tsx`): cada linha mostra o valor da
  fábrica, o atual e o cadeado (`travaDaChave(base, chave)`); o "Novo perfil" (R-20261114-144500) já usa uma tabela por módulo e
  **deduz a base das caixas marcadas** (`baseDoNovoPerfil`, `modules/core/web/lib/acesso.ts:317`).
- **Contrato HTTP** (`modules/core/contracts/perfis.ts`): `base` em `PerfilResumo`, `PerfilOpcao` e `CriarPerfilRequest`;
  `fabrica` e `trava` em cada chave; `escopo_maximo` da base. Não há evento `core.perfil.*`.

### 1.2 Regras que dependem da base hoje
| Regra | Onde a base entra | Código |
|---|---|---|
| **RN-CORE-35** (limites dos perfis) | último admin = usuário ativo com perfil **de base admin** que entra no BKO e tem a gestão do acesso; autogestão; 7 de fábrica presentes e ativos; base imutável | `validarAcessoDoTenant`, `ehAdminComGestao` (`permissoes-perfil.ts`) |
| **RN-CORE-33** | base vendedor, promotor e supervisor (e derivados) sem `acesso.bko` e `acesso.portal`; portal só base admin | `BASES_SEM_BKO`, `travaDaChave`; `PERFIS_DO_APP.web` e `podeUsarSuperficie` (`perfis.ts`); `app.ts:825` (superfície BKO); `plataforma.usuario_tem_perfil_admin` (0047) |
| **RN-PRO-01** (regra inegociável 7) | base promotor sem nenhuma ação de escrita de pedido (`ehAcaoDeEscritaDePedido`) | `travaDaChave`; `app.ts:788-790` (todos os perfis de base promotor → 403 na rota de pedido); sync de pedido recusado ao promotor |
| **Multiperfil** | união nas ações, mais restritiva nos acessos | `combinarPerfis`; já revisto pela ADR 0049 (um perfil por usuário), mas o texto do doc 03 (RN-CORE-01 e RN-CORE-35) ainda fala em multiperfil |
| **Sempre um admin ativo** | "perfil de base admin" | `ehAdminComGestao`; `USUARIO_SEM_PERFIL` |
| **Senha** (RN-CORE-34, P7) | nunca redefine a de quem tem perfil de base admin; `ALVO_TODOS` = todos que não são de base admin | `alvoCoberto`, `validarPerfil`; `modules/core/domain/acesso-senha.ts:88`; `modules/core/web/lib/usuarios.ts:227` (`temPerfilDeBase`) |
| **Escopo de carteira** (RN-CORE-04) | o escopo de dados nunca passa o da base | `escopoMaximoDaBase`, `aplicarTravasDoPerfil`, `ESCOPO_ACIMA_DA_BASE`; `escopo_maximo` no detalhe |
| **Licença do módulo** (RN-CORE-02) | não depende da base (a licença vem antes da permissão, `verificarAcao`) | — |
| **Tipo de licença do plano** (RN-PLA-02) | `LICENCA_DO_PERFIL` pela base | `packages/platform-sdk/src/planos.ts:34`; 0086 (`case a.base ...`) |
| **App Campo × Gestão** | `PERFIS_DO_APP` (campo = vendedor, promotor; gestão = supervisor, gerente; web = admin, analista, assistente, gerente) e o padrão de `acesso.campo/gestao` | `perfis.ts:14`; `autenticacao.ts:251` (`mensagemPerfilForaDoApp(quemFecha?.base ?? u.perfil)`); shells |
| **Cargo** (RN-CORE-53) | o personalizado nasce com o cargo da base; `cargoDaBase` como valor de reserva | `cargos.ts:13` (`CARGO_DA_BASE`), `plataforma.cargo_da_base`, `modules/core/api/perfis.ts:114` |

### 1.3 Usos de "base" (de perfil) no código
Levantados com `grep` em `packages`, `apps`, `modules` e `db`, sem testes; o "base" de preço, de rota (casa/base do vendedor),
de geração de sync e de quantidade ficou de fora.
- **SDK**: `permissoes-perfil.ts` (todo o motor: `FABRICA_PLATAFORMA`, `matrizDeFabrica`, `escopoMaximoDaBase`, `BASES_SEM_BKO`,
  `PerfilDeAcesso.base`, `perfilDeFabrica`, `PerfilDaRequisicao.base` e o Zod `PerfilDaRequisicaoSchema`, `RefPerfil.base`,
  `travaDaChave`, `aplicarTravasDoPerfil`, `resolverPerfil`, `combinarPerfis`, `alvoCoberto`, `temPerfilDeBase`, `validarPerfil`,
  `ehAdminComGestao`, `validarAcessoDoTenant`); `perfis.ts` (`PERFIS_DO_APP`, `perfilUsaApp`, `mensagemPerfilForaDoApp`,
  `podeUsarSuperficie`); `cargos.ts` (`CARGO_DA_BASE`, `cargoDaBase`); `planos.ts:33` e `:201` (`LICENCA_DO_PERFIL`); `acesso.ts:55`
  (`RotaModulo.perfis` aceita a base de qualquer perfil); `acesso-sessao.ts:6-19` (sem perfis resolvidos, fábrica da base);
  `arquivos.ts:180-190` (conta a base); `api.ts:402` e `plataforma.ts:263` (comentários de base admin); `email/modelos.ts:63`.
- **API**: `apps/api/src/app.ts:47`, `:519` (`perfilDeFabrica(token.perfil)`), `:788-790` (RN-PRO-01 por base), `:825`
  (superfície BKO); `apps/api/src/licencas.ts:134-137` (`select codigo, base, fabrica, ...`).
- **Core**: `api/perfis.ts` (`base` em toda a CRUD, `escopoMaximoDaBase`, `travaDaChave`, `cargoDaBase`, `ordemDaBase`,
  `copiar_de` com a mesma base, `sobreposicoesDoDesejado`); `api/perfis-do-usuario.ts:3-34`; `api/usuario-perfis.ts:3-86`
  (principal = base em `core.usuario.perfil`, `refsDoUsuario`, `principalDe`); `api/usuarios.ts:150-159` e `:408`;
  `api/credencial.ts:38-39`; `api/cliente360-v2.ts:374-375`; `api/autenticacao.ts:251`; `domain/perfis.ts:60`
  (`sobreposicoesDoDesejado(base, ...)`); `domain/matriz.ts:8` e `:92`; `domain/usuarios.ts:12`, `:83`, `:107`, `:134`;
  `domain/acesso-senha.ts:78-88`; `domain/tarefas/destinatarios.ts:10`; `domain/rastreamento.ts:20`; `contracts/perfis.ts`
  (`base` em 3 schemas, `fabrica`, `trava`, `escopo_maximo`); `contracts/usuarios.ts:25-29` e `:61`; `web/lib/acesso.ts:7`,
  `:316-323` (`baseDoNovoPerfil`); `web/lib/perfis.ts:51` e `:187`; `web/lib/usuarios.ts:6` e `:226-227`;
  `web/components/perfis/perfis-page.tsx:330`, `:380-383`, `:464` ("Perfil base"), `:620`, `:664`;
  `web/components/perfis/novo-perfil.tsx:116-146`; `web/components/usuarios/usuarios-page.tsx:206-208` e `:576`.
- **Kit** (`packages/ui`, do designer-ux): `src/web/perfis.ts:5-64` (`ROTULO_PERFIL_BASE`, `PerfilBase`, `escopoAcimaDaBase`,
  `baseImutavel`, seletor "Perfil base"); `src/web/permissoes.tsx:4`; `src/comum/perfis.ts:10`.
- **Web (portal)**: `apps/web/lib/portal-admins.ts:36-43`. **Mobile**: `apps/mobile/src/lib/trajeto.ts:207` (cargo = base).
- **Banco**: 0041 (`plataforma.perfil.base`, `fabrica`, `perfil_permissao`, gatilhos de semeadura e de "um admin");
  0046 e 0047 (portal e `usuario_tem_perfil_admin` por base admin); 0051 (perfil assistente); 0069 (`cargo_da_base`,
  `perfil.cargo`); 0086 (licença por base); 0100 (zerar empresa); `db/esquema/plataforma.ts:102-140`; `db/src/ids.ts:64-68`
  (`idPerfilFabrica(tenant, base)`); `db/seeds/fixtures/dois-tenants.ts:551-623` e `:1208-1209`; `db/scripts/diagnostico-0069.sql`.
- **Comparações com o nome fixo do perfil** (`ctx.usuario.perfil === '...'` ou listas `PERFIS_*`), que hoje são a base por outro
  nome: cerca de 70 arquivos, os principais em `modules/vendedor/domain/aprovacao.ts` (alçada por `analista`),
  `modules/vendedor/domain/pedido-em-nome.ts`, `modules/vendedor/api/{pedidos,receber,sync,opcao-promotor}.ts`,
  `modules/core/api/{metas,carteira,usuarios-visiveis,inicio,clientes,sync,rotas-criar,plano-rv,performance}.ts`,
  `modules/core/domain/{metas-edicao,fotos-pdv,documentos-cliente,filial-usuario,base-vendedor,carteira-cliente,entrada-sync,promotor-pedidos,plano-rv}.ts`,
  `modules/gestor/domain/*`, `modules/catalogo/{api/rotas,api/sync,domain/visibilidade}.ts`,
  `modules/pesquisa/{api/sync,domain/publico}.ts`, `modules/treinamento/{api/comum,domain/trilha}.ts`,
  `modules/promotor/domain/coleta.ts`, `modules/integracao/domain/permissoes.ts`, `packages/platform-sdk/src/{shell,permissoes}.ts`,
  `apps/web/lib/queries.ts:104`, `apps/mobile/src/lib/efetivos-locais.ts:18`. A ADR 0033 já proibia comparar perfil com nome
  fixo; esta ADR fecha o assunto (§2.8).

## 2. Decisão

### 2.0 Decisões do Alexandre (R-20261124-191902-alexandre, todas as opções A)
1. **Perfil = nome + cargo + permissões**; as travas (§2.5) saem do cargo, nunca de uma combinação de caixas.
2. **A tabela edita um perfil por vez** (linhas = permissões por área; não há grade com todos os perfis lado a lado).
3. **Conflito na migração** (perfil cujo cargo não bate com a base, ou concessão que a trava pelo cargo cortaria, §5.5): o caso
   fica para o tenant e é levado a ele caso a caso; nada é cortado em silêncio. O perfil **sem usuários** é acertado para o cargo
   pela própria migração (auditado).
4. **Admin = quem tem a gestão do acesso completa** (`acesso.bko` + `perfil.gerir` + `usuario.criar` + `usuario.editar` +
   `usuario.desativar`), para o "sempre um admin ativo" e o portal. A senha (`senha.redefinir`) alcança todos, menos quem também
   tem essa gestão (e menos o próprio).
5. **Revogação sem efeito** (sobreposição `concedida=false` que hoje não muda o que vale): a migração mantém o que o usuário vê
   hoje na tabela (a caixa como aparece marcada), e a lista desses casos vai ao tenant.
6. **Janela de retorno**: o modelo antigo (`perfil.base`, `perfil.fabrica`, `perfil_permissao`, `core.usuario.perfil` e o
   `perfil` do token) fica guardado por **uma versão inteira do app ou 30 dias, o que vier depois**; só então a fase 2 o apaga.

### 2.1 Cada perfil é um conjunto explícito de permissões
- O perfil de acesso do tenant passa a ser: `id` (UUID), `codigo`, `nome`, `descricao`, **`cargo`** (RN-CORE-53, lista fixa),
  `ativo` e **o conjunto das permissões concedidas** (chave + nível ou alvos, quando a chave os tem). Não existe mais base, fábrica
  nem sobreposição: o que está marcado na tabela é o que vale.
- Os **7 perfis padrão** (Vendedor, Promotor, Supervisor, Gerente, Analista, Assistente, Admin) continuam a ser criados no
  provisionamento (RN-CORE-31), já com as permissões explícitas tiradas dos **modelos** (§2.3). Depois disso são perfis como os
  outros: o admin renomeia, edita, desativa e apaga (sem usuários), dentro das invariantes (§2.5).
- **Novo perfil**: nome, cargo e, opcionalmente, "copiar as permissões de" um perfil do tenant ou de um modelo. A cópia é feita uma
  vez e não deixa vínculo: mudar o perfil de origem depois não muda o novo. "Restaurar o padrão" sai; no lugar, "Copiar de um
  modelo" substitui as caixas marcadas, e o admin confere e salva.
- O **cargo** é o único atributo fixo do perfil que dá limite (a hierarquia, a licença do plano e as travas abaixo saem dele).
  Ele muda só em perfil sem usuários, porque a hierarquia dos usuários (RN-CORE-55 e 56) e o tipo de licença (RN-PLA-02) dependem
  dele.

### 2.2 Catálogo de permissões versionado em contracts
- O catálogo = as chaves da plataforma (`CHAVES_PLATAFORMA`, SDK) + as ações de todos os manifestos instalados, cada uma com
  `area`, `modulo` (licença), `descricao`, `nivel?` e `alvos?`. Hoje ele já existe (`catalogoDePermissoes`); passa a ter
  **`CATALOGO_PERMISSOES_VERSAO`** (inteiro), que sobe a cada chave nova, renomeada ou retirada, e um teste que trava a lista
  (instantâneo) para nenhuma chave mudar sem a versão subir.
- **Nomes das chaves não mudam** (0033 §1). A área é atributo (a chave não muda quando a área muda).
- **Chave nova** de um módulo, num tenant que já existe: não há mais fábrica para ela "aparecer sozinha". O manifesto declara em
  cada ação os **cargos** a que ela é dada por padrão (`cargos`, no lugar de `perfis`); a API, ao subir uma versão do catálogo,
  concede a chave nova uma vez a todos os perfis ativos desses cargos (no cargo administrativo, só aos perfis com a gestão do acesso
  completa, §2.5), registra em `plataforma.catalogo_aplicado (tenant_id, versao)` e audita. A página destaca as chaves novas até o
  admin salvar o perfil. Retirar uma chave do catálogo apaga as concessões dela.
- `modulo.gerir_licencas`, `perfil.gerir`, `usuario.*` e `senha.redefinir` continuam da plataforma (o Core é o dono das telas, o
  SDK é o dono da regra).

### 2.3 Modelos (só para criar e para migrar)
`MODELOS_DE_PERFIL` (SDK) = os 7 conjuntos de hoje (`matrizDeFabrica` renomeada para `modelosDePerfil(manifestos)`), cada um com o
cargo. Usos: provisionamento, "copiar de um modelo" e a derivação da migração (§5). **O modelo nunca é lido na requisição.**
O banco ganha uma cópia gerada (`plataforma.modelo_permissao`), conferida contra o SDK por teste de equivalência, como já é feito
com `CARGO_DA_BASE` em `db/testes/cargo-hierarquia.db.test.ts`.

### 2.4 Como as regras que vinham da base passam a ser expressas
| Antes (pela base) | Depois |
|---|---|
| Onde entra (`PERFIS_DO_APP`) | caixas `acesso.campo`, `acesso.gestao`, `acesso.bko`, `acesso.portal`, com as travas do cargo (§2.5) |
| Escopo de dados ≤ o da base | `dados.escopo` com teto pelo **cargo**: vendedor e promotor `carteira`; supervisor `equipe`; gerente `equipes_abaixo`; administrativo `tenant` |
| Promotor sem pedido (RN-PRO-01) | trava pelo **cargo** promotor (§2.5) |
| `promotor_ve_pedidos` (parâmetro do tenant) | caixa `pedido.ver` no perfil (o mesmo efeito, uma informação num lugar); o parâmetro sai na implementação |
| `promotor_ve_preco_estoque` (parâmetro) | caixa `produto.ver_preco_estoque` no perfil; o parâmetro sai |
| Último admin = base admin com gestão | usuário ativo cujo perfil ativo tem `acesso.bko` e as 4 chaves de `CHAVES_GESTAO_DO_ACESSO` |
| Senha nunca de base admin | senha nunca de quem tem a gestão do acesso (`perfil.gerir`) nem a própria |
| Portal só base admin | `acesso.portal` só no cargo administrativo e com a gestão do acesso completa |
| Tipo de licença do plano pela base | pelo **cargo**: vendedor → vendedor; promotor → promotor; supervisor e gerente → gestor; administrativo → bko (mesmo resultado de hoje para os 7 perfis) |
| `RotaModulo.perfis` (rota sem ação) | toda rota declara `acao` (chave); `perfis` sai da `RotaModulo` |
| Alçada de aprovação com nível `analista` (RN-VEN-10, `aprovacao.ts`) | `pedido.aprovar` com o nível de alçada (`ate_alcada`, `acima_alcada`, família já existente) e a cadeia pelo cargo |
| Público de pesquisa, de trilha, do plano de RV e "quem vê" o documento (listas de nomes de perfil) | lista de **códigos de perfil** do tenant ou de **cargos**, cada módulo no seu contrato |

### 2.5 Invariantes travadas no domain e na API (nenhuma caixa as liga)
Conferidas por `validarPerfil` e `validarAcessoDoTenant` (SDK, função pura com teste citando a RN) no domain do Core e de novo na
API em toda escrita (422 com `codigo` = a RN e `detalhes.violacoes`), e na leitura por `resolverPerfil` (falha fechada: concessão
inválida no banco não vale). Na página aparecem como caixa desabilitada com o cadeado e a mensagem da regra.
1. **RN-PRO-01 — pelo cargo.** Perfil de cargo **promotor** nunca tem chave de escrita de pedido (`ehAcaoDeEscritaDePedido`:
   `pedido.criar`, `pedido.editar`, `pedido.cancelar`, `pedido.excluir`, `pedido.aprovar`, `pedido.criar_em_nome` e as que vierem
   com o mesmo prefixo). Na API, a barreira da rota de pedido e do sync de entidades de pedido passa a ser "cargo promotor → 403",
   além da chave. **Não** proponho a incompatibilidade "trade × pedido" no mesmo perfil: o dono do produto citou o vendedor que
   também faz trade como caso a atender (R-20261107-203658), e a ADR 0049 §3 manda quem acumula funções usar um perfil
   personalizado com as ações de que precisa. Um perfil de cargo vendedor com as chaves de coleta é permitido; um perfil de cargo
   promotor com pedido, nunca. Assim a regra inegociável 7 continua literal ("o promotor nunca cria/edita/exclui pedido") e
   verificável por um atributo fixo, sem depender de qual caixa está marcada.
2. **RN-CORE-33 — pelo cargo.** Cargos vendedor, promotor e supervisor nunca têm `acesso.bko` nem `acesso.portal`.
   `acesso.portal` só no cargo administrativo e só com a gestão do acesso completa (§2.4).
3. **Apps pelo cargo.** `acesso.campo` só nos cargos vendedor e promotor; `acesso.gestao` só em supervisor e gerente. O cargo
   administrativo não entra nos apps. Motivo: o app monta a carteira, a equipe e o Início pelo cargo (RN-CORE-55/56), e o tipo de
   licença do plano sai dele (RN-PLA-02). Abrir isso é decisão do dono do produto (backlog, §7).
4. **Pelo menos um lugar.** Todo perfil ativo tem ao menos uma chave `acesso.*`.
5. **RN-CORE-04 — teto do escopo pelo cargo** (§2.4). Nível acima do teto é recusado (422) e cortado na leitura.
6. **Sempre um admin ativo**: ao menos um usuário ativo cujo perfil ativo tem `acesso.bko` + `perfil.gerir` + `usuario.criar` +
   `usuario.editar` + `usuario.desativar` (`ULTIMO_ADMIN`). Quem tem essa gestão não a tira de si (`AUTOGESTAO`), nem pelo próprio
   perfil nem trocando o próprio perfil.
7. **Senhas**: `senha.redefinir` nunca vale sobre o próprio usuário nem sobre quem tem `perfil.gerir`; `*` = todos os perfis sem
   `perfil.gerir`, inclusive os criados depois; o alvo listado precisa existir. `usuario.desativar` nunca no próprio.
   RN-CORE-32 vale para toda senha (nenhuma chave a desliga).
8. **Licença do módulo (RN-CORE-02)**: a licença vem antes da permissão e é independente dela. Na página, chave de módulo sem
   licença no tenant aparece **desabilitada** (`disponivel: false`, motivo `MODULO_SEM_LICENCA`), com o valor guardado; ligar uma
   chave assim responde 422 `PERMISSAO_SEM_LICENCA`; a que já estava ligada fica guardada e volta a valer quando a licença voltar.
   O Core é sempre licenciado.
9. **Perfil e usuário**: código único no tenant; perfil com usuários não é apagado nem desativado (`PERFIL_EM_USO`); o cargo de
   perfil com usuários não muda (`CARGO_EM_USO`); todo usuário tem exatamente um perfil vivo e ativo (RN-CORE-54).
10. **Chaves com dependência** (só na tela, sem 422): ação de tela do BKO sem `acesso.bko` e ação de app sem `acesso.campo` ou
    `acesso.gestao` aparecem marcadas e acinzentadas com "sem efeito: o perfil não entra no BKO". Não é trava: o admin pode
    preparar o perfil antes de ligar o acesso.

### 2.6 Multiperfil
Não existe mais (ADR 0049 §3, RN-CORE-54). `combinarPerfis` e `CHAVES_DE_ACESSO_RESTRITIVAS` saem do SDK na implementação; `pode`,
`nivelPermitido`, `escopoDosPerfis` e `podeEntrar` passam a receber o perfil resolvido único (`PerfilDaRequisicao | null`). O
texto do multiperfil sai da RN-CORE-01 e da RN-CORE-35 (§3).

### 2.7 Resolução por requisição
Igual à 0033 §4, mais simples: `plataforma.perfil_do_usuario(usuario)` devolve `codigo`, `cargo` e as concessões do perfil vivo e
ativo; `resolverPerfil` aplica só as invariantes do §2.5 (falha fechada) e entrega `ctx.usuario.perfil_acesso` (§4.1). Nada no
JWT; a mudança vale na próxima requisição.

### 2.8 Fim do nome fixo de perfil no código
- `ctx.usuario.cargo` (novo, do perfil) passa a responder "onde está na hierarquia" (escopo, equipe, Início, app). "Pode fazer X"
  é sempre chave (`pode(...)` ou `acao` da rota).
- **Transição**: `core.usuario.perfil`, o `perfil` do token e `ctx.usuario.perfil` ficam, marcados `@deprecated`, com um valor
  **derivado** (`perfilDeCompatibilidade(cargo, permissoes)`): cargo vendedor, promotor, supervisor ou gerente → o mesmo nome;
  administrativo → `admin` se tem a gestão do acesso completa, senão `analista` se tem `carteira.editar` ou `pedido.aprovar`, senão
  `assistente`. Para os 7 perfis migrados o valor é o de hoje (teste de equivalência). Uma regra do dependency-cruiser/lint
  (`no-restricted-syntax` sobre `usuario.perfil` comparado com literal) impede uso novo; cada módulo troca os seus usos no próprio
  PR (lista no §1.3) e o campo sai numa ADR seguinte.
- Os shells instalados (app v1.0.x offline) leem `perfis[].base` de `GET /v1/me/modulos`: o campo continua, com o valor derivado,
  até a versão mínima do app (`app-versao`) passar da que lê `perfil_acesso`.

## 3. Texto proposto das RN (o gerente registra no doc 03; não editei `docs/produto`)

- **RN-CORE-35 Perfis de acesso e seus limites** (nova redação). Cada perfil de acesso é independente: tem nome, um cargo
  (RN-CORE-53) e a lista das permissões marcadas na tabela do BKO, agrupadas por área; não há perfil base nem padrão de fábrica.
  Os 7 perfis padrão são criados com a empresa e, depois, se editam como os outros. Nenhuma edição quebra estes limites, conferidos
  no domain e na API (não só na tela): RN-CORE-33 e RN-PRO-01 pelo cargo; o escopo de dados não passa o teto do cargo (RN-CORE-04);
  todo perfil ativo entra em pelo menos um lugar; permissão de módulo sem licença fica desabilitada (RN-CORE-02); sempre há um
  usuário ativo que entra no BKO com a gestão de perfis e de usuários, e quem a tem não a tira de si; a senha de quem tem a gestão
  de perfis e a própria nunca são redefinidas pelo BKO; perfil com usuários não é apagado nem desativado e não muda de cargo;
  RN-CORE-32 em todas as senhas. Toda mudança é auditada (RN-AUD-01) e vale na próxima requisição. *(Alexandre,
  R-20261124-094327; ADR 0073.)*
- **RN-CORE-33 Acesso ao BKO e ao portal** (revista). Perfil de cargo vendedor, promotor ou supervisor **nunca** entra no BKO nem
  no portal `config.`: a API recusa e o login não aceita. O portal é do time da Macuxi (super-admin) e de quem tem cargo
  administrativo com a gestão de perfis e de usuários. O app Campo é só dos cargos vendedor e promotor; o Gestão, só de supervisor
  e gerente.
- **RN-PRO-01** (revista). Perfil de cargo promotor nunca cria, edita, cancela, duplica, exclui ou aprova pedido — regra aplicada
  na UI **e** na API (403), qualquer que seja a tabela de permissões. Ver os pedidos da carteira é a permissão "Ver pedidos" do
  perfil (substitui o parâmetro `promotor_ve_pedidos`). Quem vende e faz trade usa um perfil de cargo vendedor com as permissões
  de trade.
- **RN-CORE-04** (revista). Escopo de dados é a permissão "Quais clientes e números vê" do perfil, com teto pelo cargo: vendedor e
  promotor, a própria carteira; supervisor, a equipe; gerente, as equipes abaixo; administrativo, a empresa.
- **RN-CORE-01** (revista, tirando o multiperfil, como a ADR 0049 já pedia). Módulos efetivos do usuário = módulos ativos do tenant
  ∩ módulos do perfil − exceções do usuário. Core sempre ativo. O usuário tem exatamente um perfil (RN-CORE-54). A exceção só
  restringe.
- **RN-CORE-34** (trecho revisto). "O BKO pode redefinir a senha de vendedor, supervisor e gerente" passa a "quem tem a permissão
  Redefinir senha redefine a dos perfis marcados nela, nunca a própria nem a de quem tem a gestão de perfis".
- **RN-PLA-02** (revista). O tipo de licença ocupado pelo usuário sai do cargo do perfil: vendedor, promotor, gestor (supervisor e
  gerente) ou BKO (administrativo).
- Pendência que encontrei: as RN-CORE-53 a 57 e a RN-PLA-02 citadas pelas ADRs 0047 e 0049 não estão no doc 03 do `main`; o
  gerente as registra junto.

## 4. Contratos

### 4.1 SDK (`@macuxi/platform-sdk`, interno ao monorepo; muda junto, sem `@v2` público)
```ts
type Concessao = { nivel?: NivelPermissao; alvos?: readonly string[] };           // como ValorPermissao
interface PerfilDeAcesso   { id: string; codigo: string; nome: string; cargo: Cargo; ativo: boolean;
                             permissoes: Readonly<Record<string, Concessao>> }     // sem base, fabrica, sobreposicoes
interface PerfilDaRequisicao { codigo: string; cargo: Cargo; permissoes: PermissoesDoPerfil } // sem base
const PerfilDaRequisicaoV2Schema = z.object({ codigo, cargo: CargoSchema, permissoes }).strict();
travaDaChave(cargo: Cargo, chave: string, ctx: { gestaoDoAcesso: boolean }): TravaDaChave | null
tetoDeEscopoDoCargo(cargo: Cargo): NivelEscopo
validarPerfil(perfil, perfisDoTenant: ReadonlyMap<codigo, { cargo; gestao: boolean }>, catalogo, licencas): ViolacaoLimite[]
validarAcessoDoTenant({ antes?, depois, atorId?, catalogo, licencas }): ViolacaoLimite[]
modelosDePerfil(manifestos): Readonly<Record<ModeloPerfil, { cargo: Cargo; permissoes: PermissoesDoPerfil }>>
CATALOGO_PERMISSOES_VERSAO: number
```
Saem: `matrizDeFabrica` (vira `modelosDePerfil`), `perfilDeFabrica`, `escopoMaximoDaBase`, `BASES_SEM_BKO`, `combinarPerfis`,
`temPerfilDeBase`, `SobreposicaoPermissao`, `CARGO_DA_BASE`/`cargoDaBase` (ficam só na migração), `PERFIS_DO_APP` (depois da
transição), `RotaModulo.perfis`. Códigos de violação novos: `PERFIL_SEM_ACESSO_ALGUM`, `ESCOPO_ACIMA_DO_CARGO` (no lugar de
`ESCOPO_ACIMA_DA_BASE`), `PERMISSAO_SEM_LICENCA`, `PERFIL_EM_USO`, `CARGO_EM_USO`; saem `PERFIL_FABRICA_AUSENTE` e `BASE_ALTERADA`.

### 4.2 HTTP do BKO (`modules/core/contracts/perfis.ts`; só quem tem `perfil.gerir`, exceto `opcoes`)
- `GET  /v1/core/permissoes/catalogo` → `{ versao, areas: [{ area, rotulo, chaves: [{ chave, descricao, modulo, nivel: 'escopo'|'alcada'|null, alvos: boolean, disponivel, motivo: 'MODULO_SEM_LICENCA'|null }] }] }`.
  É o que monta as linhas da tabela.
- `GET  /v1/core/perfis` → `{ itens: [{ codigo, nome, descricao, cargo, ativo, usuarios, onde_entra }] }` (sem `base` e `fabrica`).
- `GET  /v1/core/perfis/opcoes` → igual, só ativos, para o cadastro de usuário.
- `GET  /v1/core/perfis/:codigo` → `{ perfil, permissoes: [{ chave, concedida, nivel, alvos, trava: { regra, mensagem }|null, disponivel }], teto_escopo, alvos_possiveis, modulos, atualizado_em }`
  (sem `fabrica`, sem `escopo_maximo` da base).
- `POST /v1/core/perfis` `{ id: uuid, nome, descricao?, cargo, copiar_de?: { perfil: codigo } | { modelo: ModeloPerfil }, permissoes? }`
  → 201 `PerfilDetalhe`. Idempotente pelo `id` gerado no cliente (repetir devolve o mesmo).
- `PUT  /v1/core/perfis/:codigo` `{ nome?, descricao?, ativo?, cargo?, permissoes: [{ chave, nivel?, alvos? }], atualizado_em }`
  → 200 `PerfilDetalhe`. O conjunto enviado é o perfil inteiro (o que não vem fica desmarcado); `atualizado_em` é a trava
  otimista (409 `PERFIL_ALTERADO` se outro admin salvou antes). Repetir o mesmo corpo não muda nada (idempotente).
- `DELETE /v1/core/perfis/:codigo` → 204 (soft delete; 422 `PERFIL_EM_USO`).
- `GET  /v1/core/perfis/:codigo/historico` sem mudança.
- Erros: 403 `PERFIL_SEM_ACESSO`; 404 `PERFIL_NAO_ENCONTRADO`; 409 `PERFIL_ALTERADO`; 422 com `codigo` da violação e
  `detalhes.regra` = a RN.
- **Compatibilidade**: `base` sai de `CriarPerfilRequest`, `PerfilResumo`, `PerfilOpcao` e `PerfilDoUsuario`. É mudança
  incompatível de forma, mas o único cliente é o BKO, que sai no mesmo deploy da API (mesmo critério da ADR 0049 §3): fica no
  mesmo caminho `/v1`, registrada nesta ADR. `GET /v1/me/modulos` (lido pelos apps instalados) só **ganha** `perfil_acesso`
  (`PerfilDaRequisicaoV2Schema`) e mantém `perfis[].base` derivado até a versão mínima do app subir (§2.8).

### 4.3 Eventos
**Nenhum evento novo.** A permissão é lida por requisição, ninguém guarda cópia que precise ser avisada, e a auditoria
(RN-AUD-01: `perfil.criar`, `perfil.editar`, `perfil.apagar`, `perfil.catalogo_aplicado`, com antes e depois) basta. Se um dia
um módulo precisar reagir, nasce `core.perfil.alterado@1` com `{ perfil_id, codigo, cargo, chaves_ligadas, chaves_desligadas }`.
Nenhum evento existente leva `base`; nada precisa de `@v2`.

## 5. Pontos para o banco-dados (o plano de migração é dele, em paralelo)
1. **Sem perda de acesso**: para todo perfil vivo de todo tenant (base e demo), o conjunto concedido depois = `resolverPerfil`
   de hoje (fábrica da base + sobreposições + travas). Teste de equivalência por usuário: as chaves, o nível de `dados.escopo` e os
   alvos de `senha.redefinir` antes e depois são iguais, e `perfilDeCompatibilidade` devolve o `core.usuario.perfil` de hoje.
2. **Derivação em SQL a partir dos modelos**: `plataforma.modelo_permissao (modelo, chave, nivel, alvos)` gerada do SDK
   (`modelosDePerfil`), com teste que compara as duas fontes; a migração deriva `concessões = modelo(base) − sobreposições
   concedida=false + sobreposições concedida=true`, aplica as travas e grava numa **tabela nova** (ex.:
   `plataforma.perfil_concessao`: `id`, `tenant_id`, `perfil_id`, `chave`, `nivel`, `alvos`, `created_at`, `updated_at`,
   `deleted_at`, `external_id`; RLS; único vivo `(perfil_id, chave)`).
3. **Idempotente**: `on conflict do nothing` pelo único vivo e marca por tenant (`plataforma.catalogo_aplicado` com a versão);
   rodar de novo não duplica nem muda nada.
4. **Reversível**: a fase 1 **não apaga** `perfil.base`, `perfil.fabrica` nem `perfil_permissao`; a API nova mantém `base`
   preenchido com `perfilDeCompatibilidade` em perfil novo ou editado. O `down` recalcula as sobreposições como a diferença entre
   as concessões e o modelo da `base` e apaga a tabela nova. As colunas antigas saem numa fase 2, depois da janela de retorno
   (uma versão inteira do app ou 30 dias, o que vier depois; §2.0).
5. **Diagnóstico antes** (`db/scripts/diagnostico-<n>.sql`): perfis com `cargo ≠ cargo_da_base(base)` (o `POST` atual aceita base
   e cargo independentes), concessões que as travas pelo cargo (§2.5) cortariam e revogações sem efeito. Pela §2.0: perfil sem
   usuários é acertado para o cargo; perfil com usuários fica como está e entra na lista do tenant, tratada caso a caso; revogação
   sem efeito mantém a caixa como o usuário a vê hoje e entra na lista. Nada é cortado em silêncio.
6. **Funções e gatilhos a rever**: `plataforma.perfis_do_usuario` (devolve `cargo` e concessões); a semeadura dos 7 perfis
   (`tenant_semear_perfis`, provisionamento RN-CORE-31) a partir dos modelos; o gatilho de "um admin" (0041) pela gestão do
   acesso; `usuario_tem_perfil_admin` (0047) e a lista do portal pela gestão do acesso + cargo administrativo; a licença do plano
   (0086) pelo cargo; `cargo_da_base` só na migração; zerar empresa (0100) sem mudança de regra. `perfil_modulo` continua por
   código de perfil.
7. **`core.usuario.perfil`**: fica, com o valor derivado (gatilho ou a API ao gravar), até a fase 2.
8. Fixtures e seeds (`dois-tenants.ts`, `demo`) e `idPerfilFabrica` (nome passa a `idPerfilPadrao`).

## 6. Riscos
- **Muitos lugares comparam o nome do perfil** (§1.3, ~70 arquivos). Mitigação: o valor derivado de compatibilidade, o teste de
  equivalência e a regra de lint; cada dono troca os seus usos no próprio PR, em lotes.
- **Chave nova sem fábrica**: sem a concessão automática pelos `cargos` do manifesto, uma ação nova ficaria negada a todos (falha
  fechada silenciosa). Mitigação: o registro `catalogo_aplicado` por tenant e versão e um teste que falha se um tenant ficar atrás
  da versão do catálogo.
- **Administrativo único** em vez de analista/assistente/admin: a derivação de compatibilidade é heurística para perfis
  personalizados de cargo administrativo; vale só na transição e o teste de equivalência cobre os 7 padrão e as fixtures.
- **Apps instalados offline** ainda leem `base`: coberto pelo campo derivado até a versão mínima.
- **Mais poder ao admin do cliente**: ele pode tirar `produto.consultar` de um vendedor ou dar `pedido.ver` ao promotor sem passar
  por parâmetro; é o pedido do dono do produto. As invariantes do §2.5 continuam fora do alcance da caixa.
- **Concorrência de edição** entre dois admins: trava otimista (`atualizado_em`, 409).

## 7. Backlog (só entra com a palavra "backlog" do Alexandre)
- Abrir os apps a outros cargos (ex.: administrativo no Gestão, supervisor no Campo).
- Chaves com nível de "próprio · equipe · qualquer" em pedido e as que a 0033 §1 previa (`cliente.transferir`, `catalogo.exportar`).
- Derivar `perfil_modulo` das chaves marcadas (hoje são duas fontes para "o perfil usa o módulo").
- Fase 2: apagar `perfil.base`, `perfil.fabrica`, `perfil_permissao`, `core.usuario.perfil` e o `perfil` do token.
- Evento `core.perfil.alterado@1`, se algum módulo precisar.

## 8. Alternativas
- **Manter a base escondida** (a tela não mostra, o motor continua com fábrica + sobreposições): contraria "cada perfil é um
  perfil, independente" e mantém o efeito de mudar a fábrica mudar os tenants. Recusada.
- **Travas por combinação de chaves** (ex.: pedido × trade): bloquearia o vendedor que faz trade, que o dono do produto pediu para
  atender; a trava pelo cargo é fixa e verificável. Recusada.
- **Travas por um "tipo" novo no perfil**: o cargo (RN-CORE-53) já é o atributo fixo e obrigatório do perfil. Recusada (uma
  informação, um lugar).
- **Nenhuma trava, só a caixa**: quebraria a regra inegociável 7 e a RN-CORE-33 por um clique. Recusada.
- **Gravar as permissões no JWT**: contraria "vale na próxima requisição" (0033). Recusada.
- **Renomear as chaves por área**: sem ganho, quebra UI, API e testes (0033). Recusada.

## 9. Consequências
- SDK e API (engenheiro-software): §4.1, `verificarAcao` sem `RotaModulo.perfis`, `ctx.usuario.cargo` e `perfil_acesso`,
  barreira da RN-PRO-01 pelo cargo, aplicação do catálogo por versão, lint contra nome fixo.
- Banco (banco-dados): §5.
- Core (modulo-core): CRUD de perfis e catálogo (§4.2), cadastro de usuário sem base, senha e último admin pela gestão do acesso,
  `promotor_ve_pedidos` vira `pedido.ver`.
- Promotor vê pedidos (limitação, Caminho C, R-20261127-165252): o BKO não tem tela para tenant em legado; nele, só se ajusta pela
  API `GET|PUT /v1/core/parametros/promotor-ve-pedidos`. Nos tenants em concessão vale a permissão `pedido.ver` do perfil.
- Catálogo (modulo-catalogo): `promotor_ve_preco_estoque` vira `produto.ver_preco_estoque`.
- Vendedor, Gestor, Pesquisa, Treinamento, Promotor, Integração: trocar comparações de nome de perfil por chave ou cargo (§1.3);
  manifestos com `cargos` no lugar de `perfis`.
- Kit e telas (designer-ux, engenheiro-apps): a tabela (linhas por área, caixa, cadeado com a regra, desabilitada sem licença,
  "sem efeito" pela dependência, nível e alvos na própria linha); sai o "Perfil base", o "Restaurar padrão" e o valor de fábrica.
- Doc 03 (gerente): §3. Doc 02: RF-CORE-03 sem perfil base.
- ADRs 0033 e 0049: nota "revista pela 0073" no cabeçalho e no índice, quando esta for aceita.

## Anexo — permissões por área (as linhas da tabela)
Áreas na ordem de `AREAS_PERMISSAO`. Entre parênteses, o módulo da licença quando não é o Core. Proponho mover para a área certa
algumas ações do Core que hoje caem em "Administração" pela entidade (marcadas com *).
- **Acesso** (onde entra): `acesso.campo`, `acesso.gestao`, `acesso.bko`, `acesso.portal`.
- **Dados**: `dados.escopo` (nível: carteira própria · equipe · equipes abaixo · empresa).
- **Usuários e perfis**: `usuario.ver`, `usuario.criar`, `usuario.editar`, `usuario.desativar`, `usuario.desbloquear`,
  `usuario.filial_editar`, `usuario_avatar.trocar_outro`*, `senha.redefinir` (alvos), `perfil.gerir`, `trajeto.ver_equipe`,
  `ausencia.cadastrar`, `dispositivo.bloquear`*.
- **Clientes**: `cliente.pre_cadastrar`, `cliente.pre_cadastro_recusados`, `cliente.pre_cadastro_corrigir`,
  `cliente.pagamento_editar`, `cliente.filial_editar`, `cliente.aprovar_coordenada`, `carteira.editar`, `cliente_foto.ver`*,
  `cliente_foto.enviar`*, `documento.ver`*, `farol.ver`*, `visita.checkin_fora_de_rota`*, `visita.registrar_gestao`*,
  `visita.dispensar_etapa`*, `rota.editar`*.
- **Pedidos** (vendedor): `pedido.ver`, `pedido.criar`, `pedido.editar`, `pedido.cancelar`, `pedido.excluir`, `pedido.aprovar`,
  `pedido.criar_em_nome`, `alcada.gerenciar`, `transportadora.ver`, `transportadora.gerenciar`, `forma_pagamento.ver`,
  `forma_pagamento.gerenciar`.
- **Catálogo** (catalogo): `produto.consultar`, `produto.ver_preco_estoque`, `produto.perguntar`, `produto.enriquecer`,
  `sinonimo.gerenciar`, `destaque.gerenciar`, `tabela_preco.gerenciar`, `marca.gerenciar`, `parametro.catalogo`,
  `busca.ver_sem_resultado`; do Core: `produto.editar_preco`*, `produto.parametros`*, `medida.gerenciar`*.
- **Trade** (promotor): `coleta.registrar`, `checklist_loja.responder`, `gondola.registrar`, `share.registrar`, `preco.registrar`,
  `ruptura.registrar`, `validade.registrar`, `ponto_extra.registrar`, `concorrencia.registrar`, `tarefa_trade.concluir`,
  `mix_obrigatorio.gerenciar`, `meta_share.gerenciar`, `categoria_gondola.gerenciar`, `concorrente.gerenciar`,
  `foto_referencia.gerenciar`, `checklist_modelo.gerenciar`, `ponto_extra_negociado.gerenciar`, `tarefa_trade.gerenciar`.
- **Pesquisa** (pesquisa): `pesquisa.responder`, `questionario.criar`, `questionario.editar`, `questionario.publicar`,
  `questionario.arquivar`, `resultado.ver`, `resultado.exportar`.
- **Treinamento** (treinamento): `trilha.baixar_offline`, `licao.concluir`, `quiz.responder`, `ranking.ver`, `adesao.ver`,
  `notas.ver`, `trilha.criar`, `trilha.editar`, `trilha.publicar`, `quiz.gerenciar`, `desafio.gerenciar`, `medalha.gerenciar`.
- **Metas e RV**: `meta.ver`, `meta.editar`, `meta.fechar_periodo`, `meta_produtividade.editar`*, `plano_rv.ver`,
  `plano_rv.editar`, `rv.ver`.
- **Gestão da equipe** (gestor): `painel_equipe.ver`, `ranking_equipe.ver`, `fila_aprovacao.ver`, `fila_aprovacao.decidir`,
  `alerta_equipe.ver`, `alerta_equipe.dispensar`, `painel_tenant.ver`, `alerta_regra.gerenciar`.
- **Integração** (integracao): `monitor.ver`, `lote.reprocessar`, `lote.cancelar`, `mapeamento.editar`, `conector.gerenciar`,
  `inativacao.decidir`.
- **Administração**: `modulo.gerir_licencas`, `app.baixar`, `inicio.ver`, `inicio_bko.ver`, `notificacao.enviar`,
  `notificacao.ler`, `notificacao.recado_do_dia`, `dispositivo.registrar_push`, `usuario_avatar.trocar`, `tarefa.criar`,
  `tarefa.editar`, `tarefa.cancelar`, `tarefa.acompanhar`, `tarefa.concluir`, `motivo.editar`, `foto_tipo.editar`,
  `documento.permissoes`, `filial.ver`, `filial.editar`, `frase_dia.editar`, `rastreamento.configurar`,
  `parametro.campos_obrigatorios`, `parametro.campos_obrigatorios_editar`, `parametro.farol`, `parametro.inicio`,
  `parametro.alertas_produtividade`, `parametro.curva_abc`, `parametro.checkout_pendencia`.
  `parametro.promotor_ve_pedidos` sai (vira `pedido.ver` no perfil, §2.4).

Cadeados na tabela (§2.5): escrita de pedido em perfil de cargo promotor (RN-PRO-01); `acesso.bko` e `acesso.portal` nos cargos
vendedor, promotor e supervisor (RN-CORE-33); `acesso.portal` sem a gestão do acesso; `acesso.campo` fora de vendedor/promotor e
`acesso.gestao` fora de supervisor/gerente; nível de `dados.escopo` acima do teto do cargo (RN-CORE-04); chave de módulo sem
licença (RN-CORE-02, desabilitada); a gestão do acesso no próprio perfil de quem a tem (RN-CORE-35).
