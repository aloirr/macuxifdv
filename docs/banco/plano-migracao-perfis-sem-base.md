# Plano de migração — perfis de acesso sem "perfil base" (R-20261124-094327, ADR 0073)

- **Dono**: banco-dados. **Data**: 24/11/2026 (Manaus). **Situação**: só desenho; nenhuma migração entra antes da aprovação do
  Alexandre e da ADR 0073 (proposta, engenheiro-software, commit `2c7f504`).
- **Pedido**: item 12 de 24/11 — perfil sem base, permissões numa tabela com caixas (R-20261124-094327).
- **Números de migração**: provisórios (`NNNN-a`, `NNNN-b`). Seguem a ordem de merge (R-20261115-140000). Antes do push, o
  número não pode existir em `origin/main` nem em PR aberto. O `main` de hoje vai até a 0100.
- **Schema**: as tabelas de perfil estão no schema **`plataforma`**, não no `core` (0041). O Core é dono das telas e da API, mas
  não das tabelas. O plano mantém tudo no `plataforma`, com o mesmo critério da 0041 (o SDK é dono da regra).

## 1. Tabelas de hoje

| Tabela / coluna | Migração | O que guarda | RLS |
|---|---|---|---|
| `plataforma.perfil` (`codigo`, `nome`, `descricao`, `base`, `fabrica`, `ativo`, `cargo`) + colunas comuns | 0041; `cargo` na 0069 | Perfil do tenant. Os 7 de fábrica têm `codigo = base` e `fabrica = true`, ficam sempre ativos e vivos (`perfil_fabrica_ativo`). `codigo`, `base` e `fabrica` são imutáveis (gatilho `perfil_imutavel`). O `codigo` é único entre todos, inclusive os apagados (`perfil_codigo_uk`). | `isolamento_tenant` (macuxi_app, sem DELETE), `manutencao`, `leitura` (0078) |
| `plataforma.perfil_permissao` (`perfil_id`, `chave`, `concedida`, `nivel`, `alvos`) + comuns | 0041 | Só a **sobreposição** à fábrica da base. Tabela vazia = padrão de fábrica. Única viva por `(tenant_id, perfil_id, chave)`. O gatilho `perfil_permissao_travas` aplica as travas pela **base**. | idem |
| `plataforma.usuario_perfil` (`usuario_id`, `perfil_id`) + comuns | 0041; um vivo por usuário desde a 0069 (`usuario_perfil_um_vivo`, adiável) | Vínculo usuário × perfil. | idem |
| `plataforma.perfil_modulo` (`perfil` = código, `modulo`) | 0001; FK por código na 0041 | Módulos padrão do perfil. | idem |
| `core.usuario.perfil` | 0001 | Nome fixo = base do perfil (vai no token). O gatilho `usuario_perfil_principal` liga o perfil de fábrica dessa base quando falta um vínculo da mesma base. | RLS de `core.usuario` |
| `core.documento_tipo_perfil.perfil_id`, `core.documento_excecao.perfil_id` | 0090 | Matriz da Documentação por perfil (id, sem FK). | RLS do Core |

**Funções e gatilhos que leem a base**:
- 0041: `semear_perfis_fabrica` (recriada na 0051 e na 0069), `garantir_perfil_principal` (recriada na 0069), `perfil_imutavel`,
  `perfil_permissao_travas`, `usuario_admin_com_gestao`, `tenant_tem_admin_com_gestao`, `conferir_ultimo_admin`, os 4 gatilhos
  `*_conferir` e `perfis_do_usuario`.
- 0047: `usuario_tem_perfil_admin` (portal e `sa_*`).
- 0069: `cargo_da_base`.
- 0086: licença do plano por `case a.base`.

**Parâmetros do tenant que viram caixa** (ADR 0073 §2.4), ambos em `plataforma.parametro`, na entidade de sync `parametro`:
- `core.promotor_ve_pedidos`: sem linha = ligado.
- `catalogo.promotor_ve_preco_estoque`.

