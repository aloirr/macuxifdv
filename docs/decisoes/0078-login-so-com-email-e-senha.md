# ADR 0078 — Login só com e-mail e senha (1 usuário = 1 empresa)

- **Status**: proposta.
- **Data**: 2026-11-28 (Manaus)
- **Versão**: v1.0.44 (tarefa T-0209; a T-0204 vai no mesmo lote da entrada).
- **Autor**: engenheiro-software
- **Origem**: decisões do dono do produto de 28/11, entre ~00h29 e ~00h34: R-20261128-002948 (123 A), R-20261128-003031 (contrato
  do lote do ERP), R-20261128-003116 (textos), R-20261128-003300 (125 B) e R-20261128-003454 ("Solicitar a empresa deve sumir de
  qualquer tela").
- **Relacionadas**: ADR 0006 (tokens), ADR 0031 (portal por e-mail e senha), ADR 0032 (ciclo de senha), ADR 0070 (APK mínimo
  obrigatório), migrações 0002 (`usuario_email_uk`), 0039 (`sa_contas_para_login`), 0052 (`tenant_por_codigo`); RN-CORE-01,
  RN-CORE-32, RN-CORE-33, RN-CORE-34, RN-CORE-58.

## Contexto

Hoje o login do Campo, do Gestão e do BKO pede o **código da empresa**, o e-mail e a senha
(`modules/core/contracts/auth.ts`, `LoginSenhaRequestSchema`). O código resolve o tenant antes do contexto
(`plataforma.tenant_por_codigo`, SECURITY DEFINER, 0052) e só então o usuário é procurado por e-mail, sob RLS. O e-mail é único
**por empresa** (`core.usuario_email_uk (tenant_id, lower(email))`), então o mesmo e-mail pode existir em duas empresas. O portal
`config.` já entra só com e-mail e senha e, com mais de uma empresa, pede a escolha (RN-CORE-32, ADR 0031).

O código aparece também no "Esqueci a senha", no "Crie sua senha", no `localStorage` do BKO (`apps/web/components/login-screen.tsx`),
no estado do app (`fv:codigo_empresa`, `apps/mobile/src/state/plataforma.tsx`) e no e-mail "Seu acesso ao Macuxi"
(`packages/platform-sdk/src/email/modelos.ts`, linha "Código da empresa").

## Decisão

### D1 — Regra: 1 usuário = 1 empresa

- O e-mail do usuário é **único entre todas as empresas**, comparado normalizado (`lower(trim(email))`). A empresa vem do usuário.
- **Fora da unicidade:**
  - o super-admin da Macuxi, que mora em `plataforma.super_admin`, fora de `core.usuario`;
  - o e-mail técnico do usuário provisório do ERP (`@sem-email.invalid`, RN-CORE-58), que não entra e é gerado só do código do ERP
    (o mesmo código em duas empresas daria o mesmo e-mail);
  - o usuário apagado (`deleted_at` preenchido).
- **Nenhuma tela pede a empresa:**
  - entrada do Campo, do Gestão, do BKO e do `config.`;
  - Esqueci a senha;
  - Crie sua senha (primeiro acesso e senha temporária) e troca de senha;
  - seleção de empresa ou de servidor na entrada do app (o servidor vem do build);
  - e-mail "Seu acesso ao Macuxi".
- **Portal `config.`:** com o e-mail único, o admin do cliente tem no máximo uma empresa e entra direto; a escolha de empresa fica só
  para o super-admin, que administra todas. As funções `sa_*` não mudam (nem a lista nem as assinaturas), então não há PR conjunto
  de `sa_*` e kit do Conector.

**Texto novo da RN-CORE-32** (o gerente-projetos leva ao doc 03), no lugar de "Se o e-mail tiver acesso a mais de uma empresa (com a
senha conferida em cada uma), o usuário escolhe a empresa depois do login; com uma só, entra direto.":

> Cada e-mail pertence a uma empresa só, sem diferenciar maiúsculas nem espaços nas pontas. Todas as entradas (Campo, Gestão, BKO e
> portal `config.`) usam só o **e-mail e a senha**, e a empresa vem do usuário; nenhuma tela nem e-mail pede o código da empresa. O
> cadastro e a carga do ERP recusam o e-mail já usado em outra empresa. O super-admin da Macuxi fica fora dessa regra e vê todas as
> empresas. *(Dono do produto, 28/11/2026, R-20261128-002948 a 003454; ADR 0078, T-0209.)*

No doc 03, o item P8 ("o Esqueci a senha pede o código da empresa e o e-mail") passa a "o Esqueci a senha pede só o e-mail".

