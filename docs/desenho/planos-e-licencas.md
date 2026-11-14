# Desenho — Planos e licenças (ADR 0047)

- **Origem**: R-20261114-132600-alexandre, item 1. A sessão da nuvem não lê esse recado: o GraphQL do GitHub dá 403. Por isso, os números (preços, licenças e módulos de cada plano) não estão aqui nem no código; entram no seed do banco-dados, copiados do recado.
- **Decisão**: [ADR 0047](../decisoes/0047-planos-e-licencas.md). RN propostas: RN-PLA-01..06.
- **Autor**: engenheiro-software, 2026-11-14.

## 1. Módulos afetados
| Onde | O quê | Dono |
|---|---|---|
| `packages/platform-sdk/src/planos.ts` | contratos (Zod) e regras puras: `tipoDeLicencaDoUsuario`, `contarLicencasEmUso`, `licencasContratadas`, `modulosDaAssinatura`, `conferirEscolhaDePlano`, `conferirTrocaDePlano`, `conferirNovoUsuario`, `valorDaAssinatura`, `fimDoTeste`, `usoPorItem` | engenheiro-software (feito) |
| `apps/api/src/planos-portal.ts` | as 4 rotas do portal, atrás de `MACUXI_PLANOS` | engenheiro-software (feito) |
| `apps/api/src/plataforma.ts` | `criarEmpresaNoPortal`, extraída do `POST /v1/plataforma/empresas` sem mudar o comportamento | engenheiro-software (feito) |
| `db/` | migração, funções `sa_*`, `plataforma.licencas_do_tenant()`, seed e `*.db.test.ts` | banco-dados |
| `modules/core` (cadastro de usuários do BKO) | a trava `conferirNovoUsuario` | modulo-core |
| `apps/web` (portal `config.`) e `packages/ui` | escolha do plano, ficha e troca | engenheiro-apps e designer-ux |

## 2. Rotas e contratos (`@macuxi/platform-sdk`)
| Rota | Quem | Entrada | Saída | Função no banco |
|---|---|---|---|---|
| `GET /v1/plataforma/planos` (`ROTA_PORTAL_PLANOS`) | super-admin e admin do cliente | — | `ListaPlanosSchema` (ordenado por `ordem`) | `sa_listar_planos(sid)` |
| `POST /v1/plataforma/empresas-com-plano` (`ROTA_PORTAL_EMPRESA_COM_PLANO`) | só super-admin | `CriarEmpresaComPlanoSchema` = `CriarEmpresaSchema` sem `modulos` + `assinatura: EscolhaNaCriacaoSchema` (`plano`, `ciclo`, `adicionais`, `com_teste`, `pedido_id`) | `CriarEmpresaComPlanoRespostaSchema` | `sa_provisionar_tenant` (o mesmo fluxo) e depois `sa_gravar_assinatura(sid, tenant_id, jsonb)` |
| `GET /v1/plataforma/empresas/:tenant_id/assinatura` (`rotaPortalAssinatura`) | super-admin; admin do cliente só a própria empresa (outra = 403) | — | `FichaAssinaturaSchema` (6 itens na ordem de `ITENS_CONTADOS`; `valor` calculado pela API) | `sa_assinatura_da_empresa(sid, tenant_id)` |
| `PUT /v1/plataforma/empresas/:tenant_id/assinatura` | só super-admin | `TrocarPlanoSchema` (`plano`, `ciclo`, `adicionais`, `pedido_id`) | `FichaAssinaturaSchema` (a nova) | `sa_trocar_plano(sid, tenant_id, jsonb)` |

