# v1.0.40 — revisão final de engenharia da E5 e da E6 dos perfis (ADR 0073)

Revisor: `engenheiro-software`, em 27/11/2026, horário de Manaus. Sessão S18. Base: `origin/main` @ `cc78a5fd`.
Cada PR foi avaliado pelo próprio diff contra a sua base, no head exato abaixo. O item 2 é deste revisor e não foi revisado:
só conferi como os itens 1, 3, 5 e 6 se encaixam com ele (contrato, ordem de deploy e motor).

Legenda: 🔴 bloqueia · 🟡 corrigir · 🟢 sugestão.

## Resumo

| # | PR / branch | Dono | Head | Parecer |
|---|---|---|---|---|
| 1 | `nuvem/v1040-banco-dados-perfis` (0109) | banco-dados | `41112e46` | 🔴 1 · 🟡 0 · 🟢 2 |
| 2 | `nuvem/v1040-engenheiro-software-perfis` (motor) | engenheiro-software | `37d2417b` | não revisado (autor); 🔴 de processo (P1) |
| 3 | `nuvem/v1040-modulo-core-perfis-api` (rotas V2) | modulo-core | `3c4ac6a4` | 🔴 2 (um é de processo, P1) · 🟡 3 · 🟢 1 |
| 4 | #853 `nuvem/v1040-designer-ux-perfis` (kit) | designer-ux | `75a3813b` | 🟢 sem achado |
| 5 | #854 `nuvem/v1040-modulo-core-perfis` (tela) | modulo-core | `429e0062` | 🔴 1 de processo (P1) · sem achado de código |
| 6 | `nuvem/v1040-designer-ux-perfis-limpeza` | designer-ux | `adbdbfdc` | 🟢 sem achado (só depois do #854) |

O que rodei na sessão (Postgres 16 local, sem Docker):
- `db`: `perfis-leitura-concessao.db.test.ts` e `estatico.test.ts` (446 verdes);
- `apps/api`: `perfis-motor.banco.test.ts` no head do item 2 (9 verdes);
- `modules/core` no `3c4ac6a4`: `perfis-v2(.db).test.ts`, `promotor-pedidos.db.test.ts`, `promotor-historico.db.test.ts` e `perfis-cargo.test.ts` (79 verdes);
- `modules/core` no `429e0062`: `web/lib` (296 verdes) e `tsc --noEmit` limpo;
- `tests/modulos/pedidos-busca-t0077.test.ts` no `3c4ac6a4`: 1 vermelho (achado 3.R1).

## 1. banco-dados — 0109 @ `41112e46`

Conferi o seguinte, e está certo:
- **§4.1**: sem conflito `para_tenant`, a conferência roda usuário por usuário, e uma linha `DIFERENCA` aborta tudo com 23514 (`perfis_sem_base_conferencia`).
- **Idempotência**: `ja_ligado` sai cedo. O tenant `parado` repete a derivação sem mudar linha, com a trava do tenant.
- **Down §4.3**: comparei bloco a bloco as 6 funções recriadas com a origem. `usuario_admin_com_gestao`, `tenant_tem_admin_com_gestao` e `perfis_do_usuario` (0041), `usuario_tem_perfil_admin` (0047), `licencas_em_uso` (0086) e `tenant_semear_concessoes` (0108) estão **iguais**, com as mesmas ACLs. As 4 funções novas saem.
- **RLS e grants**: as funções novas são INVOKER, com `search_path` fixo e EXECUTE só do `macuxi_app`; `ligar_leitura_por_concessao` não dá EXECUTE a ninguém. O gatilho novo é SECURITY DEFINER, como os da 0049.
- **Contrato**: `perfis_do_usuario` mantém as colunas de antes e acrescenta as novas no fim, então a API da v1.0.39 continua lendo durante a janela.
- **`sa_*` e kit do Conector** não mudam.
- **Desempenho**: está dentro do §7.1 (dezenas de tenants, uma transação). O `diagnostico-0109.sql` é só leitura.

🔴 **1.R1 — o último admin escapa no tenant em `concessao`** (RN-CORE-35, ADR 0073 §2.5 decisão 4)
- **Onde está o furo**: a 0109 passa a contar como admin quem tem a gestão do acesso pelas concessões, de qualquer cargo ou base (`usuario_admin_com_gestao`, `0109…up.sql:105`). Os 3 gatilhos que disparam a conferência continuam com o filtro `p.base = 'admin'` da 0041:
  - `usuario_conferir_acesso` (`0041…up.sql:420`), quando o usuário é desativado ou apagado;
  - `usuario_perfil_conferir` (`:456`), quando sai um vínculo;
  - `perfil_conferir` (`:497`), quando o perfil é desativado ou apagado.
- **Efeito**: se a gestão estiver num perfil de base `gerente` ou `analista`, desativar o último usuário com gestão passa sem 23514.
- **Reproduzido**: no Postgres local, numa transação desfeita, liguei o tenant Alfa e dei a gestão completa ao `analista`. Tirei `perfil.gerir` do `admin` (passou, como deve) e desativei o usuário do `analista`. Resultado: `tenant_tem_admin_com_gestao = f` e nenhum erro.
- **Quando acontece em produção**: logo que a rota V2 (item 3) deixar gravar a gestão num perfil que não é admin. O próprio teste da 0109 aceita "um gerente com a gestão".
- **Correção, agora, porque a 0109 não muda depois do PR**:
  - recriar os 3 gatilhos na 0109 com o filtro `p.base = 'admin' or plataforma.leitura_de_perfis(<tenant>) = 'concessao'`. No 'concessao' vale também um filtro mais fino: o perfil tem alguma chave da gestão viva;
  - manter `security definer` explícito, porque o `create or replace` sem ele volta para INVOKER e desfaz a 0049;
  - no down, voltar às cópias exatas da 0041 com o `security definer` da 0049;
  - teste: desativar o usuário, tirar o vínculo e desativar o perfil do único gestor que não é admin dá 23514 no COMMIT.

🟢 **1.S1** — No `concessao`, `tenant_tem_admin_com_gestao` (`0109…up.sql:140`) chama `concessoes_do_perfil` para cada vínculo do tenant até achar um admin. Com a 1.R1, ela roda a cada desativação. Um filtro prévio deixa o custo perto do legado: `exists (perfil_concessao 'perfil.gerir' viva do perfil)` antes da agregação.

🟢 **1.S2** — Rodar o `db/scripts/diagnostico-0109.sql` numa cópia de produção antes do `producao-publicar`. Uma `DIFERENCA` aborta a 0109 inteira, e o deploy para antes da API, o que é o lado seguro. Melhor saber antes.

## 2. engenheiro-software — motor @ `37d2417b` (não revisado; encaixe)

- **Contrato com a 0109**:
  - o motor lê `plataforma.perfil_do_usuario` (perfil_id, codigo, nome, cargo, base, leitura, permissoes) e `perfis_do_usuario` com as colunas novas no fim. Os nomes e os tipos batem com a 0109;
  - o item 3 lê `permissoes_efetivas_do_perfil` e `perfil_do_usuario`, que também existem na 0109.
- **Motor**: no `concessao` decide a concessão (`perfil_acesso` e `cargo`); no `legado` decidem a base e as sobreposições. É o mesmo corte que o item 3 usa (`leitura_de_perfis`, 422 `PERFIS_NAO_MIGRADOS`).
- **Pendência do autor (P1)**: o branch leva o commit `41112e46` da banco-dados. Veja a seção "Processo".

## 3. modulo-core — rotas V2 @ `3c4ac6a4`

Conferi o seguinte, e está certo:
- **Fronteiras**: só `@macuxi/platform-sdk`, `../contracts` e `../domain`.
- **Contratos Zod `.strict()`**: `so_bko`, `autogestao`, modelos e histórico com `mudancas`.
- **Toda rota**: `superficie: 'bko'`, ação do manifesto (`perfil.gerir`), `carteira: 'nao_se_aplica'` e licença pelo `definirModuloApi`.
- **POST**: idempotente pelo id do aparelho (teste de corrida verde).
- **Edição**: trava otimista (`conferirTravaOtimista`, 409).
- **Tenant em `legado`**: 422 `PERFIS_NAO_MIGRADOS` antes de travar e carregar. A leitura vai pelo caminho duplo, nunca pela tabela.
- **Códigos de rota**: `modelos` e `opcoes` não viram código de perfil.
- **Histórico**: isolado pela RLS (teste do tenant B = 404).

🔴 **3.R1 — o `main` fica vermelho na suíte de `tests/`**
- **O que quebra**: `tests/modulos/pedidos-busca-t0077.test.ts:989` confere o texto literal `abasDaFicha(ctx.usuario.perfil, ctx.usuario.perfil !== 'promotor' || (await lerPromotorVePedidos(db)))…` em `modules/core/api/cliente360-v2.ts`. O item 3 trocou esse trecho por `usuarioVePedidos(ctx, db)`.
- **Prova**: rodei no head, e deu 1 vermelho em 58.
- **Por que não aparece antes**: o CI do PR não roda `tests/`, mas o `producao-liberar` roda e para a versão.
- **Dono da correção**: `testes`. A asserção precisa apontar para `usuarioVePedidos` e entrar no mesmo lote, antes do `producao-liberar`.

🔴 **3.R2 (P1)** — O branch leva o commit `41112e46` da banco-dados. Veja a seção "Processo".

🟡 **3.A1 — `usuario-perfis.ts:48` confere o tenant pelo modelo de hoje**
- **O que acontece**: `conferirPerfisDoUsuario` usa `carregar` de `perfis.ts`, que lê base e `perfil_permissao`, também no tenant em `concessao`.
- **Por que está errado**: depois de uma edição V2, as sobreposições ficam velhas, porque a V2 grava `perfil_concessao`. Então o último admin e a autogestão do cadastro de usuário decidem pelo estado errado:
  - recusa falsa, por exemplo ao desativar o antigo admin de base quando a gestão já está em outro perfil;
  - ou aceite que só o banco segura, e o banco hoje não segura (1.R1).
- **Correção**: no `concessao`, montar o estado pelas concessões (`validarAcessoPeloCargo`, como na V2).

🟡 **3.A2 — `soValeNoBko` (`domain/perfis-cargo.ts:82-89`) é uma lista fixa de cerca de 30 chaves, inclusive de outros módulos**
- **Exemplos de outros módulos**: `conector.gerenciar`, `mapeamento.editar` e `plano_rv.editar`, além dos prefixos `parametro.` e `.gerenciar`.
- **Por que corrigir**: a superfície de uma ação é dado do manifesto de quem a declara. A lista no domain do Core fica velha a cada ação nova e repete o que pertence a outro módulo.
- **Não bloqueia**: é só o aviso "Sem efeito" da tela; o acesso é decidido pela API.
- **Correção em duas partes**:
  - `engenheiro-software` acrescenta `superficie?: 'bko' | 'app' | 'ambos'` em `DefinicaoChave` e no `acoes` do manifesto (SDK);
  - `modulo-core` passa a ler `d.superficie === 'bko'` e apaga a lista.
- Fica como pendência registrada da v1.0.41.

🟡 **3.A3 — `usuarioVePedidos` (`api/promotor-pedidos.ts:25`) diverge do aparelho no tenant em `concessao`**
- **Na API**: quem decide é `pedido.ver` da concessão.
- **No app**: quem decide é o parâmetro do tenant, pela consulta `core.promotor_ve_pedidos@1` e pelo parâmetro sincronizado. O cartão "Promotor vê pedidos" saiu do BKO, então o parâmetro fica congelado.
- **Efeito**: ligar ou desligar `pedido.ver` no perfil muda o que a API manda, mas não o que o app mostra. Não há vazamento: o app esconde mais ou mostra abas vazias.
- O próprio `docs/modulos/core/promotor-ve-pedidos.md` já marca essa pendência.
- **Correção**: derivar do `pedido.ver` do perfil o valor que o aparelho recebe.

🟢 **3.S1** — `clientes.ts:95`: `perfilRecebeHistoricoDeCompra('promotor', …)` passa `'promotor'` fixo para todo perfil. O resultado está certo, porque `usuarioVePedidos` devolve `true` fora do promotor, mas a leitura engana. Prefira `const comHistorico = await usuarioVePedidos(ctx, db)`.

## 4. designer-ux — kit @ `75a3813b` (#853)

🟢 Sem achado:
- o diff é aditivo: `tabela-permissoes(.tsx|-estado.ts)` com teste, e o kit antigo fica;
- não há regra de negócio no kit, só contagem, tri-estado e busca;
- não importa `modules/*`;
- todos os commits são da designer-ux.

## 5. modulo-core — tela @ `429e0062` (#854)

Sem achado de código. O encaixe com o item 3 está certo:
- a tela usa `so_bko`, `autogestao`, `GET perfis/modelos`, o histórico com `mudancas` e o 422 `PERFIS_NAO_MIGRADOS` (`ehNaoMigrado` lê `code`, que `lerCorpoDeErro` preenche a partir de `codigo`);
- o PUT manda o conjunto inteiro com `atualizado_em` e não manda as chaves travadas pelo cargo; a API revalida.

🔴 **5.R1 (P1)** — O branch leva commits da banco-dados (`41112e46`) e da designer-ux (`9da50153`, `4fd49d4b`, `907528d6` e `75a3813b`). Também tem dois merges sem trailer (`49c6a975` e `1b1fc4f7`), que o CI ignora. Veja a seção "Processo".

## 6. designer-ux — limpeza @ `adbdbfdc`

🟢 Sem achado:
- as exportações removidas de `packages/ui/src/web/{perfis.ts,permissoes.tsx}` não têm uso fora de `packages/ui` no `429e0062`;
- no `origin/main` de hoje elas ainda são usadas por `modules/core/web/components/perfis/perfis-page.tsx` e `modules/core/web/lib/perfis.ts`. Então este PR só pode entrar **depois do #854**; antes disso, quebra o typecheck do Core;
- todos os commits são da designer-ux.

## Processo

🔴 **P1 — um merge do `main` não basta para os itens 2, 3 e 5**
- **A causa**: o squash do item 1 cria no `main` um commit novo, de SHA diferente. O `41112e46` original continua fora do histórico do `main`.
- **Quem lê esse intervalo**: o `verificar` (`coord-lib.mjs:712`, `git log --no-merges <base>..HEAD`) e o `agente-do-branch` (`HEAD^1..HEAD^2`). Os dois continuam vendo o commit da banco-dados depois do merge.
- **Simulação**: fiz o squash da 0109 sobre o `origin/main`, depois o merge no `3c4ac6a4`, e rodei `GITHUB_HEAD_REF=nuvem/v1040-modulo-core-perfis-api node scripts/coord.mjs verificar --base <squash>`. Resultado: `agente ambíguo: banco-dados, modulo-core`. Os arquivos ficam limpos, mas o CI fica vermelho.
- **Correção**, sem force push:
  - depois do merge de cada antecessor, o dono cria um branch novo a partir do `origin/main` e leva só os próprios commits com `cherry-pick` (um commit por PR), num PR novo;
  - item 2: `37d2417b`;
  - item 3: `3c4ac6a4`;
  - #854: `908fc0c1` e `6d833efb`, conferindo que o merge `429e0062` não traz ajuste próprio;
  - o #854 antigo e o branch antigo são fechados.
- **Quem não precisa**: o item 6 só tem commits da designer-ux, então basta um merge do `main` depois do #853.

**Ordem de merge** (confirmada): 0109 → item 2 (motor) → item 3 (rotas V2) → #853 → #854 → limpeza.
- **0109 antes do item 2**: o item 2 lê `perfil_do_usuario`.
- **Item 2 antes do item 3**: sem o motor por concessão, o que a V2 grava em `perfil_concessao` não autorizaria nada na API.
- **#853 antes do #854**: o #854 usa o kit.
- **#854 antes da limpeza**: a limpeza tira as exportações que a tela antiga ainda usa.
- Com a 1.R1 corrigida, a 0109 entra sozinha sem deixar o `main` vermelho: os testes de banco rodaram verdes e o `perfis-motor.banco.test.ts` também.

**Ordem de deploy**:
- **Antes de tudo**: a 0109 roda primeiro no `producao-publicar`.
- **Janela 0109 → API nova**: a API v1.0.39 continua certa no tenant em `concessao`:
  - as rotas antigas gravam `perfil_permissao`;
  - o espelho da 0107 refaz as concessões;
  - as colunas de antes de `perfis_do_usuario` não mudaram;
  - a conferência garante o mesmo acesso nos dois caminhos.
- **Mesma imagem**: o item 3 e o #854 saem juntos na v1.0.40. Entre um e outro, a tela antiga chamaria os caminhos V2 com o contrato velho. Não se libera um SHA do `main` que esteja entre os dois.
- **Volta**: primeiro a API e o Core da v1.0.39, depois o down da 0109, como está no cabeçalho do down.

## Encaminhamento (recados)

- **banco-dados**: 1.R1, que precisa entrar na 0109 antes do PR; 1.S1 e 1.S2.
- **modulo-core**:
  - 3.R2 e 5.R1 (P1): branches novos a partir do `origin/main`;
  - 3.A1, 3.A2 (a parte do Core), 3.A3 e 3.S1.
- **testes**: 3.R1, a asserção de `tests/modulos/pedidos-busca-t0077.test.ts:989`.
- **engenheiro-software** (pendências minhas):
  - P1 no item 2, com branch novo depois da 0109;
  - 3.A2, o campo `superficie` no SDK, na v1.0.41.
- **gerente-projetos**: ordem e janela de deploy acima. O item 6 só depois do #854.

---

# Revisão final da E5 — #853 e #854 (2ª rodada)

Revisor: `engenheiro-software`, 27/11/2026, por volta de 09h25 (Manaus). Sessão S18. Base: `origin/main` @ `cc78a5fd`.

| PR | Dono | Head | Parecer |
|---|---|---|---|
| #853 `nuvem/v1040-designer-ux-perfis` | designer-ux | `75a3813b` | 🟢 confirmado (mesmo SHA da 1ª rodada, só commits da designer-ux, base `cc78a5fd`) |
| #854 `nuvem/v1040-modulo-core-perfis` | modulo-core | `183638eb` | código sem 🔴 · 🔴 P1 de processo (resolvido pelo cherry-pick abaixo) · 🟡 1 baixo (lote seguinte) · 🟢 2 |

Escopo: `5785a719` (rotas V2, sobre `3c4ac6a4`), o merge `8cb4d518` e `183638eb` (tela, sobre `429e0062`).
O merge `8cb4d518` traz só o `5785a719`, sem ajuste próprio: são os mesmos 7 arquivos, com +84 e −26.

O que rodei no `183638eb`:
- `tsc --noEmit` do `modules/core`: limpo;
- `vitest` de `domain`, `web/lib`, `api/perfis-v2.test` e `api/promotor*`: 1828 verdes;
- `api/usuarios.test.ts`: 17 vermelhos, todos com "Este Node não tem crypto.argon2". É o Node 22 desta sessão, não o código;
- os `*.db.test.ts` **não rodaram aqui**: o worktree não lê o `.env` com a URL do Postgres local. Ficam com o dono, no branch do cherry-pick, antes do push (pendência E5-P2).

## Itens pedidos

- **RD-3734** (`domain/promotor-pedidos.ts:31`): está certo.
  - `requisicaoDePromotor` é, linha a linha, o `promotorNaRequisicao` do SDK (`packages/platform-sdk/src/acesso-por-cargo.ts:97` no `37d2417b`, item 2): com `perfil_acesso` vale o cargo do perfil; sem ele, o perfil do token.
  - `usuarioDaRequisicaoVePedidos`: em `concessao` vale `'pedido.ver' in perfil_acesso.permissoes`; em `legado`, o parâmetro. Bate com o `resolverPerfilPeloCargo`: as permissões trazem só as chaves concedidas, e a trava do cargo promotor tira só a escrita de pedido, não `pedido.ver`.
  - A API (`api/promotor-pedidos.ts:24`) só lê o parâmetro quando precisa. O teste do domain cita RN-PRO-01 e ADR 0073 §2.4, e o `perfis-v2.db.test.ts:481` monta o `perfil_acesso` como o motor faz.
  - Depende do item 2: sem o motor, a requisição não traz `perfil_acesso` e a regra cai no parâmetro, que é o comportamento de hoje. A ordem de merge abaixo garante o item 2 antes.
- **RD-3735**: está certo.
  - `MENSAGEM_PERFIS_NAO_MIGRADOS` está em `contracts/perfis.ts:259` e a API usa esse texto no 422 (`api/perfis-v2.ts:167`).
  - A tela não tem mais texto próprio: mostra `e.message`, por `frasesDaRecusa` (sem `violacoes`) e por `errorMessage`. `ehNaoMigrado` e `MENSAGEM_NAO_MIGRADO` saíram do código.
- **3.A1** (`api/usuario-perfis.ts:50`): fechado.
  - Em `concessao`, `conferirPerfisDoUsuario` monta o estado pelas concessões (`carregarEstadoV2(db, true)`, com a mesma trava por tenant da V2) e confere com o mesmo `conferir` da V2. Em `legado` segue o modelo antigo.
  - `perfil: codigos[0]` vale porque o contrato aceita um perfil só por usuário (RN-CORE-01, 0069).
  - Não há ciclo de import: `perfis-v2.ts` não importa `usuario-perfis.ts`.
  - O banco também segura o último admin pela gestão do acesso (0109 corrigida, `833d47af`).
- **Constantes do SDK no web** (`web/lib/perfis-tabela.ts:6-7`): está certo.
  - `CHAVE_ACESSO`, `NIVEIS_ESCOPO` e `NIVEIS_ALCADA` vêm de `@macuxi/platform-sdk`, e `ApiRequestError` vem de `@macuxi/platform-sdk/web`. São `packages/*`, dentro das fronteiras, e não há import de `modules/<outro>`.
  - Os valores são os mesmos das listas locais que saíram (`permissoes-perfil.ts:29,33,115`).
  - A raiz do SDK já era importada pelo web (`CHAVES_GESTAO_DO_ACESSO`, `CARGOS`), então não entra dependência nova no bundle.
- **Tela** (RD-3736/3737): o `SeletorDeOrigem` e o `origemDoValor` (com teste) tiram o `<select>` que estava repetido nas duas telas. `SEM_CONEXAO` ficou num lugar só.

## Achados

🔴 **E5-P1 (processo, o mesmo P1 da 1ª rodada)**
- `verificar modulo-core --base origin/main` no `183638eb` dá VIOLAÇÃO, com 17 de 46 arquivos da designer-ux e da banco-dados.
- Não é defeito de código. Sai com o cherry-pick abaixo; o #854 **não** entra como está.

🟡 **E5-A1 (baixo, lote seguinte)**
- A correção da 3.A1 não tem teste próprio.
- Falta um `usuarios.db.test.ts` no tenant em `concessao` com dois casos:
  - desativar o antigo admin de base quando a gestão já está em outro perfil passa;
  - desativar o único usuário com a gestão dá 422 (RN-CORE-35).
- Não segura o lote, porque o gatilho da 0109 corrigida segura no banco.
- Dono: modulo-core.

🟢 **E5-S1** — `requisicaoDePromotor` repete o `promotorNaRequisicao` do SDK. Hoje o branch não tem o item 2. Depois do item 2 no `main`, o domain pode usar a função do SDK, e as duas regras ficam numa só. Lote seguinte.

🟢 **E5-S2** — `perfis-page.tsx:492`: monta `/core/perfis/` vazio quando não há origem. Hoje isso não acontece, porque o botão fica desligado sem origem (`:504`). Ficaria mais claro só chamar a API com `de`. Lote seguinte.

## Ordem de merge da E5, com o pré-requisito

Cada passo só depois do CI verde do anterior e com o `main` verde:

1. **0109 corrigida** (banco-dados, sessão S19): `nuvem/v1040-banco-dados-perfis-correcao` @ `833d47af`. Os 2 commits (`41112e46` e `833d47af`) são da banco-dados e saem num squash só.
2. **Motor** (engenheiro-software): `37d2417b` levado por cherry-pick para um branch novo, sem o `41112e46`.
3. **Rotas V2** (modulo-core): `3c4ac6a4` e `5785a719` por cherry-pick, num commit só.
   - No mesmo lote, a asserção do `testes` em `tests/modulos/pedidos-busca-t0077.test.ts:989` (3.R1), antes do `producao-liberar`.
4. **#853** (designer-ux) @ `75a3813b`.
   - Só tem commits da designer-ux sobre o `cc78a5fd`, então não precisa de cherry-pick; basta atualizar com o `main`, por merge, se o CI pedir.
   - Pode entrar em qualquer ponto antes do 5.
5. **#854** (modulo-core): `908fc0c1`, `6d833efb` e `183638eb` por cherry-pick, num commit só, num PR novo. O #854 antigo é fechado.
6. **Limpeza** (designer-ux) @ `adbdbfdc`: um merge do `main` depois do 5.

- **Imagem**: os passos 3 e 5 saem na mesma imagem da v1.0.40. Não se libera um SHA do `main` que esteja entre os dois.
- **Deploy**: a ordem e a volta estão na seção "Ordem de deploy" da 1ª rodada.

## Cherry-pick depois do squash (passos 2, 3 e 5)

Depois do squash do antecessor, o dono roda na própria sessão:

1. `git fetch origin main && git switch -c nuvem/v1040-<dono>-<item>-2 origin/main`.
2. `git cherry-pick -n <seus commits, em ordem>`. Os merges e os commits de outro dono ficam de fora: já estão no `main` pelo squash.
   - Se houver conflito num arquivo que não é seu, fica a versão do `main`: `git checkout origin/main -- <arquivo>`.
3. **Equivalência**: `git diff origin/<branch antigo> HEAD -- <seus caminhos>` tem que sair vazio. A exceção é o que o `main` mudou depois, e isso precisa ser explicado no PR.
4. Na sessão, rode lint, typecheck e testes dos pacotes tocados, inclusive os `*.db.test.ts` (E5-P2) e o `typecheck:tests` se `tests/` mudou.
5. Antes do commit:
   - `node scripts/coord.mjs verificar <dono> --base origin/main` sai 0;
   - `node scripts/ci/grafo-turbo.mjs` sai 0.
6. Faça um commit só, com `Agente: <dono>` como trailer (sem linha em branco antes dele), e confira que `git log origin/main..HEAD` mostra só esse commit.
7. Um push só e um PR novo `[PRONTO PARA MERGE] ...` que cite o PR antigo e o SHA de origem. Feche o PR antigo, sem force push e sem apagar branch.

## Encaminhamento

- **modulo-core**:
  - E5-P1: cherry-pick dos passos 3 e 5;
  - E5-P2: os `*.db.test.ts` no branch novo;
  - E5-A1, E5-S1 e E5-S2 no lote seguinte.
- **engenheiro-software**: o passo 2.
- **banco-dados (S19)**: o passo 1.
- **testes**: a 3.R1.
- **gerente-projetos**: a ordem acima.
- **Caixa**: não consegui ler a minha caixa nesta sessão (`coord.mjs caixa` recebeu HTTP 403 no repositório de recados). Os recados desta revisão vão pelo gerente.

## 3ª rodada — `nuvem/v1040-modulo-core-perfis-2` @ `c8bf2083` (27/11, S18)

Base do PR: o #853 @ `75a3813b`. São 7 commits sobre ele, todos com `Agente: modulo-core`, sem merge e sem a 0109.

### Os dois commits novos

- **`46053bb1`** 🟢:
  - `usuarioDaRequisicaoVePedidos` passa a usar `podePeloCargo(perfil_acesso, 'pedido.ver')` do SDK. A leitura é a mesma de antes: `vetadaPeloCargo` só trava a escrita de pedido, e `pedido.ver` continua sendo a concessão do perfil.
  - `sync.ts` e `clientes.ts` deixam de repetir o teste de promotor, que agora mora só em `usuarioVePedidos` (RN-PRO-01).
  - `requisicaoDePromotor` é igual, linha por linha, ao `promotorNaRequisicao` do `37d2417b` (`packages/platform-sdk/src/acesso-por-cargo.ts:97`): com `perfil_acesso` vale o cargo; sem ele, o perfil do token. O TODO(RD-3741) está certo.
  - O commit também trazia o symlink `modules/core/node_modules`.
- **`c8bf2083`** 🟢: tira esse symlink. No diff do PR ele não aparece, e o squash apaga o vaivém.
- **Conferido na sessão**:
  - `vitest domain/promotor-pedidos.test.ts`: 10 testes passaram;
  - `tsc -p tsconfig.json` e `eslint` nos 4 arquivos: limpos;
  - o SDK usado no teste é igual ao do `c8bf2083`.

### Processo

- `coord verificar modulo-core --base 75a3813b` sai 0, com 29 arquivos.
- `coord verificar --base 75a3813b` com `GITHUB_HEAD_REF=nuvem/v1040-modulo-core-perfis-2` infere `modulo-core` e sai 0. O 🔴 de "agente ambíguo" está resolvido **contra a base do #853**.
- **Contra o `origin/main` de hoje** (`cc78a5fd`), o mesmo comando dá "agente ambíguo: designer-ux, modulo-core": entram os 4 commits do #853 (`9da50153` a `75a3813b`).
  - O squash do #853 não resolve isso. Os 4 commits originais não ficam no `main`, a merge-base continua `cc78a5fd` e o CI do -2 cai.
  - Merge do `main` no -2 também não resolve.
  - **Por isso o cherry-pick é obrigatório** (passo abaixo).
- 🟢 (lote seguinte): nos dois commits novos, há uma linha em branco entre `Agente:` e `Co-Authored-By`. O `coord` lê a linha, mas `git log --format=%(trailers)` não a reconhece como trailer. Daqui para a frente, `Agente:` fica junto do bloco de trailers.
- 🟡 (pendência herdada, E5-P2): o `perfis-v2.db.test.ts` mudou e roda no branch novo, com o Postgres local e a 0109 corrigida, antes do push.

### Ordem de merge e de deploy da v1.0.40 (atualiza a 2ª rodada)

1. **0109 corrigida** (banco-dados, S19): `nuvem/v1040-banco-dados-perfis-correcao`, um squash só.
   - O head no GitHub agora é `fbadb283` (dicionário e teste da DIFERENCA, RD-3733), depois do `833d47af`. O merge vale para o head que estiver revisado e com CI verde.
2. **API** (engenheiro-software): o `37d2417b` está sobre o `41112e46` (a 0109 antiga, da banco-dados). Ele também precisa do cherry-pick sobre o `main` novo, num commit só.
   - Não há arquivo em comum com o -2 nem com a 0109.
3. **#853** (designer-ux) @ `75a3813b`.
4. **-2** (modulo-core): por cherry-pick, num PR novo (passo abaixo).
5. **Limpeza do kit** (designer-ux).

- **Imagem e deploy**: os passos 2 e 4 saem na mesma imagem da v1.0.40. Não se libera um SHA do `main` que esteja entre os passos 1 e 4.
- **Depois do 2**: o TODO(RD-3741) troca `requisicaoDePromotor` pelo `promotorNaRequisicao` do SDK. Entra no lote seguinte, porque a regra já é a mesma.

### Passo exato do -2 depois do squash do #853

```
git fetch origin main nuvem/v1040-modulo-core-perfis-2
git switch -c nuvem/v1040-modulo-core-perfis-3 origin/main
git cherry-pick -n 4d6f6252 d86498d5 48f87029 5383b163 0586d8a8 46053bb1 c8bf2083
git diff origin/nuvem/v1040-modulo-core-perfis-2 HEAD -- modules/core docs/modulos/core   # vazio (salvo o que o main mudou depois)
git status --short | grep node_modules                                                    # vazio
node scripts/coord.mjs verificar modulo-core --base origin/main                            # sai 0, sem "agente ambíguo"
node scripts/ci/grafo-turbo.mjs                                                            # sai 0
# lint, typecheck e testes de modules/core, inclusive o perfis-v2.db.test.ts
git commit   # um commit só, com "Agente: modulo-core" no bloco final de trailers
git push origin HEAD:nuvem/v1040-modulo-core-perfis-3
```

- PR novo `[PRONTO PARA MERGE] ...`, citando o -2 e o `c8bf2083`.
- O PR do -2 é fechado, sem force push e sem apagar o branch.
- **Opção sem cherry-pick**: se o #853 entrar por merge commit em vez de squash, os 4 commits ficam no `main` e o -2 entra como está. Hoje a regra é o squash, então vale o cherry-pick.

### Veredito

- `46053bb1`: 🟢
- `c8bf2083`: 🟢
- PR -2 contra o #853: sem 🔴
- Contra o `main`: só entra pelo cherry-pick acima
