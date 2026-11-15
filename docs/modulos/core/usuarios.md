# Core — Usuários e hierarquia no BKO (T-0067, RF-CORE-02 / RF-CORE-01)

O admin gerencia os usuários do tenant sem SQL. Página "Usuários" no grupo Administração do BKO (`/usuarios`), ao lado de "Usuários e módulos" (licenças, inalterada). Código: `modules/core/{domain/usuarios.ts, contracts/usuarios.ts, api/usuarios.ts, web/components/usuarios, web/lib/usuarios.ts}`.

## Rotas (`/v1/core`, todas exigem licença do módulo `core`, tenant via `comTenant`/RLS)
| Método e caminho | Ação / perfis | O que faz |
|---|---|---|
| `GET /usuarios?q=&perfil=&equipe_id=&ativo=` | `usuario.ver`: supervisor, gerente, admin | Lista (até 1000) recortada pelo escopo de `usuariosVisiveisDoUsuario` (RN-CORE-04): supervisor = equipe, gerente = equipes abaixo, admin = tenant. Superior fora do escopo vem `null`. |
| `GET /equipes` | `usuario.ver` | Equipes para filtro e formulário, com responsável e superior resultante (mesmo recorte). |
| `POST /usuarios` (201) | `usuario.criar` | Cria com senha inicial (argon2id). |
| `PUT /usuarios/:id` | `usuario.editar` | Edita nome, nome curto, e-mail, perfil, equipe, `external_id` (campo ausente = mantém). |
| `PUT /usuarios/:id/ativo` | `usuario.desativar` (nunca o próprio) | Ativa/desativa. Desativar revoga `core.sessao` (refresh) e limpa o push do aparelho. Idempotente. |
| `PUT /usuarios/:id/senha` | `senha.redefinir` | Redefine a senha (zera falhas e bloqueio temporário; revoga sessões). |

Não existe DELETE: usuário nunca é apagado nem recebe `deleted_at`. Perfis aceitos = enum dos contracts (`vendedor, promotor, supervisor, gerente, analista, assistente, admin`, o mesmo do banco).

## Regras
- **Permissão**: quem escreve é decidido pelo motor de permissões (ADR 0033; RN-CORE-35): `usuario.criar|editar|desativar` e `senha.redefinir`, que na fábrica são só do admin; 403 para os demais, checado pelo SDK antes do `executar`; último admin, autogestão e usuário sem perfil saem de `validarAcessoDoTenant` (422 com `ULTIMO_ADMIN`/`USUARIO_AUTORREBAIXA`, e a RN no detalhe `regra`). Leitura: `usuario.ver`. A UI esconde as ações, a API é a proteção real.
- **Desativado perde o acesso na próxima requisição**: `autenticar` (`api/autenticacao.ts`) lê `ativo`/`bloqueado_em` do banco a cada requisição (coberto por `autenticacao.test.ts`, "usuário bloqueado ou inativo não autentica mais"); o refresh também recusa e revoga a família. Além disso a desativação revoga as sessões.
- **Guardas** (`domain/usuarios.ts`): o admin não desativa a si mesmo (`USUARIO_AUTODESATIVACAO`), não rebaixa o próprio perfil (`USUARIO_AUTORREBAIXA`) e o último admin ativo não é desativado nem rebaixado (`ULTIMO_ADMIN`), todos 422. Admins ativos são travados (`for update`) na conferência.
- **Unicidade**: e-mail por tenant sem diferenciar maiúsculas (`usuario_email_uk`) e `external_id` por tenant (`usuario_external_uk`) → 409 `USUARIO_EMAIL_DUPLICADO` / `USUARIO_EXTERNAL_ID_DUPLICADO`, com pré-checagem e tradução do erro 23505 de corrida. O tenant vizinho pode repetir o mesmo e-mail.
- **Senha**: mínimo 8 caracteres, com letras e números, diferente do e-mail (`USUARIO_SENHA_FRACA`, 422). Hash argon2id (`hashSenha`), nunca em log, resposta ou auditoria.
- **Hierarquia**: não há coluna `superior_id`. O superior imediato é derivado da equipe (`core.equipe.responsavel_id`, subindo pela equipe-pai; `montarHierarquia`). O admin escolhe a equipe e a tela mostra o superior resultante. A API recusa campo `superior_id` (contrato `strict`).

