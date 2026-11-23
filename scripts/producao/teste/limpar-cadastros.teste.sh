#!/usr/bin/env bash
# Teste local (Postgres da sessão, sem Docker) da limpeza de cadastros: producao-limpar-cadastros.yml.
# Roda como o admin SEM superusuário e SEM BYPASSRLS (igual ao do DBaaS), no servidor 5433 do pg-local.sh:
#   bash db/scripts/pg-local.sh && eval "$(bash db/scripts/pg-local.sh --env)"
#   MACUXI_PG_PORTA=5433 pnpm --filter @macuxi/db admin-sem-superusuario     (uma vez por servidor)
#   bash scripts/producao/teste/limpar-cadastros.teste.sh
# Cria o banco macuxi_limpeza_teste, migra, carrega a fixture dois-tenants e os dados das duas origens (kit e macuxierp) nos
# dois tenants, e confere: simular não muda nada; apagar com lote do Hub em processamento aborta; apagar limpa o alfa e
# mantém empresa, usuários, perfis, licenças, parâmetros, conectores, credenciais, filiais e o tenant beta; restaurar
# devolve o alfa; descartar apaga a cópia; depois de apagar de novo, a carga nova do ERP entra.
set -euo pipefail
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
eval "$(bash "$raiz/db/scripts/pg-local.sh" --env)"
export MACUXI_PG_PORTA="${MACUXI_PG_LIMPEZA_PORTA:-5433}" MACUXI_PG_ADMIN_USUARIO=macuxi_admin_sem_super \
  MACUXI_PG_ADMIN_SENHA=macuxi_admin_sem_super_ci MACUXI_PG_ADMIN_SEM_SUPER=1
export PGHOST="$MACUXI_PG_HOST" PGPORT="$MACUXI_PG_PORTA" PGUSER="$MACUXI_PG_ADMIN_USUARIO" PGPASSWORD="$MACUXI_PG_ADMIN_SENHA"
BANCO=macuxi_limpeza_teste
ALFA=aaaaaaaa-0000-4000-8000-000000000001
BETA=bbbbbbbb-0000-4000-8000-000000000001
falhas=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
ok() { printf 'ok   %s\n' "$*"; }
nok() { printf 'FALHA %s\n' "$*"; falhas=$((falhas + 1)); }
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$BANCO" -c "$1"; }
igual() { if [ "$2" = "$3" ]; then ok "$1"; else nok "$1 (esperado '$3', veio '$2')"; fi; }

[ "$(psql -X -At -d postgres -c "select not rolsuper and not rolbypassrls from pg_roles where rolname = current_user")" = t ] \
  || { echo "o admin do teste precisa ser sem SUPERUSER e sem BYPASSRLS (rode o admin-sem-superusuario na 5433)"; exit 1; }
psql -X -q -d postgres -c "drop database if exists $BANCO" -c "create database $BANCO" >/dev/null 2>&1
(cd "$raiz/db" && npx tsx scripts/banco.ts migrar up --banco "$BANCO" >/dev/null && npx tsx scripts/banco.ts fixture dois-tenants --banco "$BANCO" >/dev/null)
for t in "$ALFA" "$BETA"; do psql -X -q -v ON_ERROR_STOP=1 -d "$BANCO" -v tenant="$t" -f "$raiz/scripts/producao/teste/limpar-cadastros-dados.sql"; done

# hash por tabela e tenant (sem updated_at e geracao_base, que a limpeza e a restauração andam de propósito)
q "create function public.teste_hash(p_tenant uuid) returns table (tabela text, hash text) language plpgsql as \$f\$
declare r record; h text; begin
  for r in select n.nspname || '.' || c.relname as nome, exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as tem_tenant,
                  n.nspname || '.' || c.relname = 'plataforma.tenant' as eh_tenant
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'r' and n.nspname in ('core','catalogo','vendedor','promotor','pesquisa','treinamento','gestor','integracao','plataforma') loop
    if r.eh_tenant then
      execute format('select md5(coalesce(string_agg((to_jsonb(t) - ''updated_at'' - ''geracao_base'')::text, ''|'' order by t.id), '''')) from %s t where t.id = %L', r.nome, p_tenant) into h;
    elsif r.tem_tenant then
      execute format('select md5(coalesce(string_agg((to_jsonb(t) - ''updated_at'')::text, ''|'' order by (to_jsonb(t) - ''updated_at'')::text), '''')) from %s t where t.tenant_id = %L', r.nome, p_tenant) into h;
    else continue; end if;
    tabela := r.nome; hash := h; return next;
  end loop; end \$f\$;
