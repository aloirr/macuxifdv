# Super-admin de plataforma (Core) — T-0087, ADR 0029

Identidade do operador da Macuxi, fora dos tenants. Desenho: `docs/desenho/T-0087.md` §2–§4 · regra: RN-CORE-31 · código:
`modules/core/domain/super-admin.ts` (regras puras), `modules/core/api/super-admin*.ts`, `seguranca-plataforma.ts`, contratos em
`modules/core/contracts/plataforma.ts` (schemas Zod no `platform-sdk`, `plataforma.ts`).

## Rotas públicas (`POST /v1/plataforma/auth/*`)
| Rota | Limite por IP | Resposta | Erros |
|---|---|---|---|
| `primeiro-acesso` | 5 / 15 min | `EtapaLogin` (`cadastrar_totp`) | 410 `PRIMEIRO_ACESSO_ENCERRADO`, 401 `CONVITE_INVALIDO`, 503 `PORTAL_INDISPONIVEL` |
| `login` | 10 / 5 min | `EtapaLogin` (`segundo_fator` ou `cadastrar_totp`) | 401 `CREDENCIAIS_INVALIDAS` (e-mail inexistente = senha errada), 423 `BLOQUEADO` |
| `totp/iniciar` | 10 / 5 min | `{ otpauth_uri, segredo_base32 }` | 401 `DESAFIO_INVALIDO` |
| `totp/confirmar` | 10 / 5 min | 10 códigos de recuperação (uma vez) + sessão | 401 `CODIGO_INVALIDO`, 409 `TOTP_NAO_INICIADO` |
| `segundo-fator` | 10 / 5 min | sessão | 401 `CODIGO_INVALIDO` / `DESAFIO_INVALIDO`, 423 `BLOQUEADO` |
| `renovar`, `sair` (204), `recuperacao/regerar` | 10 / 5 min | sessão / — / 10 códigos novos | 401 `SESSAO_PLATAFORMA_INVALIDA` |

`renovar`, `sair` e `regerar` leem o `Authorization` de `ctx.cabecalhos` (pedido ao engenheiro-software R-20261106-010602; sem o campo, 401).

## Regras
- Variáveis: `MACUXI_JWT_SEGREDO_PLATAFORMA` (≥ 32), `MACUXI_CHAVE_TOTP` (32 bytes em base64), `MACUXI_SUPERADMIN_CONVITE` (≥ 32). Faltou uma: 503.
- TOTP RFC 6238 (SHA-1, 6 dígitos, 30 s, janela ±1); o passo só avança (`sa_marcar_passo`, atômico): o mesmo código não vale duas vezes.
- Segredo do TOTP: 20 bytes, AES-256-GCM, `v1.<iv>.<tag>.<cifra>`, AAD = id do super-admin. Recuperação: `XXXXX-XXXXX`, só SHA-256, uso único.
- 5 falhas (senha ou código) = 15 min de bloqueio, contadas no banco. A senha certa não zera a contagem; só o 2º fator completo.
- Token: JWT HS256 com segredo próprio, `aud=macuxi-plataforma`, `sub`, `sid`, `amr=["pwd","otp"]`, 15 min; teto da sessão 8 h (do banco).
  `autenticarSuperAdmin` exige assinatura, `aud`, `exp` e sessão viva (`sa_sessao_valida`) com o mesmo `sub`. O `autenticar` de tenant recusa o token de plataforma.
- Auditoria (`sa_auditar`): `sa.primeiro_acesso`, `sa.login.ok`, `sa.login.falha`, `sa.totp.cadastrar`, `sa.recuperacao.usar`,
  `sa.recuperacao.regerar`, `sa.sair`. Só ids, motivo, contagens, `request_id` e prefixo do IP. Nada de e-mail, senha, código ou segredo, nem em log
  (o código TOTP só existe em `corpo`, redigido pelo pino).
- A etapa do desafio (cadastrar TOTP ou 2º fator), os 5 min e o teto de 8 h são decididos pelas funções `sa_*` da 0035; o Core só chama.

## Testes
`domain/super-admin.test.ts` (vetores do RFC 6238, janela, reuso, bloqueio, convite) e `api/super-admin.test.ts` (fluxo completo com repositório em
memória que imita a atomicidade das funções, cifra com AAD trocada, separação dos tokens, varredura de auditoria e log). O SQL real
(`fabricaSuperAdminSql`) é exercitado pelos testes de banco da 0035 e pelo CI do stack isolado.