Regras da API:
- Na criação, a API confere o plano no catálogo (fora dele = 422 `PLANO_DESCONHECIDO`) e aplica `conferirEscolhaDePlano` (422 `PLANO_INATIVO` ou `ADICIONAL_FORA_DO_PLANO`).
- Os módulos vêm de `modulosDaAssinatura` (core e integracao sempre), com `licencas: null` no `tenant_modulo`.
- `teste_ate` = `fimDoTeste(hoje no fuso da empresa, plano.dias_teste)` quando `com_teste`; `paga` = `teste_ate === null`. Com `simular`, nada é gravado e a resposta traz `assinatura: 'simulada'`.
- Na troca, a API lê a ficha atual e aplica `conferirTrocaDePlano` (422 `PLANO_ABAIXO_DO_USO`, com `detalhes.problemas`). Só depois chama `sa_trocar_plano`, que confere de novo na transação.
- SQLSTATE: 28000 = 401, 42501 = 403, P0002 = 404 `SEM_ASSINATURA`, 22023 = 422 na escrita (código no `hint`, ex. `PLANO_ABAIXO_DO_USO`) ou 400 na leitura.

## 3. Formato combinado com o banco-dados
- `sa_listar_planos(sid)` → `{ itens: Plano[] }`, todos os planos, com `ativo`. O portal oferece só os ativos; a ficha mostra o plano mesmo inativo.
- `sa_gravar_assinatura(sid, tenant_id, {plano, ciclo, adicionais, teste_ate, paga, pedido_id})` → `{ resultado: 'criada' | 'existente', teste_ate }`. É idempotente: se o tenant já tem assinatura, devolve `existente` e o `teste_ate` gravado, sem mudar nada.
- `sa_assinatura_da_empresa(sid, tenant_id)` → `{tenant_id, plano: Plano, ciclo, adicionais, teste_ate, paga, desde, atualizada_em, licencas: [{item, contratadas, em_uso}] }`, com os 6 itens. Sem assinatura = P0002. O admin do cliente só vê a da sessão (42501).
- `sa_trocar_plano(sid, tenant_id, {plano, ciclo, adicionais, pedido_id, modulos})`: idempotente por `pedido_id`; grava o histórico; liga os `modulos` no `tenant_modulo`; nunca desliga módulo com usuário; abaixo do uso, na transação = 22023 com `hint` `PLANO_ABAIXO_DO_USO`.
- `plataforma.licencas_do_tenant()`: `SECURITY INVOKER`, sob RLS do tenant corrente. Faz `for update` na assinatura e devolve as linhas `{item, contratadas, em_uso}` mais `teste_ate` e `paga`, ou nada se não há assinatura. O SDK converte as linhas com `usoPorItem`.

## 4. Impacto em sync e dados
- Nada novo no sync: as tabelas são da plataforma, lidas pelo portal e pela transação do cadastro.
- Sem dado pessoal: a contagem usa só perfis de base, módulos e o `ativo`.
- `tenant.plano` continua `piloto` no fluxo de criação (o passo Empresa não manda plano). A fonte é a assinatura. Banco-dados: se quiser espelhar o código do plano em `tenant.plano`, que seja dentro da `sa_gravar_assinatura`.

## 5. Recados a enviar
O `node scripts/coord.mjs enviar` deu 403 na sessão da nuvem (GraphQL bloqueado). Os textos abaixo devem ser enviados como estão, por quem tiver acesso ao repositório de recados. Todos vão `--de engenheiro-software --tipo pedido`.

### 5.1 Para o gerente-projetos — "Planos e licenças: RN-PLA-01..06 e premissas para o doc 03"
- **Contexto**: o R-20261114-132600-alexandre, item 1, aprovou os planos Light, PME, Enterprise e Corporate, os adicionais Promotor, Pesquisa e Treinamento, o anual com 2 meses grátis, o teste de 14 dias e a trava de licença. A ADR 0047 está em proposta e o desenho em `docs/desenho/planos-e-licencas.md`. O SDK (`planos.ts`) e as rotas do portal (`planos-portal.ts`, flag `MACUXI_PLANOS`) estão no branch `nuvem/planos-engenheiro-software`.
- **O que preciso**:
  - incluir no doc 03 as RN-PLA-01..06 da ADR 0047, seção "RN novas propostas";
  - confirmar com o Alexandre as 5 premissas da ADR:
    1. o mapa perfil → tipo (analista, assistente e admin = BKO; supervisor e gerente = gestor);
    2. a prioridade no multiperfil (vendedor > gestor > promotor > bko);
    3. o bloqueado por senha continua contando;
    4. o teste vencido sem pagamento trava só novos usuários, sem bloquear o uso;
    5. os preços e as quantidades vêm só do recado, pelo seed;
  - repassar os recados 5.2 a 5.5 deste desenho, se ainda não tiverem chegado.
