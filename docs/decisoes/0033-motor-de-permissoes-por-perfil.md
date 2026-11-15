# ADR 0033 — Motor de permissões por perfil de acesso: chaves estáveis, padrão de fábrica com sobreposições por tenant, multiperfil e limites travados

- **Status**: **proposta** em 2026-11-07 (aceita com o ok do gerente-projetos; o §6 tem um ponto para o dono do produto confirmar).
- **Revista por**: [0049](0049-cargos-fixos-e-um-perfil-por-usuario.md) — um perfil por usuário; o multiperfil (§6) não vale mais.
- **Data**: 2026-11-07
- **Tarefa**: T-0111 (motor), T-0112 (multiperfil); entra junto com a T-0094
- **Autor**: engenheiro-software
- **Regras**: RN-CORE-01, RN-CORE-04, RN-CORE-32, RN-CORE-33, RN-CORE-34, RN-CORE-35, RN-PRO-01, RN-AUD-01
- **Relacionadas**: [0004](0004-permissao-por-acao-no-manifesto.md) (ação no manifesto, que vira o padrão de fábrica),
  [0025](0025-consulta-pela-licenca-do-tenant.md) (licença por requisição), [0031](0031-portal-so-email-e-senha.md) e
  [0032](0032-ciclo-de-senha-dos-usuarios.md) (portal, ciclo de senha, `superficie: 'bko'`)

## Contexto
O dono do produto decidiu (R-20261107-185546) que "quem pode o quê" e o controle de senhas não ficam fixos no código: ficam na
página **Perfis de acesso** do BKO, editada pelo admin do cliente, com valores iniciais (a matriz do doc 03 §2 e as premissas P2,
P5–P8 da T-0094), perfis personalizados a partir de um perfil base, auditoria e efeito na próxima requisição. Alguns limites ficam
travados. E o usuário pode ter mais de um perfil (R-20261107-173950 c; RN-CORE-01).
Hoje a permissão por ação está no manifesto (`acoes[x].perfis`, ADR 0004), igual para todos os tenants; o escopo de dados sai do
perfil (`escopoDoPerfil`); onde cada perfil entra é a lista `PERFIS_DO_APP`; e o Core tem checagens fixas como "só o admin"
(`podeGerirUsuarios`, `podeRedefinirSenha`).

## Decisão
1. **Chaves estáveis.** Toda permissão é uma chave `<entidade>.<verbo>`.
   - **Da plataforma** (o SDK é o dono, `CHAVES_PLATAFORMA`; nenhum manifesto as declara, `validarConjunto` acusa):
     `acesso.campo`, `acesso.gestao`, `acesso.bko`, `acesso.portal` (onde entra); `dados.escopo` (escopo de dados, com nível);
     `usuario.criar`, `usuario.editar`, `usuario.desativar`; `senha.redefinir` (com os perfis-alvo); `perfil.gerir`.
   - **Dos módulos**: as ações que já existem no manifesto (`pedido.criar`, `produto.consultar`, `coleta.registrar`,
     `meta.editar`, `monitor.ver`…). Os nomes não mudam (UI, API e testes já usam). A página agrupa por **área**
     (`areaDaAcao`: o módulo dá a área — vendedor = pedidos, promotor = trade, catálogo, pesquisa, treinamento, gestão,
     integração; no Core, a entidade — `meta`/`plano_rv`/`rv` = metas, `cliente`/`carteira` = clientes, o resto = administração).
     Quando o desenho da página for aprovado, os módulos acrescentam as chaves que faltam (ex.: `cliente.transferir`,
     `catalogo.exportar`) e, onde a página pede nível (pedido "próprio · equipe · qualquer", aprovar "até a alçada · acima"),
     o nível entra na mesma chave (`FAMILIAS_NIVEL`: escopo `proprio < carteira < equipe < equipes_abaixo < tenant`; alçada
     `ate_alcada < acima_alcada`), cada um no seu módulo, por recado.
   - **Valor**: concedida ou não; se a chave tem nível, o `nivel`; se tem alvos, a lista de códigos de perfil ou `*` (todos os
     perfis que não são de base admin, inclusive os criados depois).
2. **Padrão de fábrica + sobreposições.** `matrizDeFabrica(manifestos)` = as chaves da plataforma por perfil base (fábrica do
   SDK) + o `perfis` de cada ação dos manifestos instalados. O `perfis` do manifesto deixa de ser "a regra" e passa a ser **o valor
   inicial**. O banco guarda **só o que o tenant mudou** (`perfil_permissao`: chave, concedida, nível, alvos). Efeito: ação nova de
   um módulo chega a todos os tenants pelo valor de fábrica, sem migração de dados; "restaurar o padrão" = apagar as linhas.