**Fora do escopo do plano**:
- **SQLite do aparelho**: os perfis estão fora do sync. O app recebe as chaves efetivas por `GET /v1/me/modulos`.
- **Views do Conector** (`db/conector/*.sql`): não citam perfil.

## 2. Tabelas novas (migração aditiva `NNNN-a`)

Todas têm `id uuid`, `created_at`, `updated_at` (gatilho `definir_updated_at`), `deleted_at` e `external_id`. Todas têm RLS
ligado e forçado, com 3 políticas:
- `isolamento_tenant`, para o macuxi_app, com `tenant_id = plataforma.tenant_atual()`;
- `manutencao` (0031);
- `leitura` (0078).

O worker e o portal não têm política nem grant. Nenhuma tabela nova entra no sync. Com isso, não há o índice
`(tenant_id, updated_at, id)` da regra das entidades sincronizadas.

### 2.1 `plataforma.perfil_concessao` — o que está marcado
| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid | Determinístico na migração: `uuid_de_chave('<tenant>:plataforma.perfil_concessao:<perfil_id>:<chave>')`. Gerado no cliente na API. |
| `tenant_id` | uuid not null | FK `plataforma.tenant` |
| `perfil_id` | uuid not null | FK composta `(tenant_id, perfil_id)` → `plataforma.perfil (tenant_id, id)` |
| `chave` | text not null | Mesmo CHECK de formato de `perfil_permissao` |
| `nivel` | text null | `NIVEIS_ESCOPO ∪ NIVEIS_ALCADA`. Em `dados.escopo`, só os de escopo e obrigatório (CHECK). |
| `alvos` | text[] null | Mesmo CHECK de formato (códigos ou `*`, de 1 a 50) |
| `created_at`, `updated_at`, `deleted_at`, `external_id` | | comuns |

- **Índices**:
  - `perfil_concessao_uk` único em `(tenant_id, perfil_id, chave) where deleted_at is null`.
  - `perfil_concessao_leitura_ix` em `(tenant_id, perfil_id) include (chave, nivel, alvos) where deleted_at is null`, para a
    leitura por requisição.
- **Só a concessão vira linha**: não existe `concedida = false`. Desmarcar uma caixa = soft delete da linha (o histórico fica). O
  `PUT` do perfil inteiro grava o conjunto: soft delete do que saiu e insert do que entrou, com `on conflict` pelo único vivo.
- **Gatilho `perfil_concessao_travas`** (BEFORE INSERT/UPDATE, 23514, `hint` = a RN): é a cópia das travas pelo **cargo** do
  §2.5 da ADR.
  - RN-PRO-01: cargo promotor × chave de escrita de pedido (mesmo regex da 0041).
  - RN-CORE-33: `acesso.bko` nos cargos vendedor, promotor e supervisor; `acesso.portal` fora do cargo administrativo.
  - Apps: `acesso.campo` fora de vendedor e promotor; `acesso.gestao` fora de supervisor e gerente.
  - RN-CORE-04: `dados.escopo` acima do teto do cargo.
  - O que depende do conjunto vai no COMMIT (gatilho de restrição adiável, como na 0041):
    - `acesso.portal` exige a gestão completa;
    - todo perfil ativo tem ao menos um `acesso.*`;
    - último admin.

### 2.2 `plataforma.modelo_permissao` — os 7 modelos (cópia gerada do SDK)
| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid | `uuid_de_chave('plataforma.modelo_permissao:<versao>:<modelo>:<chave>')` |
| `versao` | int not null | `CATALOGO_PERMISSOES_VERSAO` |
| `modelo` | text not null | Os 7 nomes de `PERFIS` |
| `cargo` | text not null | CHECK da 0069 |
| `chave`, `nivel`, `alvos` | | Como em `perfil_concessao` |
| `created_at`, `updated_at`, `deleted_at`, `external_id` | | comuns |