- **Pronto quando**: o doc 03 tiver as RN-PLA-01..06, as premissas estiverem confirmadas ou corrigidas por recado e a ADR 0047 estiver com o status atualizado.

### 5.2 Para o banco-dados — "Planos e licenças: migração, funções sa_*, licencas_do_tenant e seed (ADR 0047)"
- **Contexto**: ADR 0047 e `docs/desenho/planos-e-licencas.md`, §3. Contratos em `packages/platform-sdk/src/planos.ts` (`PlanoSchema`, `FichaAssinaturaSchema`, `UsoDeLicencaSchema`). As rotas da API estão prontas atrás de `MACUXI_PLANOS` (desligado) e chamam as funções abaixo no banco do portal (`macuxi_portal`, `semTenant`).
- **O que preciso**:
  1. Migração com:
     - `plataforma.plano`: `codigo` único, `nome`, `ordem`, `preco_mensal_centavos`, `licencas` (vendedor, gestor, bko e promotor; `null` = sem limite), `modulos`, `adicionais` (`adicional`, `preco_unitario_centavos`, `incluidos`), `meses_gratis_anual` (0–11), `dias_teste` (0–90) e `ativo`;
     - `plataforma.assinatura`: uma por tenant, com plano, ciclo, adicionais, `teste_ate` (date), `paga`, `pedido_id` e `desde`;
     - `plataforma.assinatura_historico`;
     - em todas: colunas padrão (`id`, `tenant_id` quando couber, `created_at`, `updated_at`, `deleted_at`, `external_id`), RLS ligado e auditoria RN-AUD-01.
  2. No `macuxi_portal`, as funções `SECURITY DEFINER`, auditadas, com a sessão conferida e o formato do §3:
     - `sa_listar_planos(sid)`;
     - `sa_gravar_assinatura(sid, tenant, jsonb)`, idempotente por tenant;
     - `sa_assinatura_da_empresa(sid, tenant)`, com P0002 sem assinatura e 42501 para o admin do cliente de outra empresa;
     - `sa_trocar_plano(sid, tenant, jsonb)`, idempotente por `pedido_id`, que grava o histórico, liga os `modulos` no `tenant_modulo`, nunca desliga módulo com usuário e, abaixo do uso, dá 22023 com `hint` `PLANO_ABAIXO_DO_USO`.
     - SQLSTATE: 28000 sessão, 42501 permissão, P0002 não achou, 22023 validação.
  3. `plataforma.licencas_do_tenant()`: `SECURITY INVOKER`, sob RLS, com `for update` na assinatura. Devolve `{item, contratadas, em_uso}` dos 6 itens (`vendedor`, `gestor`, `bko`, `promotor`, `pesquisa`, `treinamento`), mais `teste_ate` e `paga`. A contagem segue a RN-PLA-02/03:
     - perfil de base → tipo, com o multiperfil pela prioridade vendedor > gestor > promotor > bko;
     - inativo ou excluído não conta;
     - Pesquisa e Treinamento = usuário ativo com o módulo efetivo.
  4. `*.db.test.ts` cobrindo: RLS; idempotência das duas escritas; a corrida de dois cadastros com a última vaga; a recusa abaixo do uso na troca; e o admin do cliente de outra empresa.
  5. Seed dos 4 planos (Light, PME, Enterprise e Corporate), com os preços, as licenças, os módulos e os adicionais do R-20261114-132600-alexandre, item 1; `meses_gratis_anual` = 2 e `dias_teste` = 14.
- **Pronto quando**: a migração e o seed estiverem no `main` com o CI verde (stack isolado), o formato bater com os schemas do SDK e o recado de entrega trouxer o número da migração, para eu ligar `MACUXI_PLANOS` na demo.

