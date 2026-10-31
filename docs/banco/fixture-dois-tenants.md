# Fixture "dois-tenants" e seed da Fase M

Código: `db/seeds/fixtures/dois-tenants.ts` e `db/seeds/fase-m/fase-m.ts`. Ambos são **idempotentes**
(upsert por id fixo; `senha_hash` existente é preservado) e carregados com a conexão **admin**, numa transação.

## Fixture dois-tenants (testes de RLS, licenças e perfis — pedido R-20261030-235502-testes)
UUID: `<prefixo>-<grupo>-4000-8000-<seq>`; prefixo `aaaaaaaa` (A) / `bbbbbbbb` (B). Grupos:
`0000` tenant · `0001` usuario · `0002` equipe · `0003` produto · `0004` cliente · `0005` carteira ·
`0010` tenant_modulo · `0011` perfil_modulo · `0012` usuario_modulo · `0013` evento · `0014` parametro · `0015` auditoria.
Constantes em `DOIS_TENANTS` (`@macuxi/db/teste`).

| | Tenant A — Distribuidora Alfa | Tenant B — Comercial Beta |
|---|---|---|
| id / código / fuso | `aaaaaaaa-0000-4000-8000-000000000001` / `alfa` / America/Manaus | `bbbbbbbb-0000-4000-8000-000000000001` / `beta` / America/Sao_Paulo |
| tenant_modulo (ativos) | core, vendedor, promotor, teste, teste-dependente | core, vendedor |
| usuários (seq) | 1 admin, 2 analista, 3 assistente, 4 gerente, 5 supervisor, 6 vendedor-1, 7 vendedor-2, 8 promotor | 1 admin-B, 2 vendedor-B |
| equipes | 1 Regional Alfa (resp. gerente) → 2 Equipe 1 (resp. supervisor), 3 Equipe 2 (sem resp.) | 1 Equipe Beta (resp. admin-B) |
| equipe do usuário | gerente→Regional; supervisor, vendedor-1, promotor→Equipe 1; vendedor-2→Equipe 2 | vendedor-B→Equipe Beta |
| perfil_modulo | vendedor: core, vendedor, teste · promotor: core, promotor, teste · supervisor e gerente: core, vendedor, promotor · admin: core · analista: core, vendedor, promotor · assistente: core, vendedor | vendedor: core, vendedor · admin: core, vendedor |
| usuario_modulo | vendedor-2 **remove** `teste` | admin-B remove `vendedor` (só para B ter linha) |
| clientes / carteira | c1 (vendedor-1 + promotor), c2 (vendedor-2), c3 (vendedor-1) | c1 (vendedor-B) |
| produto | ALFA-001, ALFA-002 | BETA-001 |
| evento / parametro / auditoria | 1 / 2 / 1 | 1 / 1 / 1 |

- **Toda tabela com `tenant_id` tem pelo menos 1 linha em cada tenant** (o teste estático e o de vazamento conferem).
- **E-mail repetido de propósito** (S0-072): vendedor-1 (A) e vendedor-B (B) = `vendedor@exemplo.com.br`.
- Senha de todos: `MACUXI_SENHA_TESTE` (padrão `Teste@1234`, só teste), hash argon2id PHC.
- admin/analista/assistente em `perfil_modulo` e a exceção de B são complemento do banco (o plano não fixava).

## Seed Fase M (demonstração)
Tenant `7d0c2f4e-1a2b-4c3d-8e9f-000000000001` "Distribuidora Exemplo", código `exemplo`, America/Manaus
(mesmo id da Fase M). IDs determinísticos (UUID v5 de `fase-m:<tipo>:<chave>`).

| Perfil na Fase M | Perfil na plataforma | Usuários |
|---|---|---|
| seller | vendedor | Bruna T. (Zona Sul), Rafael S. (Zona Norte), Diego M. (Centro), Carla N. (Interior), Marcos P. (Zona Leste), Lívia R. (Zona Oeste), Thiago A. (Interior), Paula V. (Zona Norte) |
| manager | gerente | Fernando Lima (responsável pela "Gerência Comercial", pai das 6 equipes) |
| analyst | analista | Juliana Melo |
| bko_assistant | assistente | Ana Costa |
| admin | admin | Patrícia Gomes |

E-mail = primeiro nome sem acento `@exemplo.com.br`. A Fase M não tinha supervisor nem promotor.
Também carrega: 60 produtos (cadastro base; preço/estoque vão para o Catálogo), 18 clientes nomeados com
carteira do vendedor, módulos `core, catalogo, vendedor, gestor` e os parâmetros padrão do doc 03.
Senha: `MACUXI_SENHA_DEMO` (padrão `demo-macuxi`, só demonstração local).
