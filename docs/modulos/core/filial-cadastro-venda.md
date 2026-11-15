# Filial de cadastro e filiais de venda do usuário — proposta (T-0176, RN-CORE-39)

Status: APROVADA e IMPLEMENTADA (R-20261115-094500; T-0176). Base: R-20261115-093000 (substitui "vendedor = 1 filial"). Banco: 0077 (no `main`). API, contratos e tela de Usuários: PR #361 (v1.0.12).

## 1. Modelo
- `core.usuario.filial_cadastro_id uuid null` (nulo = bloqueado). FK composta `(tenant_id, filial_cadastro_id)` para `core.filial`; índice `(tenant_id, filial_cadastro_id)` vivo ("usuários da filial", trava de inativar filial).
- `core.usuario_filial` **vira a tabela das filiais de VENDA** (mesma estrutura, RLS e índices da 0077). Só muda o significado.
- **A filial de cadastro FAZ PARTE da lista de venda** (resposta 2 do dono): invariante do banco, gatilho adiável `usuario_filial_inclui_cadastro` (23514; a API o antecipa com `set constraints … immediate`). A API grava cadastro e venda na mesma transação e inclui a de cadastro na de venda se faltar; o 23514 vira 422 `USUARIO_FILIAL_VENDA_SEM_CADASTRO`. Na tela a de cadastro aparece marcada como "padrão" e travada. A lista de venda não tem limite por cargo.
- Mudanças na 0077 (pedido ao banco-dados): o número 0077 fica (nada no main). Saem os gatilhos e funções "máximo 1 para vendedor" (`usuario_filial_travar`, `conferir_filial_vendedor`, `filial_vendedor_conferir` e os 4 gatilhos adiados). Entram a coluna `filial_cadastro_id` em `core.usuario`, a FK e o índice acima. O backfill é do banco-dados (0077, resposta 5 do dono); o bloqueio vale para quem ficar sem filial de cadastro. Down: remove a coluna e a tabela.

## 2. Contrato (aditivo)
- **Sync `usuario`** (`UsuarioSync`): `filial_cadastro_id: uuid|null`, `filial_venda_ids: uuid[]` e `sem_filial: boolean`. Saíram `filial_id` e `filial_ids` (nunca foram ao main nem a um APK publicado). `updated_at` da linha = o maior entre o do usuário e o do último vínculo de venda, então a troca de filial chega ao aparelho.
- **Sessão** (`UsuarioSessao`): `filial_cadastro_id`, `filial_venda_ids`, `sem_filial` (qualquer perfil).
- **Consulta `core.filiais_do_usuario@1`** (mesma versão, não publicada): saída `{ filial_cadastro_id: uuid|null, filial_venda_ids: uuid[], sem_filial: boolean }`. O Catálogo usa `filial_venda_ids` (preço, estoque, filtro, folha); `filial_cadastro_id` é só para exibir.
- **API de Usuários**: criar e editar recebem `filial_cadastro_id` + `filial_venda_ids` (a API inclui a de cadastro na de venda); a leitura devolve os dois mais `sem_filial`. `filial_cadastro_id` é obrigatório ao criar (422 `USUARIO_FILIAL_CADASTRO_OBRIGATORIA`); ao editar, ausente = mantém.
- **Rota nova** `GET|PUT /v1/core/eu/filial-cadastro` (seção 3).
- **Erros**: 422 `USUARIO_FILIAL_CADASTRO_OBRIGATORIA`, `USUARIO_FILIAL_VENDA_VAZIA`, `USUARIO_FILIAL_VENDA_SEM_CADASTRO`, `USUARIO_FILIAL_INVALIDA`; 403 `USUARIO_FILIAL_SEM_PERMISSAO` e `USUARIO_SEM_FILIAL`; 409 `USUARIO_FILIAL_JA_INFORMADA`.

## 3. Bloqueio (todo perfil, sem exceção)
- **Login**: autentica e devolve a sessão com `sem_filial: true`. O app abre só a tela de bloqueio. Código e texto: `CODIGO_USUARIO_SEM_FILIAL` e `MENSAGEM_USUARIO_SEM_FILIAL` do `platform-sdk` (fonte única). Rotas de dados do app respondem 403 `USUARIO_SEM_FILIAL`, exceto logout e sessão.
- **Destravamento do admin** (resposta 1 do dono: todos precisam de filial, inclusive admin e analista, também no BKO). Quem está sem filial recebe 403 `USUARIO_SEM_FILIAL` em todas as rotas do Core, **exceto** `GET /v1/core/eu/filial-cadastro` (estado, e a lista de filiais para escolher, só a quem pode informar) e `PUT /v1/core/eu/filial-cadastro` (`{ filial_cadastro_id }`, ação `ACAO_FILIAL_USUARIO_EDITAR`, superfície BKO). O PUT só serve a admin e analista sem filial: grava a PRÓPRIA filial de cadastro, inclui na de venda, audita (`usuario.filial_cadastro_propria`) e a empresa não trava, porque o BKO abre só a tela que pede a filial. Os demais perfis esperam o admin (403 `USUARIO_FILIAL_SEM_PERMISSAO`); quem já tem filial leva 409 (a troca é do cadastro de usuários). Seguro: a rota só grava o próprio usuário, só uma vez, com filial viva do tenant (RLS), e fica auditada.
- **Outros módulos e `/sync`**: a guarda global da plataforma (ADR 0056) dá o mesmo 403 em toda rota autenticada; o pull do bloqueado só entrega a entidade `usuario`.
- **Lista do BKO**: filtro "Sem filial" na URL (`?filial=sem`, `FILTRO_FILIAL_SEM`) e selo na linha.
- **Aviso ao admin**: contagem de usuários vivos e ativos sem filial de cadastro no aviso no topo de Usuários, com link para o filtro (uma informação, um lugar).
- **Sync de quem já está logado**: o pull de `usuario` traz `sem_filial: true`; no próximo sync o app troca para a tela de bloqueio, sem apagar o que está na outbox (envia o que já existe). Ao receber a filial, volta ao normal no sync seguinte.

