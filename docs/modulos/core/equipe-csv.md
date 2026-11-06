# Equipe por CSV com convite de 1º acesso (fatia E, T-0087) — desenho curto

> modulo-core · 2026-11-06 · status: proposto (implementação na tarde de 06/11, depois da fatia P) · base: `docs/desenho/T-0087.md` §5.3, RN-CORE-31

## Rotas (Core, `superAdmin: 'aceita'`; o admin do tenant também usa no BKO; perfil `admin` exigido para o usuário do tenant)
| Rota | O que faz |
|---|---|
| `GET /v1/core/equipe/modelo.csv` | modelo com as colunas e 2 linhas de exemplo (`tipoConteudo` CSV, `nomeArquivo`) |
| `POST /v1/core/equipe/importacoes` | corpo `{ csv: string, modo: 'conferir' \| 'gravar' }` (até 5.000 linhas); `conferir` valida e devolve erros por linha **sem gravar** |
| `GET /v1/core/equipe/importacoes/:id/erros.csv` | "Baixar erros (.csv)": linha, coluna, mensagem (sem repetir o dado da célula) |
| `GET /v1/core/equipe/convites` | convites pendentes (usuário, perfil, prazo; **sem** o link) |
| `POST /v1/core/equipe/convites/:usuario_id/renovar` | gera um link novo (o anterior deixa de valer) e o devolve uma vez |

Colunas do CSV: `nome`, `email`, `telefone`, `perfil` (gerente|supervisor|vendedor|promotor|analista|assistente|admin), `email_superior`, `codigo_erp`, `modulos`
(lista separada por `;`, só módulos licenciados ao tenant). Validações no `domain` (função pura, teste antes): e-mail único no arquivo e no tenant,
superior existente no arquivo ou no tenant e de perfil compatível (sem ciclo), `codigo_erp` único, ordem interna gerentes → supervisores → campo,
módulo licenciado. Idempotente pelo e-mail (existente: atualiza nome, telefone, superior, `codigo_erp`; não troca perfil nem senha).

## Convite sem e-mail
- Cada usuário novo recebe um **token** (32 bytes, base64url). O banco guarda só o SHA-256; o link `https://<host-bko>/convite/<token>` aparece **uma vez**
  na resposta do `gravar` (e na renovação) para o portal listar e copiar. Validade 7 dias, uso único.
- Rota pública do Core `POST /v1/auth/convite/aceitar` `{ token, senha }` (limite por IP; senha pela política `validarSenhaInicial`): grava o argon2id,
  marca o convite como usado e já devolve a sessão do tenant. Token inválido, usado ou vencido: mesma resposta 410.
- Auditoria `usuario.convidar` no tenant (`tx.auditar`) e linha da plataforma; sem e-mail, token ou senha em log.

## Pedidos de banco (a enviar ao banco-dados quando a fatia E começar)
`core.usuario_convite` (`id`, `tenant_id`, `usuario_id`, `token_hash`, `expira_em`, `usado_em` + colunas padrão, RLS; índice único em `token_hash`; função
`SECURITY DEFINER` para localizar o convite pelo hash sem tenant, como a do login) e `core.usuario.codigo_erp` (se ainda não existir).
Volume: centenas de linhas por tenant; consulta por `token_hash` e por `usuario_id`.

## Plano B (se não couber)
O `tenant:criar` cria o admin do cliente; ele cadastra a equipe no BKO (`/v1/core/usuarios`).