- **Sem `tenant_id`**: é catálogo da plataforma, como `plataforma.plano`.
  - Entra em `TABELAS_SEM_TENANT_ID` (`db/src/excecoes.ts`) e na exceção de `db/scripts/conferir-rls.sql`.
  - RLS: `select` para o macuxi_app com `using (deleted_at is null)`. Só o dono da migração e o `manutencao` escrevem.
- Único em `(versao, modelo, chave)`.
- Usos:
  - na migração, a derivação (§3);
  - no provisionamento, a semeadura de tenant novo;
  - no "copiar de um modelo".
- **A requisição nunca lê esta tabela** (ADR 0073 §2.3).
- Conteúdo da versão 1:
  - vem do script `db/scripts/gerar-modelo-permissao.ts`, que lê `modelosDePerfil(MANIFESTOS)` do SDK e grava em `VALUES`
    congelados dentro da migração (migração aplicada não muda);
  - as versões seguintes entram pela aplicação do catálogo da API (ADR 0073 §2.2), com `insert ... on conflict do nothing`.

### 2.3 `plataforma.catalogo_aplicado` — tenant migrado e versão do catálogo
- Colunas: comuns + `versao` int, `aplicado_em` timestamptz, `leitura` text com CHECK `in ('legado', 'concessao')`.
- Único em `(tenant_id, versao) where deleted_at is null`.
- **É a chave da transição por tenant**:
  - sem linha (ou com `leitura = 'legado'`), o tenant continua no modelo de hoje (fábrica + sobreposições);
  - com `'concessao'`, a API e as funções do banco leem `perfil_concessao`.

### 2.4 `plataforma.perfil_migracao_conflito` — o que fez a migração parar num tenant
- Colunas: comuns + `perfil_id`, `perfil_codigo`, `usuario_id` (null), `tipo` (§4.4), `chave` (null), `antes` jsonb, `depois`
  jsonb, `resolvido_em` (null).
- RLS: o macuxi_app só lê. Quem grava é a função de migração (o dono).
- Serve para o gerente levar a lista ao Alexandre, sem dado pessoal (ids e códigos, nunca nome nem e-mail).

### 2.5 Colunas que ficam (fase 1) e mudança de regra nelas
- `perfil.base`, `perfil.fabrica`, `perfil_permissao` e `core.usuario.perfil` **ficam**. São o caminho de volta e a
  compatibilidade da ADR (§2.8).
- **`perfil.base` congelada nos perfis que já existem**. Assim `core.usuario.perfil` e as ~70 comparações por nome não mudam para
  ninguém.
  - O perfil criado depois da migração recebe `base = perfilDeCompatibilidade(cargo, permissoes)` (ADR §2.8), gravada pela API
    no insert.
  - A troca de cargo (só em perfil sem usuários) recalcula a base.
  - `perfil_imutavel` passa a aceitar a troca de base só nesse caso: tenant com `leitura = 'concessao'` e perfil sem vínculo vivo.
- **`perfil_fabrica_ativo`**: no tenant migrado, os 7 padrão podem ser desativados e apagados (ADR §2.1). A CHECK vira gatilho
  que só vale com `leitura = 'legado'`. `fabrica` passa a ser apenas "nasceu como padrão".

## 3. Derivação base → permissões explícitas

O ponto de partida é a **gêmea SQL de `resolverPerfil`**: `plataforma.permissoes_legado_do_perfil(p_perfil uuid) returns jsonb`
(STABLE, INVOKER, `search_path` fixo).

```
concessões(perfil) =
  modelo(base)                                    -- modelo_permissao, versao 1
  − { chave | sobreposição viva concedida = false }
  ∪ { chave → (nivel = coalesce(s.nivel, modelo.nivel, menor_nivel(chave)),
               alvos = coalesce(s.alvos, modelo.alvos)) | sobreposição viva concedida = true }
  − travas da BASE (travaDaChave)                 -- o que hoje já não vale, não vira caixa
  com dados.escopo: nível fora da família → 'carteira'; acima do teto da base → o teto
  + ajuste dos 2 parâmetros (abaixo)
```