## Auditoria (RN-AUD-01, `plataforma.auditoria`, mesma transação)
| acao | antes / depois |
|---|---|
| `usuario.criar` | `null` / `{perfil, equipe_id, ativo, external_id, senha_definida: true, trocar_senha: true, email: 'enfileirado' | 'indisponivel'}` |
| `usuario.editar` | `{campos alterados não pessoais, campos_alterados[]}` / `{novos valores não pessoais}`; nome, nome curto e e-mail só aparecem como nome do campo em `campos_alterados`. Sem mudança, nada é gravado. |
| `usuario.desativar` / `usuario.ativar` | `{ativo}` / `{ativo[, sessoes_revogadas]}` |
| `usuario.senha_redefinir` | `null` / `{trocar_senha: true, sessoes_revogadas: true, gerada: bool, email: 'enfileirado' | 'indisponivel'}` |
| `usuario.senha_trocar` (rota pública `senha/trocar`) | `null` / `{motivo: 'primeiro_acesso' | 'senha_temporaria' | 'voluntaria', sessoes_revogadas: true}` |
| `usuario.senha_esqueci` (rota pública `senha/esqueci`) | `null` / `{email: 'enfileirado' | 'indisponivel'}` |
Nunca entram senha, hash, nome ou e-mail em claro.

## Testes
`domain/usuarios.test.ts`, `api/usuarios.test.ts` (banco falso: 403/permissões, 409, auditoria, revogação, escopo), `web/lib/usuarios.test.ts` e `api/usuarios.db.test.ts` (Postgres real; pula sem Docker, falha com `MACUXI_PG_EXIGIR=1`).

## Pendências (exigem migração ou decisão do dono do doc)
1. **Troca obrigatória de senha no 1º login**: `core.usuario` não tem coluna para isso (ex.: `senha_provisoria boolean` / `senha_trocada_em timestamptz`). Hoje só existe senha inicial e redefinição pelo admin; o admin deve avisar o usuário. Pedir ao `banco-dados` a coluna e, depois, o login devolver `trocar_senha` e o app/BKO forçar a tela de troca.
2. **Superior imediato escolhido diretamente**: exigiria coluna `superior_id` em `core.usuario` (ou equipe individual). Hoje é derivado da equipe; quem não é responsável de equipe nenhuma tem como superior o responsável da equipe.
3. **Gestão de equipes** (criar equipe, definir responsável e equipe-pai) segue só por carga/ERP; esta tela só escolhe equipe existente.
4. **IDs de regra**: as regras novas citam RF-CORE-01/02, RN-CORE-04/05 e RN-AUD-01. Se o gerente quiser, formalizar no doc 03 "RN-CORE-24" (guardas de autodesativação e último admin) e "RN-CORE-25" (desativar revoga sessões).
5. Fonte da senha em CSV/e-mail de boas-vindas e fluxo "esqueci a senha" não existem; fora do escopo.

## Senha por e-mail, troca no 1º uso e "Esqueci a senha" (T-0094; ADR 0032; RN-CORE-33/34)
Desenho: `docs/desenho/T-0094.md`; textos e telas: `docs/design/ciclo-de-senha.md`. Resolve a pendência 1 e a 5 acima.
- **Criar** (`POST usuarios`): a senha inicial (RN-CORE-32; o BKO oferece "Gerar senha" no navegador) vira **temporária**: `trocar_senha = true`, `senha_expira_em = agora + 72 h`,
  e vai por e-mail (`acesso_inicial`, `ctx.email`, mesma transação). Resposta: o item + `email_acesso` (`enfileirado` | `indisponivel`; sem e-mail o usuário nasce do mesmo jeito e o
  BKO mostra a senha uma vez). O item ganha `trocar_senha`, `senha_expira_em`, `sem_senha`.
- **Redefinir** (`PUT usuarios/:id/senha`, corpo `{ senha? }`): só `senha.redefinir` (admin na fábrica, P2; com os perfis-alvo); **não** a própria conta nem um admin (P7: 422 `SENHA_PROPRIA` / `SENHA_DE_ADMIN`), alvo ativo
  (422 `USUARIO_INATIVO`). Ausente a senha, o servidor gera (12 caracteres) e a manda só por e-mail; sem e-mail configurado, 503 `EMAIL_INDISPONIVEL` antes de mexer. Grava
  `trocar_senha = true` (72 h), limpa a temporária do "Esqueci", zera tentativas e bloqueio, `sessao_versao + 1` e revoga os refresh. Usuário "Sem senha" recebe o modelo
  `acesso_inicial` ("Enviar acesso"). Desativar também sobe a `sessao_versao`.
