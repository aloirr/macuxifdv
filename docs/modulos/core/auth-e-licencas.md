# Core — autenticação e licenças (T-0003, Fase 2)

Fonte: `modules/core/{contracts,domain,api,app,web}`. Regras: RF-CORE-01/02, RN-CORE-01..05.

## Rotas
| Rota | Quem | Observações |
|---|---|---|
| `POST /v1/auth/login` | público | `{ codigo_empresa, email, senha, dispositivo_id? }`; limite 5/5 min por IP + código da empresa (429 `MUITAS_TENTATIVAS`). Código, e-mail ou senha errados: a MESMA resposta (401 `CREDENCIAIS_INVALIDAS`). Nome e fuso do tenant só saem depois da senha validada |
| `POST /v1/auth/refresh` | público | refresh rotativo (cada um vale uma vez); reuso de refresh já trocado revoga a família inteira (401 `SESSAO_INVALIDA`) |
| `POST /v1/auth/logout` | público | revoga a família; resposta igual para token desconhecido |
| `GET /v1/me/modulos` | plataforma (T-0004) | módulos efetivos por requisição; não é do Core |
| `GET /v1/core/licencas` | admin | estado tenant → perfil → usuário (+ `dependencias` quando a plataforma fornecer `ctx.dependencias`) |
| `PUT /v1/core/licencas/tenant/:modulo` · `.../perfis/:perfil/:modulo` · `.../usuarios/:id/:modulo` | admin (`modulo.gerir_licencas`) | `{ ativo }`; `core` não desliga (422 `RN-CORE-01`); exceção do usuário só remove; grava auditoria e publica `core.usuario.modulos_alterados@1` |
| sync pull `cliente`, `carteira`, `produto` | token | horizonte seguro, cursor `(updated_at, id)`, carteira (RN-CORE-04) |

## Sessão
- JWT HS256, 15 min, só `sub`, `tid`, `perfil`, `iat`, `exp` (nunca licença). Segredo em `MACUXI_JWT_SEGREDO` (mín. 32 caracteres); sem ele o login responde 503 e ninguém autentica.
- `autenticar` consulta `core.usuario` a cada requisição: bloqueio remoto, inativação e troca de perfil valem na hora.
- Refresh opaco `<tenant_id>.<segredo>`; o banco guarda o sha256 do segredo (`core.sessao`).
- Bloqueio: 5 falhas seguidas bloqueiam 15 min; senha certa zera. Bloqueio, inativo e aparelho bloqueado só são revelados (423 `USUARIO_BLOQUEADO`) a quem acertou a senha.
- Senha: argon2id PHC (Node >= 24.7, `crypto.argon2`). Log sem e-mail, senha ou token.

## Pendências de outros donos (T-0003 Fase 2)
- banco-dados: migração 0004 (`core.sessao`, `core.dispositivo`, `core.usuario.tentativas_falhas`/`bloqueio_ate`) — o SQL de `api/repositorio.ts` espera esses nomes; os testes do Core usam repositório em memória.
- engenheiro-software: `ErroHttpModulo` (401/423/503 hoje saem 422 com o mesmo `codigo`); `ctx.dependencias`; `MACUXI_JWT_SEGREDO` no `.env.example`/servidor; ligar `TelaLogin`/`entrarComSenha` no shell e remover o login de demonstração; testes com `createApp` em `apps/api/test/core.test.ts`.