### 3.1 Os 7 perfis padrão, por tenant
- Sem sobreposição, as concessões são o modelo da base, igual ao `matrizDeFabrica` de hoje.
- A tabela de cada modelo sai do SDK. As chaves da plataforma (`FABRICA_PLATAFORMA`) estão abaixo. O resto vem do `perfis` de
  cada ação dos manifestos.

| Modelo (cargo) | Chaves da plataforma |
|---|---|
| Vendedor (vendedor) | `acesso.campo`, `dados.escopo=carteira` |
| Promotor (promotor) | `acesso.campo`, `dados.escopo=carteira` |
| Supervisor (supervisor) | `acesso.gestao`, `dados.escopo=equipe` |
| Gerente (gerente) | `acesso.gestao`, `acesso.bko`, `dados.escopo=equipes_abaixo` |
| Analista (administrativo) | `acesso.bko`, `dados.escopo=tenant` |
| Assistente (administrativo) | `acesso.bko`, `dados.escopo=tenant` |
| Admin (administrativo) | `acesso.bko`, `acesso.portal`, `dados.escopo=tenant`, `usuario.criar/editar/desativar`, `senha.redefinir=[*]`, `perfil.gerir` |

- Com sobreposições no perfil padrão (o "Restaurar padrão" nunca usado), vale a fórmula inteira. O resultado é a mesma coisa que o
  usuário tem hoje.

### 3.2 Perfis personalizados (derivados)
- Mesma fórmula, com o `base` do perfil. O fixture `dois-tenants` tem o caso `vendedor_externo`: base vendedor com
  `dados.escopo=proprio` por sobreposição.
- O resultado vira caixas explícitas, e a sobreposição deixa de ser lida no tenant migrado.
- **Perfis inativos** também são migrados (reativar mantém o conjunto). **Perfis apagados** não são.

### 3.3 Os 2 parâmetros que viram caixa (ADR §2.4)
Hoje o efeito vem do **nome** do perfil (`core.usuario.perfil`) mais o parâmetro, e não da chave. A derivação preserva o efeito
de hoje.
- **`pedido.ver` nos perfis de cargo promotor**: fica só se a chave resolvida já existe **e** `promotor_ve_pedidos` está ligado
  (sem linha = ligado). Com o parâmetro desligado, a chave sai desses perfis. É o mesmo efeito: hoje a API recusa (P12) e o sync
  esconde o histórico.
- **`produto.ver_preco_estoque`**:
  - nos perfis de cargo promotor, vale `= promotor_ve_preco_estoque`;
  - nos outros cargos, hoje o preço aparece pelo nome (`PERFIS_PRECO_ESTOQUE`), mesmo com a chave revogada por sobreposição. A
    derivação **concede** a chave, para ninguém perder o que vê hoje;
  - cada caso de "chave revogada sem efeito" vai para `perfil_migracao_conflito` (tipo `REVOGACAO_SEM_EFEITO`) como aviso. O aviso
    não para o tenant. Decisão do Alexandre, §8.
- Nenhuma linha de `plataforma.parametro` é apagada na fase 1. O app instalado lê os 2 parâmetros offline (§6).

## 4. Garantia "nenhum usuário perde acesso"

### 4.1 Função de conferência (antes e depois)
`plataforma.conferir_perfis_sem_base(p_tenant uuid) returns table (usuario_id, perfil_codigo, chave, antes jsonb, depois jsonb, tipo text)`:
- para cada usuário vivo, compara `permissoes_legado_do_perfil` (com o ajuste do §3.3) e `permissoes_do_perfil` (lida de
  `perfil_concessao`) do seu único perfil vivo;