- **Sessões**: o token de acesso leva `sv` = `sessao_versao`; `autenticar` recusa (401) o token com versão diferente na próxima requisição (token antigo, sem `sv`, vale 0).
- **Login** (`POST /v1/auth/login`, `app` opcional): sempre 2 conferências argon2id; senha certa e temporária → 403 `SENHA_A_TROCAR` (`detalhes {motivo, expira_em}`, sem sessão e sem `ultimo_login_em`);
  72 h vencidas → 410 `SENHA_TEMPORARIA_VENCIDA`; perfil fora do app → 403 `PERFIL_FORA_DO_APP` (RN-CORE-33). Tudo só depois da senha certa.
- **`POST /v1/auth/senha/trocar`** ("Crie sua senha"): `{ codigo_empresa, email, senha_atual, senha_nova, app?, dispositivo_* }` → `SessaoResposta`; 422 `RN-CORE-32` (faltas) e 422 `RN-CORE-34` (repetiu a senha usada).
- **`POST /v1/auth/senha/esqueci`**: 202 `{}` sempre igual; limites 5/15 min por IP e 3/h por empresa+e-mail (429 igual para e-mail que não existe), 15 min no banco; grava a temporária PARALELA
  (a senha atual continua valendo, P6) e manda `nova_senha`.
- **Rotas do BKO** (`superficie: 'bko'`): usuários, equipes, Equipe por CSV, licenças e parâmetros do Início. `usuario.ver` é do gerente e do admin (o supervisor não usa o BKO).
- Testes: `domain/acesso-senha.test.ts`, `api/senha-acesso.test.ts`, `api/autenticacao.test.ts`, `api/usuarios.test.ts`, `web/lib/usuarios.test.ts`, `app/lib/senha.test.ts`.

## Perfis de acesso, cargo e hierarquia (T-0111/T-0112; ADR 0033, ADR 0049)

- Rotas `/v1/core/perfis` (lista, opções do cadastro, criar, detalhe, editar, histórico), todas por `perfil.gerir` (opções: `usuario.ver`). Contrato: `modules/core/contracts/perfis.ts`; regras: `modules/core/domain/perfis.ts` (código do nome, diferença da fábrica, limites por `validarAcessoDoTenant`, diff de auditoria); rotas: `modules/core/api/perfis.ts`.
- O PUT recebe o conjunto de permissões concedidas e grava só a diferença da fábrica em `plataforma.perfil_permissao`; as chaves fora da tela (`notificacao.ler`, `dispositivo.registrar_push`, `parametro.promotor_ve_pedidos`) nunca viram revogação.
- Usuário: um perfil só (RN-CORE-54, ADR 0049). `perfis` em criar/editar é a lista de um item (mais de um: 422); a base dele vai em `core.usuario.perfil` e o vínculo em `plataforma.usuario_perfil`. O cargo vem do perfil (RN-CORE-53) e define o que o cadastro pede: supervisor, gerente e nome da equipe (RN-CORE-55/56); código no ERP obrigatório (RN-CORE-57). Login e `/me/modulos` leem `plataforma.perfis_do_usuario`.
- Pendências conhecidas: ligar/desligar módulo por perfil personalizado (hoje só o padrão copiado da base; use Usuários e módulos), prévia de módulos efetivos no formulário, níveis em `pedido.*`/`meta.editar` (aguardam as chaves, spec §13) e `promotor_ve_pedidos` → `pedido.ver`.

## Parâmetros de desconto (T-0168, RN-VEN-11a)
- Aba **Parâmetros** do usuário (BKO): "Limitar desconto por item" (padrão Sim), "Limitar desconto por pedido" (padrão Não) e "Desconto máximo do pedido (%)", que só aparece com "por pedido" ligada (uma casa, de 0 a 100; vazio = "Obrigatório"). Desligar mantém o valor guardado.
- API: os mesmos `POST /v1/core/usuarios` e `PUT /v1/core/usuarios/:id` (ação `usuario.editar`) com `desconto_limita_item`, `desconto_limita_pedido` e `desconto_maximo_pedido_permil` (décimos de %: 8,0% = 80). "Por pedido" sem o número: 422 `USUARIO_DADOS_INVALIDOS` ("Informe o desconto máximo do pedido."). Os três campos entram no antes/depois da auditoria.
- Sync: entidade `usuario` (pull, escopo `usuarios`) só com os três campos; consulta `core.cadastro_resumo@1` traz os mesmos campos, opcionais, em `usuarios[]`. Padrão: `LIMITE_DESCONTO_PADRAO`.

