# Filial de cadastro e filiais de venda do usuário — proposta (T-0176, RN-CORE-39)

Status: PROPOSTA, sem código. Base: R-20261115-093000 (substitui "vendedor = 1 filial"). Código atual: aed792d/df8cf17 (`validarFiliaisDoUsuario`, `filial_ids`, `sem_filial`, `core.filiais_do_usuario@1`); banco: 0077 (branch `nuvem/filial-usuario-banco-dados`). Nada disso está no `main`.

## 1. Modelo
- `core.usuario.filial_cadastro_id uuid null` (nulo = bloqueado). FK composta `(tenant_id, filial_cadastro_id)` para `core.filial`; índice `(tenant_id, filial_cadastro_id)` vivo ("usuários da filial", trava de inativar filial).
- `core.usuario_filial` **vira a tabela das filiais de VENDA** (mesma estrutura, RLS e índices da 0077). Só muda o significado.
- A de cadastro **conta como venda por padrão**: ao gravar a de cadastro, se a lista de venda estiver vazia, a API grava a de cadastro como venda. Depois o admin pode trocar a lista, mesmo sem incluir a de cadastro. Justificativa: quem vende na própria base não precisa de passo extra, e o Catálogo nunca fica sem filial. A lista de venda não é espelho: a de cadastro não entra sozinha depois de gravada.
- Mudanças na 0077 (pedido ao banco-dados): o número 0077 fica (nada no main). Saem os gatilhos e funções "máximo 1 para vendedor" (`usuario_filial_travar`, `conferir_filial_vendedor`, `filial_vendedor_conferir` e os 4 gatilhos adiados). Entram a coluna `filial_cadastro_id` em `core.usuario`, a FK e o índice acima. Sem backfill: todo usuário existente nasce sem filial de cadastro e fica bloqueado até a carga do ERP ou o BKO. Down: remove a coluna e a tabela.

## 2. Contrato (tudo aditivo; nada está no main)
- **Sync `usuario`** (`UsuarioSync`): `filial_cadastro_id: uuid|null` e `filial_venda_ids: uuid[]`; mantém `sem_filial: boolean` (= cadastro nula). Saem `filial_id` e `filial_ids` de df8cf17.
- **Sessão** (`UsuarioSessao`): `filial_cadastro_id`, `filial_venda_ids`, `sem_filial`. O app mostra a de cadastro na tela principal.
- **Consulta do Catálogo**: manter `core.filiais_do_usuario@1`, aditivo e sem versão nova, porque ela não foi publicada no main. Saída: `{ filial_cadastro_id: uuid|null, filial_venda_ids: uuid[], sem_filial: boolean }`; o campo `filial_ids` de df8cf17 é renomeado para `filial_venda_ids`. Catálogo usa `filial_venda_ids` para preço, estoque, filtro e folha; `filial_cadastro_id` só para exibição. Se o Catálogo já consome `filial_ids` num PR aberto, ele ajusta junto (ordem em 6). Se alguma versão publicada já usou `filial_ids`, vira `@2` com ADR.
- **Renomear sem versão nova: confirmado**, pois `filial_id`, `filial_ids` e `FilialIdsSchema` só existem nos commits do branch. `filial_id` do cliente (T-0149) não muda, é outro conceito.
- **API de Usuários**: criar e editar recebem `filial_cadastro_id` e `filial_venda_ids`; a leitura devolve ambos mais `sem_filial`.

## 3. Bloqueio (todo perfil, sem exceção)
- **Login**: autentica e devolve a sessão com `sem_filial: true`. O app abre só a tela de bloqueio. Código `USUARIO_SEM_FILIAL`; mensagem provisória: "Seu usuário está sem filial. Peça ao administrador para informar a filial." (a frase final vem da simulação). Rotas de dados do app respondem 403 `USUARIO_SEM_FILIAL`, exceto logout e sessão.
- **Admin/analista** cadastram usuário sem filial e entram no BKO normalmente: o bloqueio vale para o app e para as rotas de campo; o BKO continua usável por eles para poderem corrigir. Pergunta 1.
- **Lista do BKO**: filtro "Sem filial" na URL (`?sem_filial=1`) e selo na linha.
- **Aviso ao admin**: contagem de usuários vivos e ativos sem filial de cadastro no card de pendências do início do BKO, com link para o filtro (uma informação, um lugar).
- **Sync de quem já está logado**: o pull de `usuario` traz `sem_filial: true`; no próximo sync o app troca para a tela de bloqueio, sem apagar o que está na outbox (envia o que já existe). Ao receber a filial, volta ao normal no sync seguinte.

