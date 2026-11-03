# Core — Usuários e hierarquia no BKO (T-0067, RF-CORE-02 / RF-CORE-01)

O admin gerencia os usuários do tenant sem SQL. Página "Usuários" no grupo Administração do BKO (`/usuarios`), ao lado de "Usuários e módulos" (licenças, inalterada). Código: `modules/core/{domain/usuarios.ts, contracts/usuarios.ts, api/usuarios.ts, web/components/usuarios, web/lib/usuarios.ts}`.

## Rotas (`/v1/core`, todas exigem licença do módulo `core`, tenant via `comTenant`/RLS)
| Método e caminho | Ação / perfis | O que faz |
|---|---|---|
| `GET /usuarios?q=&perfil=&equipe_id=&ativo=` | `usuario.ver`: supervisor, gerente, admin | Lista (até 1000) recortada pelo escopo de `usuariosVisiveisDoUsuario` (RN-CORE-04): supervisor = equipe, gerente = equipes abaixo, admin = tenant. Superior fora do escopo vem `null`. |
| `GET /equipes` | `usuario.ver` | Equipes para filtro e formulário, com responsável e superior resultante (mesmo recorte). |
| `POST /usuarios` (201) | `usuario.gerir`: admin | Cria com senha inicial (argon2id). |
| `PUT /usuarios/:id` | `usuario.gerir` | Edita nome, nome curto, e-mail, perfil, equipe, `external_id` (campo ausente = mantém). |
| `PUT /usuarios/:id/ativo` | `usuario.gerir` | Ativa/desativa. Desativar revoga `core.sessao` (refresh) e limpa o push do aparelho. Idempotente. |
| `PUT /usuarios/:id/senha` | `usuario.gerir` | Redefine a senha (zera falhas e bloqueio temporário; revoga sessões). |

Não existe DELETE: usuário nunca é apagado nem recebe `deleted_at`. Perfis aceitos = enum dos contracts (`vendedor, promotor, supervisor, gerente, analista, assistente, admin`, o mesmo do banco).

## Regras
- **Permissão**: só admin escreve (`usuario.gerir` no manifesto e na matriz; 403 para os demais, checado pelo SDK antes do `executar`). Leitura: `usuario.ver`. A UI esconde as ações, a API é a proteção real.
- **Desativado perde o acesso na próxima requisição**: `autenticar` (`api/autenticacao.ts`) lê `ativo`/`bloqueado_em` do banco a cada requisição (coberto por `autenticacao.test.ts`, "usuário bloqueado ou inativo não autentica mais"); o refresh também recusa e revoga a família. Além disso a desativação revoga as sessões.
- **Guardas** (`domain/usuarios.ts`): o admin não desativa a si mesmo (`USUARIO_AUTODESATIVACAO`), não rebaixa o próprio perfil (`USUARIO_AUTORREBAIXA`) e o último admin ativo não é desativado nem rebaixado (`ULTIMO_ADMIN`), todos 422. Admins ativos são travados (`for update`) na conferência.
- **Unicidade**: e-mail por tenant sem diferenciar maiúsculas (`usuario_email_uk`) e `external_id` por tenant (`usuario_external_uk`) → 409 `USUARIO_EMAIL_DUPLICADO` / `USUARIO_EXTERNAL_ID_DUPLICADO`, com pré-checagem e tradução do erro 23505 de corrida. O tenant vizinho pode repetir o mesmo e-mail.
- **Senha**: mínimo 8 caracteres, com letras e números, diferente do e-mail (`USUARIO_SENHA_FRACA`, 422). Hash argon2id (`hashSenha`), nunca em log, resposta ou auditoria.
- **Hierarquia**: não há coluna `superior_id`. O superior imediato é derivado da equipe (`core.equipe.responsavel_id`, subindo pela equipe-pai; `montarHierarquia`). O admin escolhe a equipe e a tela mostra o superior resultante. A API recusa campo `superior_id` (contrato `strict`).

## Auditoria (RN-AUD-01, `plataforma.auditoria`, mesma transação)
| acao | antes / depois |
|---|---|
| `usuario.criar` | `null` / `{perfil, equipe_id, ativo, external_id, senha_definida: true}` |
| `usuario.editar` | `{campos alterados não pessoais, campos_alterados[]}` / `{novos valores não pessoais}`; nome, nome curto e e-mail só aparecem como nome do campo em `campos_alterados`. Sem mudança, nada é gravado. |
| `usuario.desativar` / `usuario.ativar` | `{ativo}` / `{ativo[, sessoes_revogadas]}` |
| `usuario.senha_redefinir` | `null` / `{senha_alterada: true, sessoes_revogadas: true}` |
Nunca entram senha, hash, nome ou e-mail em claro.

## Testes
`domain/usuarios.test.ts`, `api/usuarios.test.ts` (banco falso: 403/permissões, 409, auditoria, revogação, escopo), `web/lib/usuarios.test.ts` e `api/usuarios.db.test.ts` (Postgres real; pula sem Docker, falha com `MACUXI_PG_EXIGIR=1`).

## Pendências (exigem migração ou decisão do dono do doc)
1. **Troca obrigatória de senha no 1º login**: `core.usuario` não tem coluna para isso (ex.: `senha_provisoria boolean` / `senha_trocada_em timestamptz`). Hoje só existe senha inicial e redefinição pelo admin; o admin deve avisar o usuário. Pedir ao `banco-dados` a coluna e, depois, o login devolver `trocar_senha` e o app/BKO forçar a tela de troca.
2. **Superior imediato escolhido diretamente**: exigiria coluna `superior_id` em `core.usuario` (ou equipe individual). Hoje é derivado da equipe; quem não é responsável de equipe nenhuma tem como superior o responsável da equipe.
3. **Gestão de equipes** (criar equipe, definir responsável e equipe-pai) segue só por carga/ERP; esta tela só escolhe equipe existente.
4. **IDs de regra**: as regras novas citam RF-CORE-01/02, RN-CORE-04/05 e RN-AUD-01. Se o gerente quiser, formalizar no doc 03 "RN-CORE-24" (guardas de autodesativação e último admin) e "RN-CORE-25" (desativar revoga sessões).
5. Fonte da senha em CSV/e-mail de boas-vindas e fluxo "esqueci a senha" não existem; fora do escopo.