3. **Perfil base × personalizado.** O tenant tem os 7 perfis de fábrica (código = o perfil base; não são apagados nem desativados)
   e os personalizados (código próprio, criados a partir de uma base que não muda depois). O personalizado herda da base onde entra,
   o escopo e as ações; o admin ajusta. Os módulos padrão do perfil (`perfil_modulo`, RF-CORE-03) passam a ser por código de perfil.
4. **Resolução por requisição.** A API lê os perfis do usuário com as licenças (mesma transação, RLS), resolve cada um
   (`resolverPerfil`: fábrica da base → sobreposições → limites do perfil) e entrega em `ctx.usuario.perfis`. Nada vai para o JWT:
   a mudança vale na próxima requisição, sem novo login (como a licença). Consulta:
   - na rota inteira: `acao` da `RotaModulo` (qualquer chave, inclusive as da plataforma): licença do módulo dono (403
     `MODULO_INATIVO`) e depois o motor (403 `PERFIL_SEM_ACESSO`), em `verificarAcao`;
   - no meio do `executar`: `pode(ctx.usuario.perfis, chave, alvo?)`, `nivelPermitido`, `escopoDosPerfis`, `podeEntrar`,
     `exigirPermissao` (403). **Ninguém compara perfil com nome fixo** (aviso R-20261107-191310).
   - Sem perfis no contexto (shell antigo, contexto falso de teste) vale o manifesto como antes; a API sempre preenche.
   - Enquanto a fonte não lê as tabelas novas, a API usa o perfil de fábrica do token: o comportamento é idêntico ao de hoje
     (teste de equivalência em todas as ações × perfis).
5. **Limites travados** (nenhuma sobreposição vence; a página mostra o cadeado com `travaDaChave`):
   - **RN-CORE-33**: perfil de base vendedor, promotor ou supervisor (e os derivados) não tem `acesso.bko` nem `acesso.portal`;
     `acesso.portal` só em base admin.
   - **RN-PRO-01**: perfil de base promotor não tem ação de escrita de pedido.
   - **RN-CORE-04**: o escopo de dados nunca passa o da base.
   - **Senhas**: `senha.redefinir` nunca vale sobre o próprio usuário nem sobre quem tem perfil de base admin (P7); o alvo só é
     coberto se TODOS os perfis dele estão na lista. `usuario.desativar` nunca no próprio.
   - **Último admin e autogestão**: sempre há um usuário ativo com perfil de base admin, que entra no BKO e tem `perfil.gerir`,
     `usuario.criar`, `usuario.editar` e `usuario.desativar`; quem tinha essa gestão não a tira de si.
   - Perfis de fábrica presentes e ativos; base imutável; código único; todo usuário com ao menos um perfil ativo (RN-CORE-01).
   - **RN-CORE-32** vale para toda senha: nenhuma chave a desliga.
   Os limites por perfil valem na leitura (`resolverPerfil`, falha fechada, mesmo com linha inválida no banco). Os do tenant são
   validados em toda escrita por `validarAcessoDoTenant` (domain do Core e API, 422 com a RN), antes de gravar. Para o último
   admin, a autogestão, o alvo admin, a fábrica e a base imutável, proponho registrar **RN-CORE-35 "Limites dos perfis de acesso"**
   no doc 03 (o código já usa `RN-CORE-35`).
6. **Multiperfil (RN-CORE-35, confirmada pelo dono do produto em 07/11/2026; R-20261107-203658).** Nas **ações** vale a
   **união** dos perfis (chave concedida em algum; nível mais alto; alvos somados; módulos = união dos módulos dos perfis ∩ licença
   do tenant − exceções). Os limites de ação (RN-PRO-01: escrita de pedido) travam o **perfil**, não o usuário: saem do perfil de
   base promotor em `resolverPerfil`, e quem também é vendedor **cria pedido pelo perfil de vendedor**. Nos **acessos** (BKO e
   portal, RN-CORE-33) vale a **regra mais restritiva**: basta um perfil de base vendedor, promotor ou supervisor para fechar o BKO e
   o portal, e um que não seja admin para fechar o portal (`combinarPerfis`). Na API, a barreira da RN-PRO-01 na rota de pedido
   vale quando TODOS os perfis do usuário são de base promotor; `superficie: 'bko'` usa `podeEntrar(perfis, 'bko')`.
   Revisão de 07/11 (T-0094 S): a primeira versão aplicava a mais restritiva também à RN-PRO-01 (vendedor + promotor sem pedido);
   o dono citou exatamente esse caso como quem acumula funções, e a regra mudou para a acima.
   Leitura por requisição: `plataforma.perfis_do_usuario(usuario)` (0041, SECURITY INVOKER, na transação das licenças), que
   devolve os perfis vivos e ativos com as sobreposições e os módulos padrão de cada um.