## Lista de Clientes (T-0171, RN-CORE-41)
- Uma tag (Bloqueado > Devendo > Pré-Cadastro > Em dia) e só a última visita ("Visitado hoje/ontem/há N dias", "Nunca visitado"). Pré-Cadastro = cliente sem código do ERP (`external_id` vazio).
- Última visita: `ultima_visita_em` do `cliente_visita_resumo@1` (id = cliente; último check-in concluído de qualquer vendedor, data no fuso do tenant; ver `performance-cliente.md`) somada aos check-ins feitos no aparelho. Funções puras em `domain/lista-clientes.ts`.

## Vendedor do ERP ligado ao usuário do BKO (T-0175, RN-CORE-58)
- **Código no ERP** (`external_id`) é o vínculo: editável em Novo e Editar (vendedor e promotor). Código repetido responde 409; se o dono do código é um provisório (`@sem-email.invalid`), a mensagem manda usar "Vincular vendedor do ERP".
- A carga do ERP que cria um provisório avisa os admins (notificação de sistema, só o código do ERP). A lista de Usuários busca também pelo código e filtra "Provisórios" (`provisorio=true`).
- `POST /v1/core/usuarios/:id/vincular-erp` (`usuario.editar`, corpo `{ usuario_id }`): uma transação; o real recebe o código, a carteira (sem duplicar), `nota_erp`, rotas, metas e indicadores; o provisório é desativado e sai da lista (`deleted_at`, mantém o código para a repetição ser idempotente); auditoria `usuario.vincular_erp`; um `core.cliente.atualizado@1` por cliente movido. Plano puro em `domain/vinculo-erp.ts` (`planejarVinculoErp`); recusas 422 `VINCULO_*`.
- A carga seguinte casa pelo `external_id`: não recria o provisório, só troca e-mail provisório por e-mail real livre (nunca o e-mail real do vínculo) e não mexe na carteira.

## Código FDV (T-0175, RN-CORE-59; aguarda a migração e a simulação das telas)
- **RN-CORE-59 — Código FDV.** Vendedor e promotor têm dois códigos: o Código ERP (`external_id`) e o Código FDV, próprio do Macuxi. É gerado pelo banco, em sequência por empresa (`FDV-0001`, `FDV-0002`…, mínimo de 4 dígitos, cresce além de 9999), único por empresa, só de leitura e nunca reaproveitado. Criar ou editar com `codigo_fdv` no corpo responde 422 `CODIGO_FDV_SOMENTE_LEITURA` (o schema aceita o campo só para a API recusar com 422; o `.strict()` daria 400). No vínculo do ERP o usuário real mantém o próprio código e o provisório desativado não libera o dele.
- Domain: `formatarCodigoFdv`, `validarCodigoFdv`, `proximoSequencialFdv`, `recusarCodigoFdvNoCorpo` (`domain/codigo-fdv.ts`).
- Contrato aditivo: `codigo_fdv` (texto ou nulo) em `UsuarioItem` (lista, detalhe, criar) e em `UsuarioSync`. A busca `q` da lista inclui o código.
- API tolerante: `COLUNA_CODIGO_FDV_PRONTA = false` em `api/codigo-fdv.ts` devolve `null` e ignora o código na busca; vira `true` no PR da migração.
- Migração (banco-dados): coluna `core.usuario.codigo_fdv text`; índice único `(tenant_id, codigo_fdv)` entre os vivos (`deleted_at is null`, `codigo_fdv is not null`); contador por tenant em tabela própria (`tenant_id`, `ultimo_sequencial`, com a regra de colunas padrão) e gatilho `before insert` que incrementa com `update ... returning` (atômico, linha travada) e grava `FDV-` + sequencial com `lpad` de 4; gatilho `before update` que recusa mudar o `codigo_fdv` gravado; backfill dos usuários vivos por `created_at, id`, e o contador termina no maior emitido; apagado não devolve número (o contador nunca decresce); no vínculo do ERP nada muda no código: o real mantém o dele e o provisório (desativado, apagado) mantém o seu, fora da unicidade dos vivos mas dentro do contador.