- a comparação é por chave, nível de `dados.escopo` e alvos (conjunto ordenado);
- confere também `perfil_compat(cargo, concessões) = core.usuario.perfil` (tipo `NOME_DIVERGENTE`). Esse caso só é aviso, porque a
  base fica congelada (§2.5).
- **Esperado: zero linhas** em todo tenant migrado. Uma linha de tipo `DIFERENCA` aborta a migração inteira (`raise`, 23514). Isso
  é defeito da derivação, não do tenant.

Rodada:
- **antes**: no diagnóstico, só leitura (§4.4). Cria `foto_antes` numa tabela temporária, com o hash de cada usuário;
- **depois**: no fim da `NNNN-b`;
- **depois do deploy da API**: de novo, pelo `testes`.

A prova cruzada com o SDK (gêmea SQL = `resolverPerfil` em TypeScript) fica no teste do §7.

### 4.2 Idempotência
- Os ids são determinísticos (§2.1), e o insert usa `on conflict (tenant_id, perfil_id, chave) where deleted_at is null do nothing`.
- O tenant que já tem `catalogo_aplicado` com `leitura = 'concessao'` é pulado.
- Rodar 2 vezes dá a mesma contagem e o mesmo hash das linhas, com o `updated_at` intacto (teste do §7).
- Rodar de novo depois de resolver um conflito migra só o tenant que faltava.

### 4.3 Reversão (`NNNN-b.down`, depois `NNNN-a.down`)
1. Para cada tenant com `leitura = 'concessao'`, os perfis que mudaram depois da migração (concessão com
   `created_at`/`updated_at`/`deleted_at` > `aplicado_em`, ou perfil criado depois) recebem as sobreposições recalculadas.
   - Para cada um: `sobreposições = diferença(concessões, modelo(base))`, com `concedida=false` no que falta e `concedida=true`
     (com nível e alvos) no que sobra ou difere. É o mesmo cálculo de `sobreposicoesDoDesejado` do Core.
   - Os perfis intocados mantêm as sobreposições originais, que nunca foram apagadas.
2. Os 7 padrão que foram desativados ou apagados depois voltam ativos e vivos, para o CHECK `perfil_fabrica_ativo` voltar. Eles
   estão sem usuários, porque o gatilho `PERFIL_EM_USO` garante isso.
3. Volta o texto anterior das funções recriadas (`perfil_imutavel`, `usuario_admin_com_gestao`, `tenant_tem_admin_com_gestao`,
   `usuario_tem_perfil_admin`, `semear_perfis_fabrica`, `perfis_do_usuario`, licença da 0086), como cópia exata.
4. A `NNNN-a.down` apaga as 4 tabelas novas e as funções novas.

**Perda documentada do down**: a concessão que só o modelo novo aceita volta cortada pelas travas da base. Exemplo:
`acesso.portal` num perfil de base analista com a gestão completa. Volte antes o código da API e do Core que lê
`perfil_concessao`.

### 4.4 Conflitos: para no tenant e reporta
Um diagnóstico só de leitura, `db/scripts/diagnostico-NNNN.sql` (como o `diagnostico-0069.sql`), roda antes em produção pelo
macuxi_leitura. A migração repete o mesmo teste por tenant.

| Tipo | Caso | Efeito |
|---|---|---|
| `CARGO_DIFERENTE_DA_BASE` | `perfil.cargo ≠ cargo_da_base(base)` (o `POST` atual aceita os dois independentes) | **para o tenant** |
| `TRAVA_NOVA_CORTA` | A concessão derivada seria cortada pela trava do cargo e não pela da base. Exemplos: `acesso.campo` em gerente/administrativo, `acesso.gestao` em vendedor, `acesso.portal` sem a gestão completa, escopo acima do teto do cargo | **para o tenant** |
| `PERFIL_SEM_ACESSO` | Perfil ativo sem nenhum `acesso.*` | **para o tenant** |
| `ADMIN_MUDA` | Usuário que deixa de ser ou passa a ser "admin com gestão" (de "base admin" para "tem a gestão completa"), ou alvo de `senha.redefinir '*'` que muda (de "não é de base admin" para "não tem `perfil.gerir`") | **para o tenant** se o tenant ficar sem admin com gestão; senão, aviso |
| `REVOGACAO_SEM_EFEITO` | §3.3 | aviso |
| `NOME_DIVERGENTE` | §4.1 | aviso |

