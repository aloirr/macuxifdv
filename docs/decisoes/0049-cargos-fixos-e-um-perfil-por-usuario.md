# ADR 0049 — Cargos fixos do FDV, um perfil por usuário (fim do multiperfil), hierarquia pelo cargo e código ERP obrigatório

- **Status**: proposta em 2026-11-14.
- **Data**: 2026-11-14
- **Tarefa**: cargos no cadastro de usuário (banco: migração 0069, PR #259; Core: tela e API, PR #250)
- **Autor**: engenheiro-software
- **Origem**: chat do dono do produto de 14/11/2026, R-20261114-153500, R-20261114-153800 e R-20261114-154000.
- **Regras**: cria RN-CORE-53, RN-CORE-54, RN-CORE-55, RN-CORE-56 e RN-CORE-57; revê RN-CORE-01, RN-CORE-35 e RN-PLA-02.
- **Revê**: [0033](0033-motor-de-permissoes-por-perfil.md) §6 (multiperfil) e o "ao menos um perfil" do §5;
  [0047](0047-planos-e-licencas.md) §3 e RN-PLA-02 (prioridade do multiperfil na contagem de licenças).
  O resto da 0033 continua valendo: chaves estáveis, fábrica com sobreposições, perfil personalizado, limites travados e
  resolução por requisição.

## Contexto
O dono do produto decidiu (texto literal, R-20261114-153500): "No cadastro de usuario devem ter os cargos. Se é vendedor tem o
supervisor para cadastrar, e o gerente é o gerente do supervisor. Se é supervisor cadastra o gerente e o nome da equipe para
aparecer na tela inicial da foto do vendedor. Codigo ERP para todos. Cada usuario so pode ter um perfil. E cada perfil so pode
ter um cargo. cargo é algo padrao do fdv. Vendedor, Supervisor, Gerente, Administrativo". Depois: "Crie o cargo promotor."
(R-20261114-153800) e "Fica embaixo do gerente. Supervisor é opcional" (R-20261114-154000).
Até aqui o usuário podia ter vários perfis (RN-CORE-01 e RN-CORE-35, ADR 0033 §6, T-0112), combinados pela união nas ações e
pela regra mais restritiva nos acessos. O cargo não existia: a hierarquia saía do perfil base e da árvore `core.equipe`, e o
código ERP (`external_id`) era opcional no cadastro do BKO.

## Decisão
1. **Cargo é lista fixa da plataforma** (RN-CORE-53): `vendedor | promotor | supervisor | gerente | administrativo`, igual em
   todos os tenants. O admin do cliente não cria nem renomeia cargo. Fonte única no código: `CARGOS`, `Cargo` e `CargoSchema`
   (Zod) em `@macuxi/platform-sdk` (`src/cargos.ts`). No banco: `plataforma.perfil.cargo` com o CHECK `perfil_cargo_valido`
   (0069). Os módulos importam do SDK e nunca repetem a lista.
2. **Cada perfil tem exatamente um cargo** (RN-CORE-53). Os 7 perfis de fábrica recebem o cargo da base (`CARGO_DA_BASE` no SDK,
   `plataforma.cargo_da_base` no banco, que precisam ficar iguais): vendedor, promotor, supervisor e gerente têm o cargo de mesmo
   nome; analista, assistente e admin são `administrativo`. O perfil personalizado nasce com o cargo da base. O cargo **não
   dá permissão**: quem pode o quê continua no motor da ADR 0033 (base, sobreposições e limites travados). O cargo diz o lugar
   do usuário na hierarquia e o que o cadastro pede.
3. **Um perfil por usuário** (RN-CORE-54; revê RN-CORE-01, RN-CORE-35 e a ADR 0033 §6). Todo usuário tem **exatamente um**
   perfil vivo. No banco, a restrição de exclusão adiada `usuario_perfil_um_vivo` (23P01) garante isso. A migração 0069 deixou o
   vínculo de nível mais alto em quem tinha mais de um. Quem acumulava funções (vendedor + promotor) passa a ter um perfil
   personalizado com as ações de que precisa, dentro dos limites travados. Como não há mais combinação de perfis, a regra
   "união nas ações, mais restritiva nos acessos" sai das RN.
   - **Contratos sem versão nova.** A forma dos contratos públicos não muda: `ctx.usuario.perfis` e `PerfilDaRequisicao[]`
     continuam como lista, agora com no máximo um item. `pode`, `escopoDosPerfis`, `podeEntrar` e `combinarPerfis` continuam
     com a mesma assinatura (com um perfil, a combinação é o próprio perfil). Nenhum evento leva a lista de perfis. Por isso não
     há `@v2` (regra 3 do CLAUDE.md). O pedido HTTP do Core (`perfis` em `POST/PATCH /v1/core/usuarios`) passa a aceitar no
     máximo 1 item. Isso estreita o valor, não muda a forma, e o único cliente é o BKO, que sai no mesmo deploy. O modulo-core
     ajusta o `.max(10)` para `.max(1)` no PR dele, e a API devolve 422 com RN-CORE-54 para mais de um.
   - **Licenças (ADR 0047).** O tipo de licença é o do perfil único; a prioridade do multiperfil (RN-PLA-02) sai.
4. **Hierarquia pelo cargo, gravada na árvore `core.equipe`** (RN-CORE-55 e RN-CORE-56). Não entra coluna nova em
   `core.usuario`: o supervisor e o gerente saem da equipe do usuário e da equipe-pai (`core.v_usuario_hierarquia`, 0069).
   O que o cadastro pede por cargo está em `HIERARQUIA_DO_CARGO` (SDK):

   | Cargo | Supervisor | Gerente | Nome da equipe |
   |---|---|---|---|
   | vendedor | obrigatório | do supervisor (não se escolhe) | — |
   | promotor | opcional | obrigatório; com supervisor, tem de ser o gerente do supervisor | — |
   | supervisor | — | obrigatório | obrigatório (aparece no Início do app da equipe) |
   | gerente | — | — | opcional (a equipe raiz/regional) |
   | administrativo | — | — | — |

   O domain do Core valida tudo (função pura, com teste, citando a RN) e a API revalida (422). O banco garante só a regra do
   promotor, com gatilhos de restrição adiados (23514 `promotor_sem_gerente` e `promotor_gerente_do_supervisor`). O `hint`
   deles passa a citar **RN-CORE-56** em vez do recado. As regras do vendedor e do supervisor não viram restrição no banco
   porque os dados antigos as quebrariam. O `db/scripts/diagnostico-0069.sql` lista o que está fora.
5. **Código ERP obrigatório para todos no cadastro** (RN-CORE-57). Criar usuário pelo BKO exige `external_id`. Editar um
   usuário que ainda está sem código exige preencher o código antes de gravar. O banco continua aceitando nulo (usuários antigos
   e o admin inicial do provisionamento), e a unicidade por tenant continua (`usuario_external_uk`). A carga do ERP pelo Hub já
   exige `external_id` (RN-INT-09). A hierarquia do vendedor que vem do ERP segue as RN-INT e aparece no diagnóstico, sem
   recusar a carga.

## Alternativas
- **Cargo como tabela editável por tenant**: contraria "cargo é algo padrão do FDV". Recusada.
- **Cargo como coluna do usuário** (sem passar pelo perfil): o dono do produto ligou cargo ao perfil ("cada perfil só pode ter
  um cargo"), e o usuário ficaria com duas fontes para a mesma coisa. Recusada.
- **Supervisor e gerente como colunas em `core.usuario`**: duplicaria a árvore `core.equipe`, que já dá o escopo do Gestor
  (RN-CORE-04) e o nome da equipe no Início. Uma informação, um lugar. Recusada.
- **Manter o multiperfil e só acrescentar o cargo**: contraria "cada usuário só pode ter um perfil". Recusada.
- **Versionar os contratos (`perfil` único no lugar de `perfis[]`)**: quebraria o SDK, o motor e os testes sem ganho, porque a
  lista de um item já representa a regra. Recusada. Uma limpeza de forma, se vier, é outra ADR.

## Consequências
- Banco (banco-dados): migração 0069 (PR #259). Pendência: o `hint` dos gatilhos do promotor passa a citar `RN-CORE-56`, numa
  migração nova (`create or replace` de `core.conferir_promotores`), ou ainda na 0069, se ela não tiver ido ao `main`.
- SDK (engenheiro-software): `src/cargos.ts` (§1, §2 e §4), exportado pelo índice. A equivalência com o banco fica no
  `db/testes/cargo-hierarquia.db.test.ts`, que importa `CARGO_DA_BASE` do SDK.
- Core (modulo-core, PR #250): tela de usuário com o cargo (vindo do perfil), os vínculos por cargo e o código ERP obrigatório;
  domain com as RN-CORE-54 a 57; `perfis` com `.max(1)`; `CargoSchema` importado do SDK.
- Gestor, Treinamento e Pesquisa: nada muda já. Quem quiser o cargo importa do SDK.
- Doc 03 (gerente-projetos): RN-CORE-01 e RN-CORE-35 revistas e RN-CORE-53 a 57 novas, pelo texto do recado desta ADR.
  Doc 02 (RF-CORE-02): "um ou mais perfis" vira "um perfil, com um cargo".
- ADR 0033 e ADR 0047: continuam como estão, com a nota "revista pela 0049" no índice (coluna de status) e no cabeçalho de cada uma.