## 4. Tela de Usuários (BKO)
- Campos: **Filial de cadastro** (seleção única, obrigatória) e **Filiais de venda** (seleção múltipla, mínimo 1; preenchida com a de cadastro enquanto o admin não mexer).
- Validações 422: `USUARIO_FILIAL_CADASTRO_OBRIGATORIA` (cadastro ausente ou nula ao criar; ao editar, só se tentar zerar); `USUARIO_FILIAL_INVALIDA` (inexistente, excluída ou de outro tenant, em qualquer dos campos); `USUARIO_FILIAL_VENDA_VAZIA` (lista de venda vazia ao salvar). 403 `USUARIO_FILIAL_SEM_PERMISSAO` para quem não é admin/analista.
- Edição: só admin e analista (`PERFIS_QUE_EDITAM_FILIAL`). Os demais perfis veem e não editam. A API revalida.
- Domain: `validarFiliaisDoUsuario` passa a `validarFilialCadastro` e `validarFiliaisDeVenda`; `vendedorBloqueadoPorFilial` passa a `usuarioBloqueadoPorFilial({ filial_cadastro_id })`, sem olhar o cargo. Visual e textos: designer-ux.
- Evento: `core.usuario.atualizado` não existe hoje; a troca de filial só vai pelo sync (`updated_at` do usuário e da venda acompanham). Sem evento novo.

## 5. Carga do ERP (vendedor.csv, kit 1.0.5)
- `filial_external_id` grava `filial_cadastro_id` (resolve por `external_id` da filial do tenant).
- Coluna ausente ou vazia: não altera (nem zera o que o BKO definiu). Preenchida com filial inexistente: erro de linha `FILIAL_INEXISTENTE`, a linha do vendedor não é rejeitada para os demais campos? Proposta: rejeita só a filial e registra o erro; o vendedor segue sem filial se era novo.
- Filiais de venda na carga: se a lista de venda do usuário estiver **vazia**, recebe a de cadastro (mesma regra do BKO). Se já tem lista, a carga não toca nela.
- Consumidor `consumidores-erp.ts` deixa de gravar `usuario_filial` como filial única e passa a gravar a coluna.

## 6. Impacto e ordem
1. **banco-dados**: ajusta a 0077 (seção 1), dicionário `docs/banco/core.md` e `db/testes/usuario-filial.db.test.ts`.
2. **modulo-core**: `contracts` (filial-usuario, sync, auth, filial, usuarios), `domain`, `api` (usuarios, filiais, filiais-usuario, autenticacao, sync, consumidores-erp, guarda 403 de bloqueio), `manifest.ts`, testes `filial-usuario*.test.ts`, `filiais.test.ts`, `licencas.test.ts`; depois app (tela de bloqueio, filial na principal) e web (Usuários), após a simulação.
3. **modulo-catalogo**: troca `filial_ids` por `filial_venda_ids` na chamada da consulta; filtro, preço e estoque usam as de venda. Recado com cópia ao engenheiro-software.
4. **modulo-integracao** (Hub, PR #330): confirma que `filial_external_id` do vendedor.csv chega ao `core.usuario` pelo consumidor do Core; sem mudança de arquivo se o evento já carrega o campo.
5. **designer-ux**: simulação do bloqueio e dos dois campos. **testes**: roteiro do bloqueio por perfil.
- Ordem: banco (0077) → contratos e domain do Core → API → Catálogo e Hub → telas.
- Testes: um `it('RN-CORE-39: ...')` por regra (cadastro obrigatória, venda mínimo 1, cadastro vira venda por padrão, bloqueio em qualquer perfil, carga ausente/inexistente/vazia).

## 7. Perguntas ao dono do produto
1. Admin e analista sem filial também ficam bloqueados no BKO, ou só nos apps de campo e gestão?
2. A filial de cadastro entra automaticamente nas de venda e pode ser removida delas (proposta), ou deve ser sempre de venda?
3. Na carga do ERP, a filial inexistente rejeita a linha inteira do vendedor ou só a filial?
4. Troca da filial de cadastro de quem já tem pedidos e clientes: os dados antigos ficam na filial antiga (proposta)?
5. Quem hoje tem 1 filial em `usuario_filial` (se houver em algum ambiente) vira de cadastro automaticamente, ou todos partem de zero (proposta: zero, sem backfill)?
