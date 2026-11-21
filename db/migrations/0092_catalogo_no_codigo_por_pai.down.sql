-- 0092_catalogo_no_codigo_por_pai (down) — volta ao índice da 0013: código do nó único no tenant inteiro (entre os vivos).
-- FALHA com 23505 (could not create unique index "catalogo_no_codigo_uk") se já houver nós vivos com o mesmo código em ramos
-- diferentes, que a 0092 aceita (RN-CAT-18). Antes do down, liste-os com
--   select tenant_id, codigo, count(*) from catalogo.catalogo_no where deleted_at is null group by 1, 2 having count(*) > 1;
-- e resolva com o dono do catálogo; o Hub (modulo-catalogo/modulo-integracao) precisa voltar à adoção só pelo código.
-- Na falha, a transação da migração desfaz tudo e a 0092 continua aplicada.

drop index catalogo.catalogo_no_pai_codigo_uk;
create unique index catalogo_no_codigo_uk on catalogo.catalogo_no (tenant_id, codigo) where deleted_at is null;
