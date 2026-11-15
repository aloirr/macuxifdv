-- 0075_catalogo_referencia_marca_opcional (up) — a marca do concorrente na referência cruzada passa a ser opcional; basta o código.
-- Decisão do dono do produto: R-20261115-073000-alexandre, item 3 (RN-CAT-09). Código do Catálogo: branch
-- nuvem/referencia-sem-marca-modulo-catalogo (a API grava marca_id nulo quando não há marca, e marca_nome nulo junto).
-- Dicionário: docs/banco/catalogo.md ("0075"). Teste: db/testes/referencia-marca-opcional.db.test.ts (estático na sessão; banco e
-- up/down no CI).
--
-- 1. catalogo.produto_referencia.marca_id aceita NULL. A FK produto_referencia_marca_fk (0045, MATCH SIMPLE) não muda: com
--    marca_id nulo ela não confere nada; com marca_id preenchido segue exigindo a marca no mesmo tenant. Nenhum CHECK exigia o
--    campo. marca_nome (0034) segue como está (nulo ou 1..120).
-- 2. Unicidade por produto e código: sai produto_referencia_codigo_uk (tenant, produto, marca, compacto) e entra
--    produto_referencia_produto_codigo_uk (tenant_id, produto_id, codigo_compacto) where deleted_at is null — o mesmo código,
--    em qualquer grafia ("CB 3401" x "cb-3401"), uma vez só por produto, com ou sem marca.
--    Antes, as vivas que repetem o compacto no mesmo produto (marcas diferentes): fica a de MENOR ordem; as outras recebem
--    deleted_at = now() desta transação (= public.macuxi_migracao.aplicada_em da 0075; é por esse instante que o down as
--    devolve). O gatilho produto_referencia_updated_at avança o updated_at: o aparelho puxa a exclusão no próximo sync.
-- 3. RLS, grants, demais colunas, CHECKs e índices não mudam.
--
-- Caminho de volta: 0075_catalogo_referencia_marca_opcional.down.sql.

-- 2a. repetidas no mesmo produto: fica a de menor ordem (a ordem é única entre as vivas do produto)
update catalogo.produto_referencia r
   set deleted_at = now()
  from (select id,
               row_number() over (partition by tenant_id, produto_id, codigo_compacto order by ordem, id) as posicao
          from catalogo.produto_referencia
         where deleted_at is null) d
 where d.id = r.id and d.posicao > 1;

-- 2b. troca do único
drop index if exists catalogo.produto_referencia_codigo_uk;
create unique index produto_referencia_produto_codigo_uk on catalogo.produto_referencia (tenant_id, produto_id, codigo_compacto) where deleted_at is null;

-- 1. marca opcional
alter table catalogo.produto_referencia alter column marca_id drop not null;
