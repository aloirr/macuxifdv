-- 0085_core_usuario_filial_matriz (up) — v1.0.14, RN-CORE-39. Decisão do dono do produto R-20261116-093600-alexandre (16/11/2026,
-- 9h36 Manaus): "Bote a filial da matriz que é Manaus para todos". Desde a v1.0.13 o usuário sem filial de cadastro recebe 403
-- USUARIO_SEM_FILIAL; aqui todo usuário vivo SEM filial de cadastro recebe a filial MATRIZ do tenant. Número 0085 pela ordem de
-- merge (R-20261115-140000). Correção só de DADOS: nenhuma tabela, coluna, índice, RLS, grant ou função muda. Dicionário:
-- docs/banco/core.md ("0085"). Teste:
-- db/testes/usuario-filial-matriz.db.test.ts.
--
-- MATRIZ do tenant (por tenant, entre as filiais VIVAS e ATIVAS: core.filial.deleted_at nulo e ativo), nesta ordem:
--   1. a de CNPJ com sufixo de estabelecimento 0001: CNPJ só dígitos (qualquer máscara é tirada antes; o CHECK
--      filial_cnpj_formato da 0059 já guarda só dígitos) com 14 dígitos e posições 9 a 12 = '0001';
--   2. empate (mais de uma /0001, raízes diferentes) e tenant SEM nenhuma /0001: a de MENOR CÓDIGO. core.filial não tem coluna
--      de ordem; o código é texto: códigos só de dígitos vêm antes e em ordem numérica ('9' antes de '10'), depois os demais em
--      ordem de texto; desempate final pelo id;
--   3. tenant sem filial viva e ativa: nada muda (os usuários dele seguem sem filial, bloqueados até o BKO ou a carga).
-- QUEM RECEBE: usuário vivo (core.usuario.deleted_at nulo; ativo ou inativo, como o backfill da 0077) com filial_cadastro_id
--   NULO. Quem já tem filial de cadastro fica com a dela (nunca é trocada). Usuário apagado não muda.
-- O QUE GRAVA, na mesma transação:
--   a. core.usuario_filial (filial de VENDA) = a matriz, se o usuário ainda não a tem viva — a invariante da 0077
--      (usuario_filial_inclui_cadastro, adiada para o COMMIT) exige a filial de cadastro entre as de venda. Filiais de venda
--      que o usuário já tinha ficam;
--   b. core.usuario.filial_cadastro_id = a matriz e updated_at = now() (o gatilho usuario_updated_at também anda): o sync puxa
--      o usuário de novo e o app sai do bloqueio.
-- IDEMPOTENTE: rodar de novo não acha usuário vivo sem cadastro no tenant que tem matriz; nada muda.
-- RLS: roda como o migrador, que herda macuxi_manutencao (0031) e passa pelas políticas "manutencao" de core.filial,
--   core.usuario e core.usuario_filial (FORCE RLS ligado em todas); não usa app.tenant_id nem desliga RLS. As FKs compostas
--   (tenant_id, filial_id) garantem filial do mesmo tenant.
-- AUDITORIA: não grava em plataforma.auditoria — nenhuma correção de dados em migração tem esse padrão (o backfill da 0077 e o
--   da 0080 também não gravam); o rastro é este arquivo e public.macuxi_migracao.
-- Volume: dezenas a centenas de usuários por tenant; um update e um insert por usuário sem filial.
-- Caminho de volta: 0085_core_usuario_filial_matriz.down.sql é no-op documentado (não desfaz dados: não se distingue a filial
--   gravada aqui da gravada depois pelo BKO; tirar a filial bloquearia o usuário de novo).

with filial_viva as (
  select f.tenant_id, f.id, f.codigo, regexp_replace(coalesce(f.cnpj, ''), '[^0-9]', '', 'g') as cnpj_digitos
    from core.filial f
   where f.deleted_at is null and f.ativo
),
matriz as (
  select distinct on (fv.tenant_id) fv.tenant_id, fv.id as filial_id
    from filial_viva fv
   order by fv.tenant_id,
            (char_length(fv.cnpj_digitos) = 14 and substr(fv.cnpj_digitos, 9, 4) = '0001') desc,
            (fv.codigo ~ '^[0-9]+$') desc,
            case when fv.codigo ~ '^[0-9]+$' then fv.codigo::numeric end,
            fv.codigo,
            fv.id
),
alvo as (
  select u.tenant_id, u.id as usuario_id, m.filial_id
    from core.usuario u
    join matriz m on m.tenant_id = u.tenant_id
   where u.deleted_at is null and u.filial_cadastro_id is null
),
venda as (
  insert into core.usuario_filial (tenant_id, usuario_id, filial_id)
  select a.tenant_id, a.usuario_id, a.filial_id
    from alvo a
   where not exists (select 1 from core.usuario_filial uf
                      where uf.tenant_id = a.tenant_id and uf.usuario_id = a.usuario_id and uf.filial_id = a.filial_id
                        and uf.deleted_at is null)
  returning 1
)
update core.usuario u
   set filial_cadastro_id = a.filial_id, updated_at = now()
  from alvo a
 where u.tenant_id = a.tenant_id and u.id = a.usuario_id and u.filial_cadastro_id is null;
