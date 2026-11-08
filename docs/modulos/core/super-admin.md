# Acesso ao portal de implantação (Core) — T-0087 (ADR 0029), revisto na T-0093 (ADR 0031)

Entrada do time da Macuxi (super-admin) e do `admin` do cliente no portal `config.`, **só com e-mail e senha** (sem TOTP e sem convite).
Desenho: `docs/desenho/T-0093.md` §2–§4 e §8 · regras: RN-CORE-31, RN-CORE-32 (senha), RN-CORE-33 (quem entra) · código:
`modules/core/domain/super-admin.ts` (regras puras), `domain/senha.ts` (RN-CORE-32), `modules/core/api/super-admin*.ts`,
`seguranca-plataforma.ts`, contratos em `modules/core/contracts/plataforma.ts` e `senha.ts` (schemas Zod no `platform-sdk`).

## Rotas públicas (`POST /v1/plataforma/auth/*`, `conexao: 'portal'`)
| Rota | Limite por IP | Resposta | Erros |
|---|---|---|---|
| `login` | 10 / 5 min | `SessaoPortal` | 401 `CREDENCIAIS_INVALIDAS` (e-mail inexistente = senha errada), 423 `BLOQUEADO` (também e-mail inexistente), 503 `PORTAL_INDISPONIVEL` |
| `empresa` (token no `Authorization`) | 30 / 5 min | `SessaoPortal` com token novo | 403 `EMPRESA_NAO_PERMITIDA`, 401 `SESSAO_PLATAFORMA_INVALIDA` |
| `renovar`, `sair` (204) | 10 / 5 min | `SessaoPortal` / — | 401 `SESSAO_PLATAFORMA_INVALIDA` |

`EMPRESA_NAO_ESCOLHIDA` (409) é do `apps/api` (fatia S): rota de módulo com token do admin do cliente que ainda não escolheu empresa.

## Regras
- Único segredo: `MACUXI_JWT_SEGREDO_PLATAFORMA` (≥ 32); falta = 503. Sem `MACUXI_CHAVE_TOTP` nem `MACUXI_SUPERADMIN_CONVITE`.
- Bloqueio: 5 falhas seguidas na chave `HMAC-SHA256(segredo, "portal.login:" + e-mail)` = 15 min, conferido antes de tudo; o e-mail não vai à tabela de tentativas.
- Login: `sa_contas_para_login` (até 20), senhas conferidas em paralelo (`Promise.all`); sem conta, `gastarTempoDeSenha` uma vez, para igualar o custo.
  Precedência do super-admin; admin do cliente só recebe as empresas em que a senha conferiu (`decidirAcessoDoLogin`, no domain).
- Token: JWT HS256, `aud=macuxi-plataforma`, `amr=["pwd"]`, `typ` `sa`|`cli`, 15 min, teto de 8 h. `sub` = super-admin | usuário da empresa | `sid` (sem
  empresa); `tid` = empresa escolhida. `autenticarPortal` confere assinatura, `aud`, `typ`, prazo e a sessão viva (`sa_sessao_valida`: tipo, `sub` e `tid`
  iguais). Trocar de empresa mata o token anterior; token sem `typ` (ADR 0029) é recusado.
- Auditoria (`sa_auditar`): `sa.login.ok`, `sa.login.falha` (motivo `credenciais` ou `bloqueado`), `sa.empresa.escolher` (recusa), `sa.sair`. Só ids, `ator_tipo`,
  motivo, contagens, `request_id` e prefixo do IP. Nada de e-mail, senha ou token, nem em log.
- RN-CORE-32 (`domain/senha.ts`): 8 a 200 caracteres (pontos de código), com letra, número e caractere especial; `validarSenhaInicial` usa a regra e a API
  responde 422 `USUARIO_SENHA_FRACA` com `detalhes.faltas`. O login aceita qualquer senha já gravada.

## Testes
`domain/senha.test.ts` (cada falta, combinações, acento, emoji, espaço, 7/8/200/201), `domain/super-admin.test.ts` (bloqueio, precedência, teto),
`api/super-admin.test.ts` (fluxo completo com repositório em memória: mesma resposta e mesmo número de conferências, 423 para e-mail inexistente,
duas empresas, troca de empresa, token sem `typ`, auditoria e log sem dado pessoal). O SQL real (`fabricaSuperAdminSql`) é exercitado pelos testes de banco e pelo CI.
