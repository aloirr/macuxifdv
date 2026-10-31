# Diário — banco-dados

2026-10-31 — T-0002 — pacote @macuxi/db: db/docker-compose.yml (pgvector:pg16), migrações 0001_plataforma/0002_core com up/down, RLS forçado + macuxi_app sem BYPASSRLS (falha fechada), Drizzle, seed Fase M, fixture dois-tenants, CLI de banco e docs/banco; testes validados em Postgres 16 embutido temporário (71 ok, pgvector pendente); falta Docker e db no workspace (pedido ao engenheiro).
2026-10-31 — T-0002 — Docker: up/down/up, seed+fixture, db/testes 74/0/0 (pgvector e vazamento com macuxi_app), auto-subir do compose e aviso de pulados, lock no papel, EXPLAIN do sync (p95 máx 92 ms) e docs Windows.