### D2 — Banco: migração 0111 (a 0110 está reservada às fotos do cliente)

1. **Conferência antes de tudo.** Conta os e-mails vivos repetidos entre empresas:

   ```sql
   select count(*) from (
     select lower(btrim(email)) from core.usuario
      where deleted_at is null and lower(btrim(email)) not like '%@sem-email.invalid'
      group by 1 having count(distinct tenant_id) > 1) r;
   ```

   Maior que zero: `raise exception` com **só o número** ("0111: N e-mails repetidos entre empresas; nada foi alterado."), sem
   e-mail nem empresa. A migração roda numa transação, então nada muda. A decisão volta ao dono do produto.
   Atenção: `core.usuario` tem `force row level security`; a contagem precisa ver todos os tenants (o mesmo caminho das outras
   conferências entre tenants, pela política `manutencao` da 0031). Teste com dois tenants e um e-mail repetido prova o aborto.
2. **Índice único parcial** `core.usuario_email_global_uk on core.usuario (lower(btrim(email))) where deleted_at is null and
   lower(btrim(email)) not like '%@sem-email.invalid'`. O `usuario_email_uk` da 0002 fica (há `ON CONFLICT` e conferências que o
   inferem por `(tenant_id, lower(email))`); o banco-dados só o remove se provar que nada o usa.
3. **Busca sem tenant — decisão: função SECURITY DEFINER mínima, não papel de plataforma.**

   ```sql
   plataforma.tenant_por_email(p_email text) returns table (tenant_id uuid, status text)
   ```

   - `language sql stable security definer`, `search_path = pg_catalog, plataforma, pg_temp`;
   - `revoke all from public`, EXECUTE só ao `macuxi_app`;
   - lê `core.usuario` (pelo índice da 2) junto com `plataforma.tenant`, com `deleted_at is null` nos dois;
   - devolve **0 ou 1 linha**: só o id e o status da empresa, nunca o id, o nome nem o hash do usuário.

   O usuário continua sendo lido **dentro do tenant, sob RLS** (`banco.comTenant` + `usuarioPorEmail`), como hoje. É o mesmo desenho
   da `tenant_por_codigo`, trocando a chave.

   **Alternativa recusada:** um papel de plataforma com BYPASSRLS ou leitura de `core.usuario` de todos os tenants. Ela abriria a
   tabela inteira, com o hash, a uma conexão da API.
4. **Conferência para o cadastro e a carga:**

   ```sql
   plataforma.email_em_outra_empresa(p_email text) returns boolean
   ```

   - SECURITY DEFINER, EXECUTE só ao `macuxi_app`;
   - diz se o e-mail normalizado está vivo em **outro** tenant que não o da sessão (`plataforma.tenant_atual()`);
   - sem contexto de tenant, lança erro;
   - devolve só o booleano.
5. `plataforma.tenant_por_codigo` fica até a remoção do campo legado (D4). A lista de funções SECURITY DEFINER em
   `tests/integracao/banco/conformidade.test.ts` ganha as duas novas (banco-dados com testes).
6. Down: apaga as duas funções e o índice.

### D3 — Ordem de checagem do login (API, `modules/core/api/autenticacao.ts`)

1. Limite por IP + e-mail (429 `MUITAS_TENTATIVAS`). A chave perde a empresa: era IP + empresa + e-mail.
2. `tenant_por_email(lower(trim(email)))`.
   - **Nenhuma linha, ou empresa `encerrado`:** faz as duas conferências argon2id contra o hash nulo, o mesmo custo de hoje
     (`gastarTempoDeSenha`), e responde 401 `CREDENCIAIS_INVALIDAS`. O tempo de resposta é o mesmo do e-mail existente com
     senha errada.
3. Sob o tenant (`comTenant`), sempre as duas conferências de senha. Senha errada: 401 `CREDENCIAIS_INVALIDAS`, com a contagem de
   tentativas de hoje. Isso vale **também para a empresa suspensa**: com a senha errada, ninguém sabe que ela está suspensa.
4. **Senha certa e empresa `suspenso`:** 403 `EMPRESA_SUSPENSA`. Sem sessão e sem `ultimo_login_em`; a auditoria grava o motivo
   `empresa_suspensa`.
5. Daí em diante, a ordem de hoje:
   1. usuário bloqueado ou inativo (423);
   2. aparelho bloqueado (423);
   3. perfil fora do app (403, RN-CORE-33);
   4. senha temporária vencida (410);
   5. senha a trocar (403);
   6. sessão.

