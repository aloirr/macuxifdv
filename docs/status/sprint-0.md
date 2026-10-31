# Sprint 0 — Fundação modular · status em 2026-10-31

> Dono: gerente-projetos. Meta do Alexandre: fechar até sexta, 06/11. Relatório de testes: `tests/plano/relatorio-sprint-0.md`.

## Resultado
**Pronta para fechar, faltando só o build dos 2 APKs no EAS (Alexandre).** Nenhum defeito reprova critério.

| Tarefa | Situação |
|---|---|
| T-0001 Monorepo modular + platform-sdk | ✅ 276 testes da Fase M idênticos + 1 substituído (decisão de cancelamento); Fase M intacta; fronteiras |
| T-0002 Banco, RLS e migrações | ✅ Postgres 16 + pgvector no Docker; RLS forçado; vazamento entre tenants verde; migrações 0001–0004 |
| T-0003 Login, perfis e licenças | ✅ login com código da empresa, bloqueio, refresh rotativo; licenças tenant → perfil → usuário; 403 MODULO_INATIVO; promotor sem escrita de pedido |
| T-0004 Shells e API | ⏳ API modular (createApp), 8 módulos nos shells, extensão só com módulo ativo; **falta o build EAS** |
| T-0005 CI e verificação de donos | ✅ CI com Postgres, verificar --base, guardião |
| T-0006 Plano e relatório de testes | ✅ 230 casos em tests/ com banco real |

Adiantadas da Sprint 1 e seguintes: T-0007 (produto no dono definitivo), T-0009 (domínio da integração), T-0010 (domínio do promotor), T-0011 (domínio do treinamento), T-0012 (domínio da pesquisa) — concluídas. T-0008 (SQLite no aparelho) com desenho pronto.

## Pendências
- **Alexandre**: login na Expo e os 2 APKs (roteiro M-02); ícone do app Gestão; MACUXI_JWT_SEGREDO no db/.env.example; decidir se o bloqueio de aparelho vale para o tenant inteiro; roteiros manuais M-01 (demo da Fase M) e M-06; correção do falso positivo do guardião de Bash.
- **Backlog**: D-1, D-2, O-3, O-4 e os itens de `docs/backlog.md`.
