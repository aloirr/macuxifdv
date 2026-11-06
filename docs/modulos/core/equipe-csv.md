# Equipe por CSV com convite de 1º acesso (fatia E, T-0087) — desenho curto

> modulo-core · 2026-11-06 · status: implementado em 06/11 (API, domain e contratos; telas no BKO/portal pelo engenheiro-apps) · base: `docs/desenho/T-0087.md` §5.3, RN-CORE-31

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
- Cada usuário novo recebe um **token** (32 bytes, base64url). O banco guarda só o SHA-256; o link `https://<host-bko>/convite#<token>` (token no fragmento: não chega ao servidor nem aos logs do túnel; a página aceita também o formato antigo `/convite/<token>`) aparece **uma vez**
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

## Como ficou (implementação, 06/11) — diferenças do desenho acima
- **Erros**: não há `GET importacoes/:id/erros.csv` (o CSV não é guardado e não há tabela de importação). A resposta de `importacoes` traz `erros` (linha, coluna, mensagem) e `erros_csv` pronto para o botão "Baixar erros (.csv)" (`text/csv`, sem o dado da célula). `gravar` com qualquer erro não grava nada (`gravado: false`).
- **Convite**: token `<tenant_id>.<segredo>` (como o refresh); localizado sob RLS dentro do tenant, sem função SECURITY DEFINER (0036: só tabela `core.usuario_convite` e `core.usuario.telefone`). Link: `origem` opcional no corpo (`https://<host-bko>`) → `link`; sem ela vem só `caminho` (`/convite#<token>`). `convites_csv` na resposta do `gravar` (nome, e-mail, perfil, link, expira_em).
- **Aceite**: `POST /v1/auth/convite/aceitar` `{ token, senha }` define a senha (argon2id) e devolve `{ codigo_empresa, email, nome }`; a pessoa entra pelo **login normal**. Token inválido, usado, revogado, vencido ou usuário inativo: 410 `CONVITE_INVALIDO`; senha fraca: 422 sem consumir; limite 10/5 min por IP.
- **Árvore**: cada superior ganha a equipe que ele responde ("Equipe de <nome>", filha da equipe dele) e o subordinado entra nela; o superior vem do arquivo ou do tenant; perfis compatíveis: supervisor→gerente; vendedor/promotor→supervisor ou gerente; os demais sem superior. Coluna vazia não remove o superior atual.
- **Módulos**: coluna `modulos` lista os que a pessoa MANTÉM (só entre os do perfil e do tenant); o que o perfil libera e não foi listado vira exceção "remover" (`plataforma.usuario_modulo`) com `core.usuario.modulos_alterados@1`. Vazia = perfil inteiro (novo) ou o que já tem (existente). Quantidade licenciada: `tenant_modulo.licencas` contra os usuários ativos com o módulo; passou, a linha é recusada na ordem do arquivo. Promotor com o módulo `vendedor`: recusado (regra 7).
- **Existente**: atualiza nome, telefone, `codigo_erp` (`external_id`), superior e módulos; perfil diferente vira aviso (não troca); não reativa nem mexe na senha.
- **Quem chama**: `usuario.gerir` (admin) ou super-admin com `x-macuxi-tenant`. `criado_por_tipo` do convite = `usuario` ou `super_admin`.

## Revisão da fatia E (T-0087): senha já definida, troca de superior, telefone
- **Aceite só para quem nunca definiu senha** (`senha_hash is null`), usuário ativo e convite vigente; qualquer outro caso é o mesmo 410 `CONVITE_INVALIDO`.
- **Revogação**: "Redefinir senha" (`PUT usuarios/:id/senha`), desativar o usuário e o próprio aceite revogam os convites pendentes do usuário na mesma transação. Link antigo depois da redefinição = 410.
- **Renovar** convite de usuário inativo é recusado (422) com a orientação de ativar antes.
- **Troca de superior (RN-CORE-04)**: quem responde por equipe leva a equipe junto (`equipe_pai_id` passa a ser a equipe do novo superior), com auditoria `equipe.mover`; assim o escopo por árvore acompanha a pessoa.
- **Telefone**: mudança só de telefone vira `atualizar`; célula vazia não apaga.