A conferência da empresa vem **depois** da senha e **antes** do bloqueio do usuário: a mensagem da empresa suspensa é a que leva à
ação certa, porque o usuário não resolve a suspensão com o administrador da empresa.

O "Crie sua senha" (`/v1/auth/senha/trocar`) usa o mesmo `entrar`, com a mesma ordem.

**Esqueci a senha:** limite por IP e por e-mail. Busca por `tenant_por_email`, com hash da temporária sempre calculado. Sem
empresa, empresa não `ativo`, usuário inexistente, inativo ou bloqueado: nada é enviado. A resposta é sempre 202 `{}`, com a mesma
frase na tela.

### D4 — Contrato HTTP (dono: modulo-core, `modules/core/contracts/auth.ts`)

As rotas não mudam: `POST /v1/auth/login`, `POST /v1/auth/senha/trocar`, `POST /v1/auth/senha/esqueci`, `refresh` e `logout`.
A mudança é **compatível**: o campo sai do obrigatório e passa a ser ignorado. Não há versão nova de rota nem de evento.

```ts
/** Legado (APK até a v1.0.43 e BKO em cache): aceito e IGNORADO. A empresa vem do e-mail (ADR 0078). */
const CodigoEmpresaLegadoSchema = z.string().max(40).optional();

export const LoginSenhaRequestSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  senha: z.string().min(1).max(200),
  dispositivo_id: z.string().uuid().optional(),
  dispositivo_nome: z.string().trim().max(80).optional(),
  app: z.enum(APPS_COM_LOGIN).optional(),
  codigo_empresa: CodigoEmpresaLegadoSchema,
}).strict();

export const TrocarSenhaRequestSchema = z.object({
  email: …, senha_atual: …, senha_nova: …, app: …, dispositivo_id: …, dispositivo_nome: …,
  codigo_empresa: CodigoEmpresaLegadoSchema,
}).strict();

export const EsqueciSenhaRequestSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  codigo_empresa: CodigoEmpresaLegadoSchema,
}).strict();
```

- **Campo legado:** `codigo_empresa` é aceito e ignorado, sem validar o formato. Um código errado vindo do APK antigo não muda o
  resultado. A remoção é uma tarefa própria, **no mínimo na v1.0.46** e só quando o APK mínimo obrigatório (ADR 0070) for ≥ 1.0.44.
  Até lá o `.strict()` segue recusando qualquer outro campo.
- **Respostas:** `SessaoRespostaSchema`, `SessaoWebRespostaSchema` e os `refresh` não mudam. `tenant.codigo` continua na resposta
  para a sessão guardada no aparelho. Ele só pode ser exibido em lugar que não seja de entrada, e nenhuma tela o pede.
- **Sessão aberta continua valendo:** o JWT (`sub`, `tid`, `perfil`) e o refresh `<tenant_id>.<segredo>` não mudam. O app e o BKO
  novos leem a sessão guardada como hoje, apagam a chave `fv:codigo_empresa` (app) e o `localStorage` do código (BKO) e não
  derrubam a sessão por isso.

**Códigos e textos** (no `CODIGOS_AUTH`, em `CODIGOS_USUARIO` e nas `MENSAGEM_*`):

| HTTP | Código | Quando | Texto |
|---|---|---|---|
| 401 | `CREDENCIAIS_INVALIDAS` | e-mail inexistente, senha errada, empresa encerrada | "E-mail ou senha inválidos." |
| 403 | `EMPRESA_SUSPENSA` (novo) | só com a senha certa | "Sua empresa está suspensa. Fale com o administrador da Macuxi." |
| 202 | — | Esqueci a senha, sempre | "Se o e-mail estiver cadastrado, enviamos as instruções." |
| 409 | `USUARIO_EMAIL_EM_OUTRA_EMPRESA` (novo) | cadastro ou edição de usuário no BKO e no portal | "Este e-mail já está em uso em outra empresa. Use outro e-mail." |
| 401 | `SESSAO_INVALIDA` | refresh inválido (sem mudança de código) | "Sua sessão expirou. Entre de novo com o e-mail e a senha." |

O 409 `USUARIO_EMAIL_DUPLICADO` (mesma empresa) continua. Saem do contrato: `MENSAGEM_CODIGO_EMPRESA`,
`CodigoEmpresaFormatoSchema` e o uso de `CodigoEmpresaSchema` no login. O código da licença (`CODIGO_EMPRESA_REGEX`) fica para o
portal criar a empresa.

**Cadastro:**

