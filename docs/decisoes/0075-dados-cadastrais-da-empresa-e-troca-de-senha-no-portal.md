# ADR 0075 — Dados cadastrais da empresa, nome e troca de senha no portal

- **Status**: proposta em 2026-11-24.
- **Data**: 2026-11-24 (Manaus)
- **Tarefa**: v1.0.34 (sessão S8).
- **Autor**: engenheiro-software
- **Origem**: R-20261124-191902-alexandre (dados cadastrais da empresa no portal; nome de quem entrou e troca de senha).
- **Relacionadas**: ADR 0031 (portal só com e-mail e senha), ADR 0039 (saída do TOTP), ADR 0048 (consulta de CNPJ), T-0182 (logo e nome fantasia).

## Contexto
O portal `config.` mostra a razão social e o CNPJ da empresa, mas não tem onde completar endereço, telefone, e-mail e inscrição estadual. O dono do produto pediu o cadastro completo, editável pelo super-admin e pelo admin da própria empresa.

O cabeçalho do portal também não mostra quem entrou, e não há como trocar a própria senha sem o "Esqueci a senha".

## Decisão
1. **Funções no banco (migração 0102, `macuxi_portal`).** Cada uma confere a sessão e o acesso de novo e audita a escrita:
   - `plataforma.sa_dados_da_empresa(sessao uuid, tenant uuid) jsonb`: lê o cadastro (CNPJ = `documento`, razão social = `nome`, nome fantasia, as 10 colunas novas de `plataforma.tenant` e `atualizado_em`);
   - `plataforma.sa_gravar_dados_da_empresa(sessao uuid, tenant uuid, dados jsonb) jsonb`: grava exatamente 11 chaves (`razao_social`, `logradouro`, `numero`, `complemento`, `bairro`, `municipio`, `uf`, `cep`, `telefone`, `email`, `inscricao_estadual`) e devolve o cadastro. Sem mudança, não grava nem audita; com mudança, audita só os nomes dos campos. Os CHECKs da 0102 repetem os formatos do `GravarDadosCadastraisEmpresaSchema`;
   - `plataforma.sa_quem_sou(sessao uuid) table(nome, perfil, cargo)`: nome de quem entrou e, para o admin do cliente, o perfil e o cargo na empresa escolhida (sem empresa escolhida, nenhuma linha);
   - `plataforma.sa_gravar_senha_super_admin(sessao uuid, hash_atual text, hash_novo text) boolean`: troca a senha do super-admin. A API confere a senha atual com o argon2 e manda só os hashes; `false` = o hash atual mudou no meio. A troca revoga todas as sessões dele, inclusive a atual.

   A 0102 muda a lista de funções `sa_*`: a migração e o teste que confere a lista saem no mesmo PR (lição de 15/11, erro 3).
2. **Rotas do cadastro (API, `apps/api/src/empresa-cadastro.ts`).**
   - `GET` e `PUT /v1/plataforma/empresas/:tenant_id/cadastro` (`ROTA_PORTAL_CADASTRO_EMPRESA`);
   - quem pode: super-admin em qualquer empresa e admin do cliente só na empresa da sessão (403 antes do banco);
   - o `PUT` recebe `GravarDadosCadastraisEmpresaSchema` (as 11 chaves, `.strict()`) e é idempotente, porque regravar o mesmo valor não muda nada;
   - formato inválido devolve 422 `CADASTRO_EMPRESA_INVALIDO` com o caminho e a frase de cada campo, nunca o valor digitado;
   - SQLSTATE: 28000 = 401, 42501 = 403, P0002 = 404, 22023 e 23514 = 422, e 42883 (banco sem a 0102) = 503 `CADASTRO_EMPRESA_INDISPONIVEL`;
   - o log só leva o tenant: endereço, telefone e e-mail não vão a log.
3. **CNPJ imutável.** O CNPJ vem na leitura (`DadosCadastraisEmpresaSchema`, 14 dígitos; `null` só na empresa antiga sem CNPJ) e não entra no `PUT`. Corpo com `cnpj` = 422.
4. **Nome fantasia segue a T-0182.** Ele aparece só para leitura no cadastro e continua gravado pelo `PUT .../marca` (`sa_gravar_nome_fantasia`, `GravarNomeFantasiaSchema`). Corpo do cadastro com `nome_fantasia` = 422.
5. **Receita preenche só os vazios.** A tela usa a consulta existente (`POST /v1/plataforma/cnpj`, ADR 0048) e copia o resultado só para os campos vazios. O que o cliente já digitou não é sobrescrito, e nada grava sem o "Salvar".
6. **Sessão do portal (contrato aditivo).** `SessaoPortalSchema` ganha `usuario: UsuarioDoPortalSchema | null`, opcional (`{ nome, perfil, cargo }`, vindo da `sa_quem_sou`). Ausente = API anterior; o cliente antigo ignora o campo. O `usuario` no login, na escolha de empresa e no renovar é do modulo-core.
7. **Troca da própria senha.** A rota é `POST /v1/plataforma/auth/senha` (`ROTA_PORTAL_TROCAR_SENHA`, `TrocarSenhaPortalSchema` `{ senha_atual, senha_nova }`, `.strict()`), com o token do portal. Ela é pública do Core, como o resto de `/v1/plataforma/auth/*`, e fica com o modulo-core:
   - a senha nova segue a RN-CORE-32, conferida pela regra do Core;
   - o super-admin troca **sem segundo fator**, porque o TOTP saiu na ADR 0039: a senha atual é a prova. A senha atual errada conta como falha de login (`sa_tentativa_*`), e depois da troca ele entra de novo;
   - o admin do cliente troca pelo caminho do Core, que já existe;
   - a senha nunca volta em resposta nem vai a log.

## Alternativas
- **Cadastro só para o super-admin**: recusada. O dono do produto quer que o cliente complete os próprios dados.
- **CNPJ editável com nova consulta à Receita**: recusada. O CNPJ identifica a empresa, as licenças e o Conector, e trocá-lo é outro cadastro.
- **Nome fantasia no cadastro**: recusada pelo gerente nesta versão. Ele já tem dono, regra e auditoria na T-0182 (grava só o super-admin, RN-CORE-33), e duas rotas para o mesmo campo dariam duas regras de acesso.
- **Segundo fator na troca de senha do super-admin**: fora. O TOTP saiu na ADR 0039, e voltar com ele seria outra decisão.

## Consequências
- A tela de cadastro (`apps/web`) usa `DadosCadastraisEmpresaSchema`, `GravarDadosCadastraisEmpresaSchema`, `LIMITES_CADASTRO_EMPRESA` e `rotaCadastroEmpresa`.
- Sem a 0102 no banco, as rotas do cadastro respondem 503, e o resto do portal segue igual.
- O contrato da sessão é aditivo, sem nova versão.