- **Parar no tenant**: a função `plataforma.migrar_perfis_sem_base(p_tenant)` grava os conflitos, não grava nenhuma concessão e
  deixa o tenant em `leitura = 'legado'`. Os outros tenants seguem.
- A migração termina com `raise notice` com a contagem por tipo, sem dado pessoal.
- O tenant parado continua funcionando no modelo de hoje. Só migra depois que o Alexandre decide o caso e o admin ou o suporte
  corrige. Depois disso: `select plataforma.migrar_perfis_sem_base('<tenant>')` pelo dono do banco, com o mesmo teste.
- **A fase 2 só começa com zero tenants em `legado`**.

## 5. Ordem dos passos

| # | Passo | Quem | Volta |
|---|---|---|---|
| 0 | Diagnóstico `diagnostico-NNNN.sql` em produção (só leitura). A lista vai ao Alexandre pelo gerente. | banco-dados | — |
| 1 | **`NNNN-a` aditiva**: as 4 tabelas, RLS, índices, `modelo_permissao` v1, funções novas e as legadas em paralelo. Nada muda de comportamento. | banco-dados | `NNNN-a.down` |
| 2 | **`NNNN-b` backfill**, no mesmo deploy da API nova: `migrar_perfis_sem_base` em todo tenant, conferência (§4.1) e `leitura = 'concessao'`. Recria as funções do banco com o caminho duplo por `catalogo_aplicado.leitura`: `perfil_do_usuario`, último admin, `usuario_tem_perfil_admin`, licença 0086 pelo cargo e semeadura de tenant novo com concessões e `catalogo_aplicado`. | banco-dados | `NNNN-b.down` |
| 3 | **Troca de leitura na API**: `plataforma.perfil_do_usuario` devolve `codigo`, `cargo` e as concessões, com `ctx.usuario.cargo` e `perfil_acesso`. CRUD novo de perfis. `core.usuario.perfil` passa a ser a `base` (congelada) do perfil. | engenheiro-software, modulo-core | deploy anterior + `NNNN-b.down` |
| 4 | Transição: cada módulo troca as comparações por nome (ADR §1.3). Os parâmetros saem da leitura da API. O app mínimo passa a ler `perfil_acesso`. | donos dos módulos, engenheiro-apps | por PR |
| 5 | **Fase 2** (ADR seguinte, depois da janela de retorno e com zero tenants em `legado`): apagar `perfil.base`, `perfil.fabrica`, `perfil_permissao`, `core.usuario.perfil`, `cargo_da_base`, as funções legadas, o gatilho espelho e as linhas dos 2 parâmetros. | banco-dados | sem volta automática; backup antes |

**Janela entre o passo 2 e o passo 3**: a API antiga ainda pode gravar sobreposições. O gatilho `perfil_permissao_espelho` fica
ativo só no tenant `concessao` e sai na fase 2. Ele refaz as concessões do perfil a partir do legado sempre que a API antiga grava
uma sobreposição. A API nova não grava em `perfil_permissao`, então o gatilho fica parado depois do deploy.

**`sa_*` e kit do Conector**:
- A `NNNN-b` recria `usuario_tem_perfil_admin`, que as `sa_*` do portal usam, mas não muda a **lista** de funções `sa_*` nem o kit.
- Se a revisão decidir recriar alguma `sa_*`, a migração e o teste da lista vão no PR conjunto `alexandre/migracao-perfis-sem-base`
  (R-20261115-171000).