## 4. Tela de Usuários (BKO)
- Campos: **Filial de cadastro** (seleção única, obrigatória) e **Filiais de venda** (seleção múltipla, mínimo 1; preenchida com a de cadastro enquanto o admin não mexer).
- Validações 422: `USUARIO_FILIAL_CADASTRO_OBRIGATORIA` (cadastro ausente ou nula ao criar; ao editar, só se tentar zerar); `USUARIO_FILIAL_INVALIDA` (inexistente, excluída ou de outro tenant, em qualquer dos campos); `USUARIO_FILIAL_VENDA_VAZIA` (lista de venda vazia ao salvar). 403 `USUARIO_FILIAL_SEM_PERMISSAO` para quem não é admin/analista.
- Edição: só admin e analista (`PERFIS_QUE_EDITAM_FILIAL`). Os demais perfis veem e não editam. A API revalida.
- Domain: `validarFiliaisDoUsuario({ cadastro, venda })`, `filiaisDeVendaComCadastro` e `usuarioBloqueadoPorFilial({ filial_cadastro_id })`, sem olhar o cargo; `vendedorBloqueadoPorFilial` saiu. Visual e textos: designer-ux.
- Evento: `core.usuario.atualizado` não existe hoje; a troca de filial só vai pelo sync (`updated_at` do usuário e da venda acompanham). Sem evento novo.

## 5. Carga do ERP (vendedor.csv, kit 1.0.5)
- `filial_external_id` grava `filial_cadastro_id` (resolve por `external_id` da filial do tenant) e a inclui na lista de venda; as outras de venda ficam.
- Coluna ausente ou vazia: não altera. Filial inexistente (resposta 3): o vendedor entra SEM filial, bloqueado, e o erro `FILIAL_INEXISTENTE` vai ao log do Monitor só com os códigos do ERP, sem dado pessoal.
- Os demais campos do vendedor seguem normalmente.
- O consumidor `consumidores-erp-vendedor.ts` grava a coluna, não mais `usuario_filial` como filial única.

## 6. Impacto e ordem
1. **banco-dados**: ajusta a 0077 (seção 1), dicionário `docs/banco/core.md` e `db/testes/usuario-filial.db.test.ts`.
2. **modulo-core**: `contracts` (filial-usuario, sync, auth, filial, usuarios), `domain`, `api` (usuarios, filiais, filiais-usuario, autenticacao, sync, consumidores-erp, guarda 403 de bloqueio), `manifest.ts`, testes `filial-usuario*.test.ts`, `filiais.test.ts`, `licencas.test.ts`; depois app (tela de bloqueio, filial na principal) e web (Usuários), após a simulação.
3. **modulo-catalogo**: troca `filial_ids` por `filial_venda_ids` na chamada da consulta; filtro, preço e estoque usam as de venda. Recado com cópia ao engenheiro-software.
4. **modulo-integracao** (Hub, PR #330): confirma que `filial_external_id` do vendedor.csv chega ao `core.usuario` pelo consumidor do Core; sem mudança de arquivo se o evento já carrega o campo.
5. **designer-ux**: simulação do bloqueio e dos dois campos. **testes**: roteiro do bloqueio por perfil.
- Ordem: banco (0077) → contratos e domain do Core → API → Catálogo e Hub → telas.
- Testes: um `it('RN-CORE-39: ...')` por regra (cadastro obrigatória, venda mínimo 1, cadastro vira venda por padrão, bloqueio em qualquer perfil, carga ausente/inexistente/vazia).

## 7. Decisões do dono do produto (R-20261115-094500)
1. Todos precisam de filial de cadastro, inclusive admin e analista, no BKO também: destravamento na seção 3.
2. A de cadastro faz parte da lista de venda, marcada "padrão" (travada na tela).
3. Carga com filial inexistente: o vendedor entra sem filial, bloqueado, com erro no Monitor.
4. Pedidos antigos ficam na filial antiga.
5. O backfill na 0077 é do banco-dados, em paralelo.
