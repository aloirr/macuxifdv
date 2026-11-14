# ADR 0047 — Planos e licenças: catálogo como dado, contagem por tipo e trava no cadastro de usuários

- **Status**: proposta em 2026-11-14.
- **Revista por**: [0049](0049-cargos-fixos-e-um-perfil-por-usuario.md) — um perfil por usuário; o multiperfil (prioridade do multiperfil no §3 e na RN-PLA-02) não vale mais.
- **Data**: 2026-11-14
- **Tarefa**: planos e licenças ([desenho](../desenho/planos-e-licencas.md))
- **Autor**: engenheiro-software
- **Origem**: R-20261114-132600-alexandre, item 1. Planos aprovados Light, PME, Enterprise e Corporate; adicionais Promotor, Pesquisa e Treinamento; anual com 2 meses grátis; teste de 14 dias; trava de licença. Complementa as ADRs 0029 e 0031 (portal) e a 0033 (perfis de acesso).

## Contexto
Hoje a empresa nasce no portal (`config.`) com uma lista de módulos e um teto de licenças por módulo (`plataforma.tenant_modulo.plano/licencas`). Esse teto não é aplicado ao cadastro de usuários e não segue os planos comerciais. O Alexandre aprovou quatro planos, três adicionais, o desconto do anual, o teste grátis e uma trava que impeça cadastrar mais usuários do que o contratado.

## Decisão
1. **O catálogo é dado, nunca código** (RN-PLA-01).
   - Tabela `plataforma.plano`, uma linha por plano com:
     - `codigo`, `nome` e `ordem`;
     - `preco_mensal_centavos`;
     - as licenças por tipo (`vendedor`, `gestor`, `bko`, `promotor`), com `null` = sem limite;
     - os `modulos` incluídos;
     - os `adicionais`, cada um com `preco_unitario_centavos` e `incluidos`;
     - `meses_gratis_anual`, `dias_teste` e `ativo`.
   - O preço muda por linha nova ou por versão do plano, nunca por código. Os números de cada plano vêm só do recado do Alexandre, pelo seed do banco-dados.
   - Os contratos ficam em `packages/platform-sdk/src/planos.ts` (`PlanoSchema`, `ListaPlanosSchema`).
2. **`plataforma.assinatura`**: uma por tenant, com o plano, o `ciclo` (`mensal` ou `anual`), os adicionais contratados, `teste_ate`, `paga`, o histórico das trocas (`plataforma.assinatura_historico`) e a auditoria RN-AUD-01. Colunas padrão e RLS ligado, como toda tabela.
3. **Contagem por tipo** (RN-PLA-02).
   - O tipo de licença sai do perfil de base:
     - vendedor = vendedor;
     - promotor = promotor;
     - supervisor e gerente = gestor;
     - analista, assistente e admin = BKO.
   - Perfil de acesso personalizado conta pela base dele (ADR 0033).
   - No multiperfil, o usuário ocupa uma licença só, pela prioridade vendedor > gestor > promotor > bko.
   - Usuário inativo ou excluído não conta. O bloqueado por senha continua contando.
4. **"Por usuário" da Pesquisa e do Treinamento** (RN-PLA-03): é o usuário ativo com o módulo efetivo liberado (perfis menos exceções, RN-CORE-01), de qualquer tipo. O limite é o incluído no plano mais o adicional. Se o plano tem o módulo e não vende o adicional, não há limite.
5. **A trava** (RN-PLA-04).
   - A regra é a função pura `conferirNovoUsuario` do SDK.
   - O Core a aplica no cadastro de usuários do BKO: criar, reativar, mudar perfil e liberar Pesquisa ou Treinamento.
   - Na mesma transação do insert ou update do usuário, o Core lê a situação pela função SQL `plataforma.licencas_do_tenant()`, que é `SECURITY INVOKER`, roda sob RLS e faz `for update` na linha da assinatura. Isso impede que duas criações simultâneas passem do limite.
   - Recusa com 422 e o código `LICENCAS_ESGOTADAS` (com o item) ou `TESTE_VENCIDO`.
   - Empresa sem assinatura (legado anterior aos planos) não trava.
6. **Troca de plano** (RN-PLA-05).
   - É recusada quando o plano novo fica abaixo do uso em qualquer item (422 `PLANO_ABAIXO_DO_USO`, com os problemas). A troca nunca desativa usuário.
   - A API revalida com `conferirTrocaDePlano`, e a `sa_trocar_plano` confere de novo na transação.
   - A troca liga no `tenant_modulo` os módulos de `modulosDaAssinatura` e nunca desliga módulo que tem usuário.