## 6. Impacto no app (SQLite) e no Conector
- **SQLite do aparelho**: nenhuma tabela nova nem coluna nova. Perfis e permissões não estão no sync.
  - O app instalado continua lendo `perfis[].base` em `GET /v1/me/modulos` (valor derivado, ADR §2.8).
  - Também continua lendo os 2 parâmetros na entidade `parametro` do sync (`promotorVePedidosDasLinhas`). Por isso as linhas ficam
    até a versão mínima do app passar da que lê `perfil_acesso`.
  - Risco aceito na transição: se o admin muda `pedido.ver` de um perfil promotor, o app antigo mostra a tela pelo parâmetro. A
    API e o sync filtram pela chave, então nenhum dado a mais chega ao aparelho.
- **Escopo do sync**: na migração, as concessões são equivalentes (§4.1), e nada muda no que cada aparelho recebe; não há
  ressincronização. Depois da troca, mudar `pedido.ver`, `produto.ver_preco_estoque` ou `dados.escopo` de um perfil muda o filtro
  do pull. O pedido de nova geração de sync para os usuários do perfil vai ao engenheiro-software por recado na fase de código.
- **Views do Conector** (`db/conector/views-modelo.sql`, `entrada-pedido-modelo.sql`): sem impacto.
- **Zerar empresa (0100)**: as tabelas novas estão no schema `plataforma`, que fica (`FICA`). Os perfis e as concessões
  sobrevivem, como hoje. O teste do §7 confere.

## 7. Volume, tempo e testes

### 7.1 Volume e tempo (estimativa)
- **Catálogo**: cerca de 150 chaves (134 ações nos 8 manifestos + as da plataforma).
- **Concessões por perfil**: de 15 (Promotor) a cerca de 120 (Admin).
- **Por tenant**: de 7 a 20 perfis, ou seja, de 400 a 1.500 linhas em `perfil_concessao`.
- **Total**:
  - hoje (dezenas de tenants): na casa de 50 mil linhas;
  - teto de projeto (1.000 tenants): ~1,5 milhão de linhas, ~150 MB com índices.
- **Tempo do backfill**: inserção em conjunto, por tenant, numa transação.
  - Estimativa abaixo de 5 s hoje e de 2 min no teto. Medição real no Postgres local da sessão com o fixture multiplicado.
  - Lock só nas tabelas novas. `perfil` e `perfil_permissao` só são lidas.
- **Leitura por requisição** (`perfil_do_usuario`): o índice com `include` atende cada perfil com até ~150 linhas, perto de 1 ms.
  A meta p95 < 300 ms sobra; EXPLAIN registrado no `docs/banco/plataforma.md` na fase de código.

### 7.2 Testes `*.db.test.ts` da fase de código (em `db/testes/`)
- `perfis-sem-base-migracao.db.test.ts` — testa o backfill:
  - no fixture `dois-tenants`: os 7 padrão, o `vendedor_externo` (escopo `proprio`), sobreposições de revogação, concessão com
    nível e com alvos, escopo inválido e acima do teto;
  - `conferir_perfis_sem_base` = 0 linhas em A e B;
  - `perfil_compat` = `core.usuario.perfil` nos 7;
  - rodar 2 vezes dá o mesmo hash, a mesma contagem e o mesmo `updated_at`;
  - up/down/up, com o down devolvendo o mesmo efeito por usuário.
- `perfis-sem-base-equivalencia-sdk.db.test.ts`:
  - `permissoes_legado_do_perfil` (SQL) = `resolverPerfil` (SDK) em todo perfil do fixture e em perfis aleatórios gerados
    (sobreposições sorteadas);
  - `modelo_permissao` v1 = `modelosDePerfil(MANIFESTOS)`, como o `cargo-hierarquia.db.test.ts`.
- `perfis-sem-base-conflitos.db.test.ts`:
  - tenant com `CARGO_DIFERENTE_DA_BASE`, `TRAVA_NOVA_CORTA`, `PERFIL_SEM_ACESSO` e tenant que ficaria sem admin: o tenant fica
    em `legado`, sem concessões, com os conflitos gravados, enquanto o outro tenant migra;
  - depois de corrigir, a nova rodada migra.
