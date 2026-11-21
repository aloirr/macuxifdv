-- 0092_catalogo_no_codigo_por_pai (up) — código do nó único entre os irmãos, não no tenant (RN-CAT-18, RF-CAT-04;
-- R-20261120-235317-alexandre). Troca catalogo_no_codigo_uk (0013) por catalogo_no_pai_codigo_uk; o coalesce põe as
-- raízes num "pai" só. Só índice. Volta e riscos: 0092_*.down.sql. Dicionário: docs/banco/catalogo.md ("0092").

drop index catalogo.catalogo_no_codigo_uk;
create unique index catalogo_no_pai_codigo_uk on catalogo.catalogo_no
  (tenant_id, coalesce(pai_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo) where deleted_at is null;