7. **Valor e teste** (RN-PLA-06).
   - Valor mensal = plano + adicionais. No anual, paga-se (12 − `meses_gratis_anual`) × mensal: com 2 meses grátis, 10 × o mensal. Tudo em centavos inteiros.
   - O teste vai de hoje, no fuso da empresa, até hoje + `dias_teste` − 1, inclusive: 14 dias a partir de 2026-11-14 terminam em 2026-11-27.
   - Teste vencido sem pagamento trava só novos usuários e não bloqueia o uso.
8. **Rotas do portal**, ligadas só com `MACUXI_PLANOS=1` (padrão desligado até a migração do banco-dados):
   - `GET /v1/plataforma/planos`: super-admin e admin do cliente;
   - `POST /v1/plataforma/empresas-com-plano`: só super-admin. É o mesmo fluxo do `POST /v1/plataforma/empresas` (`criarEmpresaNoPortal`), com os módulos tirados do plano, e grava a assinatura pela `sa_gravar_assinatura`, idempotente. Com `simular`, não grava;
   - `GET /v1/plataforma/empresas/:tenant_id/assinatura`: super-admin, ou o admin do cliente só da própria empresa. Devolve a ficha com as licenças contratadas e em uso e o valor;
   - `PUT /v1/plataforma/empresas/:tenant_id/assinatura`: só super-admin. É a troca de plano, idempotente por `pedido_id`.
   - Tudo passa pelas funções `SECURITY DEFINER` `sa_*` no banco do portal (`macuxi_portal`). SQLSTATE: 28000 = 401, 42501 = 403, P0002 = 404 e 22023 = 422 na escrita (código no `hint`) ou 400 na leitura.
9. **Legado**: `tenant_modulo.plano/licencas` continua gravado pelo passo Empresa antigo, mas não é lido pela trava. A fonte da trava é só a assinatura.

### RN novas propostas (para o doc 03)
- **RN-PLA-01** Catálogo e adicionais: o plano é dado (preço, licenças por tipo, módulos e adicionais); o adicional só vale se o plano o vende; core e integracao entram sempre.
- **RN-PLA-02** Tipo de licença e contagem: o perfil de base dá o tipo; o multiperfil ocupa uma só, pela prioridade vendedor > gestor > promotor > bko; inativo ou excluído não conta.
- **RN-PLA-03** Por usuário: Pesquisa e Treinamento contam o usuário ativo com o módulo efetivo liberado.
- **RN-PLA-04** Trava: não cria, reativa nem dá perfil ou módulo além do contratado; com teste vencido sem pagamento, não cadastra; sem assinatura, não trava.
- **RN-PLA-05** Troca de plano: recusada abaixo do uso, item a item; nunca desativa usuário.
- **RN-PLA-06** Valor anual e teste: anual = (12 − meses grátis) × mensal; teste de `dias_teste` dias corridos, no fuso da empresa.

### Premissas a confirmar com o Alexandre
1. O mapa perfil → tipo: analista, assistente e admin = BKO; supervisor e gerente = gestor.
2. A prioridade no multiperfil: vendedor > gestor > promotor > bko.
3. O bloqueado por senha continua contando.
4. O teste vencido sem pagamento trava novos usuários, sem bloquear o uso.
5. Os preços e as quantidades vêm só do recado R-20261114-132600-alexandre, pelo seed. Nada disso está no código.

## Alternativas consideradas
- **Planos como constantes no SDK**: descartada. Cada mudança de preço viraria deploy, e o histórico de preço da assinatura se perderia.
- **Trava só na API, sem a função SQL**: descartada. Duas criações simultâneas passariam do limite. O `for update` na assinatura serializa as criações.
- **Reaproveitar `tenant_modulo.licencas`**: descartada. Esse teto é por módulo, não por tipo de usuário, e não tem ciclo, teste nem adicionais.
- **Bloquear o uso quando o teste vence**: descartada por ora (premissa 4). Parar a equipe em campo é pior do que travar só o crescimento.

## Consequências
- O banco-dados cria a migração (tabelas, RLS, `sa_*`, `licencas_do_tenant()`, `*.db.test.ts` e o seed).
- O modulo-core aplica a trava no cadastro do BKO. O engenheiro-apps e o designer-ux fazem as telas do portal.
- O doc 03 ganha as RN-PLA-01..06, pelo gerente.
- Enquanto `MACUXI_PLANOS` estiver desligado, nada muda para as empresas atuais. Depois de ligado, empresa sem assinatura continua sem trava.