create table public.teste_foto (nome text, tenant uuid, tabela text, hash text);" >/dev/null
foto() { q "insert into public.teste_foto select '$1', '$2', tabela, hash from public.teste_hash('$2')" >/dev/null; }
tabelas_diferentes() { q "select coalesce(string_agg(a.tabela, ',' order by a.tabela), '') from public.teste_foto a join public.teste_foto b on b.nome = '$2' and b.tenant = a.tenant and b.tabela = a.tabela
               where a.nome = '$1' and a.tenant = '$3' and a.hash is distinct from b.hash"; }
montar() { bash "$raiz/scripts/producao/montar-limpeza.sh" "$1"; }
limpar() { montar limpar | psql -X -q -d "$BANCO" -v empresa="$1" -v modo="$2" -v lote="$3" -f - ; }
restaurar() { montar restaurar | psql -X -q -d "$BANCO" -v empresa="$1" -v lote="$2" -f - ; }
descartar() { montar descartar | psql -X -q -d "$BANCO" -v empresa="$1" -v lote="$2" -f - ; }
tem_backup() { q "select to_regclass('public.macuxi_limpeza_backup') is not null"; }
# consulta no contexto do tenant alfa (RLS: o admin sem BYPASSRLS vê pela política manutencao)
qa() { printf "select set_config('app.tenant_id', '%s', false) <> '' as ok \\gset\n%s\n" "$ALFA" "$1" | psql -X -q -At -v ON_ERROR_STOP=1 -d "$BANCO" -f -; }

foto antes "$ALFA"; foto antes "$BETA"
igual "fixture com pedidos, visitas, alertas, projeções e indicadores no alfa" \
  "$(qa "select (select count(*) > 0 from vendedor.pedido where tenant_id = '$ALFA') and (select count(*) > 0 from core.visita where tenant_id = '$ALFA')
             and (select count(*) > 0 from gestor.alerta where tenant_id = '$ALFA') and (select count(*) > 0 from gestor.projecao_fato where tenant_id = '$ALFA')
             and (select count(*) > 0 from core.indicador_diario where tenant_id = '$ALFA')")" t

echo '--- 1. simular'
limpar alfa simular 20261123T190000Z > "$tmp/simular.txt" || nok "simular saiu com erro"
cat "$tmp/simular.txt"
foto simulado "$ALFA"; foto simulado "$BETA"
igual "simular não muda o alfa" "$(tabelas_diferentes simulado antes "$ALFA")" ""
igual "simular não muda o beta" "$(tabelas_diferentes simulado antes "$BETA")" ""
igual "simular não deixa cópia de segurança" "$(tem_backup)" f
igual "simular termina com o ROLLBACK" "$(tail -n 1 "$tmp/simular.txt")" "SIMULADO: ROLLBACK, nada mudou"
grep -q 'vendedor.pedido *| soft' "$tmp/simular.txt" && ok "simular lista os pedidos" || nok "simular sem os pedidos"

echo '--- 2. apagar com lote em processamento'
qa "update integracao.lote set status = 'processando' where tenant_id = '$ALFA' and chave_idempotencia = 'chave-erp-produto-0001'" >/dev/null
set +e; limpar alfa apagar 20261123T190100Z > "$tmp/processando.txt" 2>&1; st=$?; set -e
igual "apagar com lote processando sai com erro" "$([ $st -ne 0 ] && grep -q 'lote do Hub em processamento nesta empresa' "$tmp/processando.txt" && echo sim)" sim
qa "update integracao.lote set status = 'concluido_com_erros' where tenant_id = '$ALFA' and chave_idempotencia = 'chave-erp-produto-0001'" >/dev/null
foto abortado "$ALFA"
igual "apagar abortado não muda o alfa" "$(tabelas_diferentes abortado antes "$ALFA")" ""
igual "apagar abortado não deixa cópia" "$(tem_backup)" f

echo '--- 3. apagar'
g0="$(qa "select geracao_base from plataforma.tenant where id = '$ALFA'")"
limpar alfa apagar 20261123T190200Z > "$tmp/apagar.txt" || nok "apagar saiu com erro"
cat "$tmp/apagar.txt"
foto apagado "$ALFA"; foto apagado "$BETA"
igual "beta intacto" "$(tabelas_diferentes apagado antes "$BETA")" ""
igual "ficam: tenant, usuários, vínculos de filial, perfis, licenças, parâmetros, conectores, credenciais (hash igual)" \
  "$(q "select count(*) from public.teste_foto a join public.teste_foto b on b.nome = 'antes' and b.tenant = a.tenant and b.tabela = a.tabela
        where a.nome = 'apagado' and a.tenant = '$ALFA' and a.hash is distinct from b.hash
          and a.tabela in ('plataforma.tenant', 'core.usuario', 'core.usuario_filial', 'plataforma.usuario_perfil', 'plataforma.perfil',
                           'plataforma.tenant_modulo', 'plataforma.usuario_modulo', 'plataforma.assinatura', 'plataforma.parametro',
                           'integracao.conector', 'integracao.credencial', 'integracao.mapeamento', 'core.medida', 'core.equipe')")" 0
igual "filiais: todas vivas e sem external_id" \
  "$(qa "select count(*) filter (where deleted_at is not null) || '/' || count(*) filter (where external_id is not null) from core.filial where tenant_id = '$ALFA'")" 0/0
igual "cadastros do ERP vivos (cliente, produto, preço, saldo, nó, forma, prazo, título) e filhos de apagados" \
  "$(qa "select (select count(*) from core.cliente where tenant_id = '$ALFA' and deleted_at is null and external_id is not null)
             + (select count(*) from core.produto where tenant_id = '$ALFA' and deleted_at is null and external_id is not null)
             + (select count(*) from catalogo.tabela_preco_item i where i.tenant_id = '$ALFA' and i.deleted_at is null
                  and (i.external_id is not null or exists (select 1 from core.produto p where p.id = i.produto_id and p.deleted_at is not null)))
             + (select count(*) from catalogo.estoque_saldo where tenant_id = '$ALFA' and deleted_at is null)
             + (select count(*) from catalogo.catalogo_no where tenant_id = '$ALFA' and deleted_at is null and external_id is not null)
             + (select count(*) from vendedor.forma_pagamento where tenant_id = '$ALFA' and deleted_at is null and external_id is not null)
             + (select count(*) from vendedor.prazo_pagamento where tenant_id = '$ALFA' and deleted_at is null and external_id is not null)
             + (select count(*) from core.titulo t where t.tenant_id = '$ALFA' and t.deleted_at is null
                  and (t.external_id is not null or exists (select 1 from core.cliente c where c.id = t.cliente_id and c.deleted_at is not null)))")" 0
igual "pedidos, itens, visitas de cliente apagado e fotos de pedido vivos" \
  "$(qa "select (select count(*) from vendedor.pedido where tenant_id = '$ALFA' and deleted_at is null)
             + (select count(*) from vendedor.pedido_item where tenant_id = '$ALFA' and deleted_at is null)
             + (select count(*) from core.visita v where v.tenant_id = '$ALFA' and v.deleted_at is null
                  and exists (select 1 from core.cliente c where c.id = v.cliente_id and c.deleted_at is not null))
             + (select count(*) from plataforma.arquivo a where a.tenant_id = '$ALFA' and a.deleted_at is null and a.entidade = 'pedido')")" 0
igual "números do gestor vivos (alerta, projeção, indicador)" \
  "$(qa "select (select count(*) from gestor.alerta where tenant_id = '$ALFA' and deleted_at is null)
             + (select count(*) from gestor.projecao_fato where tenant_id = '$ALFA')
             + (select count(*) from core.indicador_diario where tenant_id = '$ALFA' and deleted_at is null)")" 0
igual "Hub do alfa vazio (lote, erro, registro_atual, cursor, sessão, fila de cliente)" \
  "$(qa "select (select count(*) from integracao.lote where tenant_id = '$ALFA') + (select count(*) from integracao.lote_linha_erro where tenant_id = '$ALFA')
             + (select count(*) from integracao.registro_atual where tenant_id = '$ALFA') + (select count(*) from integracao.cursor_entidade where tenant_id = '$ALFA')
             + (select count(*) from integracao.sessao_carga where tenant_id = '$ALFA')
             + (select count(*) from integracao.cliente_fila_erp f join core.cliente c on c.id = f.cliente_uuid where f.tenant_id = '$ALFA' and c.deleted_at is not null)")" 0
igual "outbox: integracao e pedido saem; publicado e evento de usuário ficam" \
  "$(qa "select (select count(*) from plataforma.evento where tenant_id = '$ALFA' and publicado_em is null and deleted_at is null and (nome like 'integracao.%' or nome like 'vendedor.%')) || '/' ||
               (select count(*) from plataforma.evento where tenant_id = '$ALFA' and publicado_em is not null and deleted_at is null and nome = 'integracao.produto.atualizado@1') || '/' ||
               (select count(*) from plataforma.evento where tenant_id = '$ALFA' and publicado_em is null and deleted_at is null and nome = 'core.usuario.modulos_alterados@1')")" 0/1/1
igual "cliente do app vivo; macuxierp ativo" \
  "$(qa "select (select count(*) from core.cliente where tenant_id = '$ALFA' and deleted_at is null and razao_social = 'Cliente do app') || '/' ||
               (select count(*) from integracao.conector where tenant_id = '$ALFA' and identificador = 'macuxierp' and ativo and deleted_at is null)")" 1/1
igual "geracao_base girada" "$([ "$(qa "select geracao_base from plataforma.tenant where id = '$ALFA'")" != "$g0" ] && echo sim)" sim
igual "cópia de segurança com as linhas do lote" "$(q "select count(*) > 0 from public.macuxi_limpeza_backup where lote = '20261123T190200Z' and tenant_id = '$ALFA'")" t
igual "cópia de segurança sem acesso do macuxi_app/leitura" "$(q "select has_table_privilege('macuxi_app', 'public.macuxi_limpeza_backup', 'select') or has_table_privilege('macuxi_leitura', 'public.macuxi_limpeza_backup', 'select')")" f
igual "apagar termina com o commit" "$(tail -n 1 "$tmp/apagar.txt")" "APAGADO: transação confirmada"

echo '--- 4. restaurar'
restaurar alfa 20261123T190200Z || nok "restaurar saiu com erro"
foto restaurado "$ALFA"
# o pacote de sync não volta de propósito (cache: o worker gera outro)
igual "restaurar devolve o alfa (tabelas diferentes)" "$(tabelas_diferentes restaurado antes "$ALFA")" "plataforma.sync_pacote"

echo '--- 5. descartar a cópia'
descartar alfa 20261123T190200Z > "$tmp/descartar.txt" || nok "descartar saiu com erro"
igual "descartar apaga as linhas do lote" "$(q "select count(*) from public.macuxi_limpeza_backup where lote = '20261123T190200Z'")" 0

echo '--- 6. apagar de novo e a carga nova do ERP entra'
limpar alfa apagar 20261123T190300Z > /dev/null || nok "2o apagar saiu com erro"
erp="$(qa "select id from integracao.conector where tenant_id = '$ALFA' and identificador = 'macuxierp'")"
padrao="$(qa "select id from core.filial where tenant_id = '$ALFA' and padrao and deleted_at is null")"
if psql -X -q -v ON_ERROR_STOP=1 -d "$BANCO" >/dev/null <<SQL
begin;
select set_config('app.tenant_id', '$ALFA', true);
-- Hub: mesma chave de idempotência, mesmo registro_atual, mesmo cursor (índices sem deleted_at)
insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, chave_idempotencia, hash_conteudo, recebidas, status)
values ('$ALFA', '$erp', 'produto', 'delta', '1', 'chave-erp-produto-0001', repeat('a', 64), 3, 'recebido');
insert into integracao.registro_atual (tenant_id, entidade, conector_id, external_id, hash, alterado_em) values ('$ALFA', 'produto', '$erp', 'ERP-PRD-1', repeat('b', 64), now());
insert into integracao.cursor_entidade (tenant_id, conector_id, entidade) values ('$ALFA', '$erp', 'produto');
-- destino: os upserts dos consumidores (on conflict no índice parcial)
insert into core.produto (tenant_id, sku, nome, external_id) values ('$ALFA', 'ERP-SKU-1', 'Produto 1', 'ERP-PRD-1')
  on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null do update set nome = excluded.nome;