- `perfis-sem-base-parametros.db.test.ts`:
  - `promotor_ve_pedidos` desligado → perfis de cargo promotor sem `pedido.ver`;
  - `promotor_ve_preco_estoque` ligado → com `produto.ver_preco_estoque`;
  - `REVOGACAO_SEM_EFEITO` registrado.
- `perfil-concessao-travas.db.test.ts` — 23514 e a RN em cada trava do §2.1:
  - RN-PRO-01 no cargo promotor (`pedido.criar`, `pedido.aprovar`, `pedido_x.editar`; `pedido.ver` aceito);
  - RN-CORE-33;
  - apps por cargo;
  - teto do escopo;
  - portal sem gestão, perfil sem acesso e último admin no COMMIT.
- `perfis-sem-base-semeadura.db.test.ts` — o tenant novo nasce com os 7 perfis, as concessões do modelo e `catalogo_aplicado`.
- `perfis-sem-base-espelho.db.test.ts` — com o tenant em `concessao`, a sobreposição gravada pelo caminho antigo refaz as
  concessões do perfil.
- `perfis-sem-base-transicao.db.test.ts`:
  - funções com caminho duplo (`legado` × `concessao`): `usuario_admin_com_gestao`, `usuario_tem_perfil_admin` (portal), licença
    da 0086 pelo cargo;
  - mudança de cargo em perfil com usuário recusada (`CARGO_EM_USO`); apagar perfil com usuário recusado (`PERFIL_EM_USO`).
- **RLS**:
  - as 4 tabelas no `vazamento.test.ts`, com linhas de A e B no fixture (grupos de id novos em `dois-tenants.ts`);
  - em `conformidade.test.ts`, via `conferir-rls.sql`, com a exceção de `modelo_permissao` em `excecoes.ts`.
- **Desempenho**: EXPLAIN de `perfil_do_usuario` (Index Only Scan em `perfil_concessao_leitura_ix`) e tempo do backfill no
  fixture × 100 tenants.
- **Zerar empresa**: `limpar_cadastros` mantém `perfil_concessao` e `catalogo_aplicado`.

**Na sessão**: os testes rodam no Postgres local, sem Docker (R-20261115-213600), antes do push.

## 8. Pontos para decisão

**Do Alexandre** (pelo gerente):
1. **Conflitos que param o tenant** (§4.4): como corrigir cada caso? Opções:
   - ajustar o cargo do perfil para o da base;
   - aceitar o corte da trava nova, com perda de acesso explícita;
   - abrir exceção.
   A sugestão é ajustar o cargo para o da base quando o perfil não tem usuários e, quando tem, decidir caso a caso.
2. **Admin e senha pela gestão do acesso**: o perfil personalizado de base admin sem `perfil.gerir` passa a ter a senha redefinível
   pelo BKO, e o de outra base com a gestão completa passa a contar como admin. Confirma a ADR §2.5 (6 e 7)?
3. **Revogação sem efeito** (§3.3): manter o que o usuário vê hoje (concede a caixa; é o padrão do plano) ou respeitar a caixa que
   o admin desmarcou (o usuário deixa de ver o preço)?
4. **Janela de retorno** antes da fase 2 (apagar `base`, `fabrica`, `perfil_permissao`, `core.usuario.perfil`). A sugestão é uma
   versão inteira do app mínimo, ou 30 dias, o que vier depois.

**Técnicos** (engenheiro-software, por recado na fase de código):
- base congelada nos perfis existentes (§2.5) em vez de derivada a cada edição;
- `modelo_permissao` sem `tenant_id` (exceção como `plataforma.plano`);
- leitura dupla por `catalogo_aplicado.leitura` na API;
- nova geração de sync quando a chave de um perfil muda o filtro.