- ordem: a conferência na mesma empresa (409 de hoje), depois `email_em_outra_empresa` (409 novo);
- corrida entre as duas: o 23505 no `usuario_email_global_uk` vira o 409 novo;
- vale para o BKO (`modules/core/api/usuarios.ts`) e para a criação da empresa no portal (`sa_provisionar_tenant`), onde o 23505 do
  admin inicial vira o mesmo 409.

### D5 — Carga do ERP

- **No Hub** (`modules/integracao`): o item `vendedor` com e-mail (normalizado) vivo em outra empresa é **recusado** pela
  `email_em_outra_empresa`, com o código `VENDEDOR_EMAIL_EM_OUTRA_EMPRESA`.
  - O log da integração (Monitor) grava só o `external_id`, sem o e-mail.
  - O resto do lote segue.
- **No Core** (`consumidores-erp-vendedor.ts`), como defesa: o 23505 no índice global não cria nem altera o e-mail, registra o
  `external_id` no log e não derruba o consumo. Vendedor sem e-mail segue com o e-mail provisório (RN-CORE-58), fora da unicidade.

### D6 — Avisos sem prefixo

O componente de aviso do `packages/ui` (web e mobile) recusa texto que comece por "Erro.", "Aviso.", "Atenção.", "Pronto." ou
"Sucesso.":

- um teste do kit percorre as `MENSAGEM_*` dos contracts;
- em desenvolvimento, o componente acusa o prefixo.

A gravidade já está na cor e no ícone.

## Divisão por dono

| Dono | O quê |
|---|---|
| banco-dados | Migração 0111 (D2): conferência que aborta só com o número, índice global, `tenant_por_email` e `email_em_outra_empresa`, down, dicionário em `docs/banco/`, testes de banco (aborto, unicidade, provisório e apagado fora, EXECUTE só ao `macuxi_app`) |
| modulo-core | `contracts/auth.ts` e `contracts/usuarios.ts` (D4); `domain` e `api` do login, troca, esqueci (D3) e cadastro (409); defesa do consumidor do ERP (D5); remoção do `codigo_empresa` dos dados do e-mail; telas em `modules/core/app` (`tela-login`, `tela-esqueci-senha`, `tela-crie-sua-senha`, `lib/login`, `lib/senha`, `lib/trocar-senha`) |
| modulo-integracao | Recusa do vendedor no lote, com `VENDEDOR_EMAIL_EM_OUTRA_EMPRESA` no log da integração (D5) e o teste |
| engenheiro-apps | `apps/mobile` (`login.tsx`, `etapa-login.ts`, `trocar-senha-shell.ts`, `state/plataforma.tsx`: sem campo nem chave `fv:codigo_empresa`, sem escolha de empresa ou servidor na entrada) e `apps/web` (`login-screen.tsx` sem campo nem `localStorage`, `ciclo-senha.tsx`, `lib/login.ts`, `lib/session.ts`, `menu-usuario.tsx`, `app-shell.tsx`), com a sessão aberta preservada |
| designer-ux | Simulação das entradas (com o rodapé da T-0204) e a regra do aviso sem prefixo no componente do `packages/ui` (D6) |
| engenheiro-software | Modelo do e-mail (`packages/platform-sdk/src/email/modelos.ts`: sem a linha "Código da empresa"; `codigo_empresa` opcional e ignorado por uma versão, para as mensagens já na fila) e `apps/api/src/plataforma.ts` sem mandar o código; revisão final |
| testes, corretor-redundancias, design-de-marca | Critérios da T-0209: tempo igual no 401, suspensa só com a senha certa, sessão antiga, telas sem empresa (1366 e 390) |
| gerente-projetos | RN-CORE-32 e P8 no doc 03 (D1) |

**Ordem de merge:**

1. 0111 com o Core (D3 a D5): o Core novo chama as funções da 0111.
2. Integração.
3. Telas e e-mail.

O `codigo_empresa` opcional deixa as telas antigas funcionando entre os passos.

## Consequências

- O 409 do cadastro diz que o e-mail existe em outra empresa. Isso é uma enumeração limitada, decidida pelo dono do produto: só o
  admin e o super-admin veem, e a auditoria registra a ação.
- O login deixa de revelar se o código existe (ele não é mais pedido). O e-mail continua sem oráculo: mesma resposta e mesmo tempo.
- Um e-mail fica preso à empresa enquanto o usuário não for apagado. Para passar alguém de empresa, o usuário é apagado na de origem.
- Empresa encerrada responde como e-mail inexistente. Só a suspensa tem mensagem própria.
- Se houver e-mails repetidos hoje, a 0111 não sobe e a v1.0.44 espera a decisão do dono do produto.