### 5.3 Para o engenheiro-apps — "Portal config.: escolha do plano, ficha e troca de plano (ADR 0047)"
- **Contexto**: ADR 0047 e `docs/desenho/planos-e-licencas.md`, §2. Os contratos estão no `@macuxi/platform-sdk`: `ListaPlanosSchema`, `CriarEmpresaComPlanoSchema` / `CriarEmpresaComPlanoRespostaSchema`, `FichaAssinaturaSchema` e `TrocarPlanoSchema`. As rotas e os helpers são `ROTA_PORTAL_PLANOS`, `ROTA_PORTAL_EMPRESA_COM_PLANO` e `rotaPortalAssinatura(tenantId)`. As rotas existem só com `MACUXI_PLANOS=1`; desligado, dão 404.
- **O que preciso**:
  - **passo Empresa**: escolher o plano (só os `ativo`, por `ordem`), o ciclo, os adicionais e o teste, e enviar para `POST empresas-com-plano` com `pedido_id` gerado no portal, no lugar da lista de módulos. Usar o `simular` para a conferência;
  - **ficha da empresa**: licenças em uso e contratadas por item (`null` = sem limite), o valor mensal e por ciclo (centavos) e o fim do teste. O admin do cliente vê só a própria empresa;
  - **troca de plano** (só super-admin): `PUT` com `pedido_id`. No 422 `PLANO_ABAIXO_DO_USO`, mostrar `detalhes.problemas[].mensagem`;
  - com 404 na rota (flag desligado), manter o passo Empresa atual.
- **Pronto quando**: as três telas estiverem no portal com teste e com a revisão do designer-ux, do corretor-redundancias e do design-de-marca.

### 5.4 Para o designer-ux — "Portal config.: telas de plano, ficha de licenças e troca (ADR 0047)"
- **Contexto**: o mesmo do 5.3. As telas são do portal `config.`: a escolha do plano no passo Empresa, a ficha com as licenças em uso e contratadas e a troca de plano. Os contratos e as rotas estão no §2 do desenho.
- **O que preciso**:
  - o desenho visual e os textos das três telas;
  - a escolha do plano mostra o preço mensal e o anual (10× o mensal com 2 meses grátis, vindo de `valor`) e os adicionais;
  - a ficha mostra, por item, "em uso / contratadas" e "sem limite" quando `null`;
  - a troca mostra só o problema e a ação, a partir das mensagens dos 422 (`PLANO_ABAIXO_DO_USO`, `ADICIONAL_FORA_DO_PLANO`, `PLANO_INATIVO`).
  - Uma informação, um lugar; nada de texto sobre o que o sistema faz por trás.
- **Pronto quando**: o desenho e os textos estiverem em `docs/design/` e repassados ao engenheiro-apps, com a validação do design-de-marca.

### 5.5 Para o modulo-core — "Trava de licença no cadastro de usuários do BKO (RN-PLA-04, ADR 0047)"
- **Contexto**: ADR 0047, §5. A regra pura é `conferirNovoUsuario(situacao, novo, hoje)` em `@macuxi/platform-sdk` (`planos.ts`). A situação vem de `plataforma.licencas_do_tenant()` (banco-dados, recado 5.2), convertida com `usoPorItem`. `hoje` é o dia civil no fuso do tenant (`ctx.fuso()`).
- **O que preciso**:
  - aplicar a trava ao criar, reativar e mudar o perfil de um usuário, e ao liberar Pesquisa ou Treinamento a ele;
  - em `novo`, passar só o que o usuário ainda não ocupa. Exemplo: liberar Pesquisa a um vendedor = `bases: []`, `modulos: ['pesquisa']`;
  - chamar `licencas_do_tenant()` na mesma transação do insert ou update (ela faz `for update` na assinatura);
  - recusar com 422 e `codigo` `LICENCAS_ESGOTADAS` (com `item`) ou `TESTE_VENCIDO`, com a `mensagem` da função;
  - empresa sem assinatura não trava;
  - teste no `domain` citando RN-PLA-04, cobrindo: a última vaga, o esgotado, o multiperfil, o reativar e o teste vencido.
- **Pronto quando**: as rotas do cadastro de usuários recusarem além do contratado, com testes (unitário e `*.db.test.ts` da corrida) verdes no CI.