insert into core.cliente (tenant_id, filial_id, razao_social, external_id) values ('$ALFA', '$padrao', 'Cliente ERP 1', 'ERP-CLI-1')
  on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null do update set razao_social = excluded.razao_social;
insert into catalogo.tabela_preco (tenant_id, codigo, nome, external_id) values ('$ALFA', 'ERP-T1', 'Tabela ERP', 'ERP-T1');
insert into catalogo.deposito (tenant_id, codigo, nome, external_id, filial_id) values ('$ALFA', 'ERP-D1', 'Depósito ERP', 'ERP-D1', '$padrao')
  on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null do update set nome = excluded.nome;
insert into vendedor.forma_pagamento (tenant_id, codigo, nome, external_id) values ('$ALFA', 'ERPF', 'Forma ERP', 'ERP-FP');
insert into catalogo.catalogo_no (tenant_id, nivel, nome, codigo, external_id) values ('$ALFA', 1, 'Grupo ERP', 'ERP-G1', 'ERP-NO-1');
-- filiais: adotadas pelo código (consumidores-erp-filial.ts:33-37: mesmo código e external_id nulo)
update core.filial set external_id = 'ERP-FIL-2' where tenant_id = '$ALFA' and deleted_at is null and codigo = 'ERP-F2' and external_id is null;
update core.filial set external_id = '7adf0a1a-2433-4a09-8edd-4bef759e1e24' where id = '$padrao' and external_id is null;
commit;
SQL
then ok "carga nova do ERP entra depois do apagar"; else nok "carga nova do ERP não entrou"; fi
igual "produto do ERP vivo de novo (linha nova); a antiga segue apagada" \
  "$(qa "select count(*) filter (where deleted_at is null) || '/' || count(*) filter (where deleted_at is not null) from core.produto where tenant_id = '$ALFA' and external_id = 'ERP-PRD-1'")" 1/1
igual "filiais adotadas pelo ERP, sem filial nova" \
  "$(qa "select count(*) || '/' || count(*) filter (where external_id in ('ERP-FIL-2', '7adf0a1a-2433-4a09-8edd-4bef759e1e24')) from core.filial where tenant_id = '$ALFA' and deleted_at is null and codigo in ('ERP-F2', '0001')")" 2/2
igual "usuario_filial e filial_cadastro_id só apontam para filial viva" \
  "$(qa "select (select count(*) from core.usuario_filial uf join core.filial f on f.id = uf.filial_id where uf.tenant_id = '$ALFA' and uf.deleted_at is null and f.deleted_at is not null)
             + (select count(*) from core.usuario u join core.filial f on f.id = u.filial_cadastro_id where u.tenant_id = '$ALFA' and u.deleted_at is null and f.deleted_at is not null)")" 0

psql -X -q -d postgres -c "drop database if exists $BANCO" >/dev/null
if [ "$falhas" -eq 0 ]; then echo "TUDO OK"; else echo "$falhas falha(s)"; exit 1; fi