7. **Licença e `RotaModulo`.** A licença continua antes da permissão e independente dela: chave de módulo inativo para o usuário
   não vale (RN-CORE-02). `RotaModulo.perfis` (rota sem ação) aceita qualquer perfil base do usuário. `superficie: 'bko'`
   (ADR 0032) passa a consultar `acesso.bko` dos perfis; o `app` do login, `acesso.campo|gestao|bko`. `PERFIS_DO_APP` fica
   como legado do shell até ele ler as chaves de `GET /v1/me/modulos`.
8. **Fora do motor**: o super-admin da Macuxi não é usuário do tenant (entra como o Admin de fábrica nas rotas `superAdmin`) e
   redefine a senha do admin do cliente pelo portal (rota `'exige'`); o portal continua só do admin (ADR 0031).

## Alternativas
- **Materializar a matriz inteira por tenant** (uma linha por perfil × chave): a página leria as linhas direto, mas cada ação nova
  de módulo exigiria semear todos os tenants, e um tenant esquecido ficaria sem a ação (falha fechada silenciosa). Recusada:
  sobreposição sobre a fábrica.
- **Renomear as ações por área** (`pedidos.criar`, `trade.coleta`…): quebraria UI, API, testes e o registro de ações sem ganho; a
  área é atributo. Recusada.
- **Permissões no JWT**: contraria a licença por requisição (RN-CORE-01) e a regra "vale sem novo login". Recusada.
- **Multiperfil pela regra mais permissiva também nos acessos**: abriria o BKO a quem é vendedor + analista. Recusada (o mais
  restritivo vence nos acessos).
- **Multiperfil pela regra mais restritiva também nas ações** (versão inicial desta ADR): vendedor + promotor não venderia, o que
  contraria o dono do produto (o promotor que também vende). Recusada pela RN-CORE-35.
- **Tabelas no schema `core`**: a plataforma lê os perfis a cada requisição, como `perfil_modulo` e `usuario_modulo`, que já
  estão em `plataforma` e são escritas pelo Core. Recusada: `plataforma`.

## Consequências
- Banco (banco-dados): `plataforma.perfil`, `plataforma.perfil_permissao`, `plataforma.usuario_perfil`; `perfil_modulo` por
  código; semeadura dos 7 perfis de fábrica e de `usuario_perfil` a partir de `core.usuario.perfil` em todos os tenants (base e
  demo), sem usuário órfão; provisionamento (RN-CORE-31) cria os perfis de fábrica.
- Core (modulo-core): troca `usuario.gerir` e as checagens fixas pelas chaves; o domain chama `validarAcessoDoTenant`; o login
  confere `acesso.*`; `carteira`/`usuariosVisiveis` passam a usar `escopoDosPerfis`.
- API (engenheiro-software): a fonte de licenças lê os perfis (lote 2); `superficie: 'bko'` consulta `acesso.bko`.
- Shells (engenheiro-apps): `GET /v1/me/modulos` ganha as chaves efetivas; o shell esconde pelo que o servidor manda (lote 2).
- Mudar o valor de fábrica de uma ação existente muda os tenants que não a sobrepuseram: é mudança de contrato (aviso a todos e
  nota no registro `.coord/contratos/permissoes.md`).
- Custo por requisição: uma consulta a mais na transação das licenças e a resolução em memória (dezenas de chaves).

## Nota de 15/11/2026 (T-0173, aditiva)
`ContextoConsulta` ganha `permissoes?: MotorPermissoes`, o mesmo valor de `ContextoBase.permissoes`. A API preenche em toda
`tx.consultar` (rota, consumidor, tarefa, Conector e consulta aninhada), para o Core conferir a permissão efetiva de um usuário
(`core.credencial_conferir@1`, `core.usuarios_com_acao@1`) sem importar manifesto de outro módulo. Campo opcional: nada quebra.
