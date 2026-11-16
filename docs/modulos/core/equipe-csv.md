# Equipe por CSV (fatia E, T-0087; sem convite desde a T-0094) — desenho curto

> modulo-core · atualizado em 07/11 (T-0094, RN-CORE-34) · base: `docs/desenho/T-0087.md` §5.3, `docs/desenho/T-0094.md` §9 · telas no BKO/portal pelo engenheiro-apps

## Rotas (Core, `superAdmin: 'aceita'`; `superficie: 'bko'` — vendedor, promotor e supervisor recebem 403 `PERFIL_SEM_BKO`, RN-CORE-33)
| Rota | O que faz |
|---|---|
| `GET /v1/core/equipe/modelo.csv` | modelo com as colunas e 2 linhas de exemplo (`tipoConteudo` CSV, `nomeArquivo`) |
| `POST /v1/core/equipe/importacoes` | corpo `{ csv: string, modo: 'conferir' \| 'gravar' }` (até 5.000 linhas); `conferir` valida e devolve erros por linha **sem gravar** |

Saíram em 07/11 (T-0094): `GET equipe/convites`, `POST equipe/convites/:usuario_id/renovar`, `POST /v1/auth/convite/aceitar`, os contratos de convite
e o CSV de convites. A tabela `core.usuario_convite` fica (histórico); a migração 0040 revoga os pendentes. Quem tinha convite pendente aparece em
Usuários como **"Sem senha"** e recebe o acesso por **"Enviar acesso"** (ou usa "Esqueci a senha").

Colunas do CSV: `nome`, `email`, `telefone`, `perfil` (gerente|supervisor|vendedor|promotor|analista|assistente|admin), `email_superior`, `codigo_erp`, `modulos`, `filial`
(lista separada por `;`, só módulos licenciados ao tenant). Validações no `domain` (função pura, teste antes): e-mail único no arquivo e no tenant,
superior existente no arquivo ou no tenant e de perfil compatível (sem ciclo), `codigo_erp` único, ordem interna gerentes → supervisores → campo,
módulo licenciado. Idempotente pelo e-mail (existente: atualiza nome, telefone, superior, `codigo_erp`; não troca perfil nem senha). O CSV nunca traz senha
(coluna `senha` recusa o arquivo).

## Senha inicial por e-mail (RN-CORE-34)
- `gravar`: cada pessoa **nova** nasce com `gerarSenhaTemporaria` (12 caracteres), `trocar_senha = true`, `senha_expira_em = agora + 72 h`; o hash vai ao banco e a
  senha em claro só à mensagem `acesso_inicial` do e-mail (`ctx.email`, outbox na MESMA transação do lote: se o lote desfaz, nenhum e-mail sai). Pessoa já existente
  não recebe nada. Os hashes saem em lotes de 8 em paralelo (argon2 no pool de threads).
- Sem e-mail configurado (`disponivel() = false` ou sem `ctx.email`) e com pessoa nova: `gravar` responde **503 `EMAIL_INDISPONIVEL`** ANTES de gravar qualquer coisa
  ("O envio de e-mail não está configurado. Fale com o suporte da Macuxi."); `conferir` funciona sempre; arquivo sem pessoa nova grava normalmente.
- Resposta do `gravar`: `acessos_enviados` (número) e `email_acesso` (`'enfileirado'` ou `null`); saem `convites` e `convites_csv`. O campo `origem` do corpo é aceito e ignorado
  (compatibilidade com o BKO antigo).
- Auditoria `usuario.criar { perfil, equipe_id, origem: 'csv', trocar_senha: true, email: 'enfileirado' }` (sem nome, e-mail, telefone ou senha); log só com contagens.

## Como ficou (implementação) — o que continua valendo da T-0087
- **Erros**: não há `GET importacoes/:id/erros.csv` (o CSV não é guardado e não há tabela de importação). A resposta de `importacoes` traz `erros` (linha, coluna, mensagem) e `erros_csv` pronto para o botão "Baixar erros (.csv)" (`text/csv`, sem o dado da célula). `gravar` com qualquer erro não grava nada.
- **Árvore**: cada superior ganha a equipe que ele responde ("Equipe de <nome>", filha da equipe dele) e o subordinado entra nela; o superior vem do arquivo ou do tenant; perfis compatíveis: supervisor→gerente; vendedor/promotor→supervisor ou gerente; os demais sem superior.
- **Módulos**: coluna `modulos` lista os que a pessoa MANTÉM (só entre os do perfil e do tenant); o que o perfil libera e não foi listado vira exceção "remover" (`plataforma.usuario_modulo`) com `core.usuario.modulos_alterados@1`.
- **Filial (RN-CORE-39, T-0176)**: quem é criado precisa de filial de cadastro. A coluna `filial` traz o `external_id` ou o código da filial; sem a coluna e com uma filial só na empresa, vale essa; senão é erro da linha. A de cadastro entra na de venda. Quem já existe não troca de filial pelo arquivo.
- **Existente**: atualiza nome, telefone, `codigo_erp` (`external_id`), superior e módulos; perfil diferente vira aviso (não troca); não reativa nem mexe na senha.
- **Quem chama**: `usuario.criar` (e `usuario.editar` para atualizar quem já existe; chaves do motor de permissões, ADR 0033; fábrica = admin) ou super-admin com `x-macuxi-tenant`.
- **Troca de superior (RN-CORE-04)**: quem responde por equipe leva a equipe junto (`equipe_pai_id` passa a ser a equipe do novo superior), com auditoria `equipe.mover`.
- **Telefone**: mudança só de telefone vira `atualizar`; célula vazia não apaga.

## Testes
`domain/equipe-importacao.test.ts`, `api/equipe-csv.test.ts` (banco falso: 503 sem e-mail antes de gravar, senha só no e-mail, auditoria sem senha) e `api/equipe-csv.db.test.ts` (Postgres real, CI).
