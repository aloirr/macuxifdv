#!/usr/bin/env bash
# Teste local (Postgres da sessão, sem Docker) da limpeza de cadastros: producao-limpar-cadastros.yml.
# Roda como o admin SEM superusuário e SEM BYPASSRLS (igual ao do DBaaS), no servidor 5433 do pg-local.sh:
#   bash db/scripts/pg-local.sh && eval "$(bash db/scripts/pg-local.sh --env)"
#   MACUXI_PG_PORTA=5433 pnpm --filter @macuxi/db admin-sem-superusuario     (uma vez por servidor)
#   bash scripts/producao/teste/limpar-cadastros.teste.sh
# Os roteiros só chamam as funções da 0099 (plataforma.limpar_cadastros, restaurar_limpeza e descartar_limpeza; ADR 0068).
# Confere antes que um banco sem a 0099 para com mensagem clara. Depois cria o banco macuxi_limpeza_teste, migra (com a 0099),
# carrega a fixture dois-tenants e os dados das duas origens (kit e macuxierp) nos dois tenants, e confere: simular (inteira e
# por entidade) não muda nada; entidade fora da lista para; apagar com lote do Hub em processamento aborta; apagar limpa o alfa e
# mantém empresa, administradores, perfis de acesso, licenças, parâmetros, conectores, credenciais, filiais e o tenant beta;
# os demais usuários saem e o reenvio do vendedor pelo ERP o recria; restaurar
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
montar() { bash "$raiz/scripts/producao/montar-limpeza.sh" "$1"; }

echo '--- 0. banco sem a 0099'
psql -X -q -d postgres -c "drop database if exists ${BANCO}_sem0099" -c "create database ${BANCO}_sem0099" >/dev/null 2>&1
for modo in limpar restaurar descartar arquivo; do
  set +e; montar "$modo" | psql -X -q -d "${BANCO}_sem0099" -v empresa=alfa -v modo=simular -v lote=20261123T185900Z -f - > "$tmp/sem0099.txt" 2>&1; st=$?; set -e
  igual "$modo sem a 0099 para com 'o banco ainda não tem a migração 0099'" \
    "$([ $st -ne 0 ] && grep -q 'o banco ainda não tem a migração 0099' "$tmp/sem0099.txt" && echo sim)" sim
done
psql -X -q -d postgres -c "drop database if exists ${BANCO}_sem0099" >/dev/null

psql -X -q -d postgres -c "drop database if exists $BANCO" -c "create database $BANCO" >/dev/null 2>&1
(cd "$raiz/db" && npx tsx scripts/banco.ts migrar up --banco "$BANCO" >/dev/null && npx tsx scripts/banco.ts fixture dois-tenants --banco "$BANCO" >/dev/null)
for t in "$ALFA" "$BETA"; do psql -X -q -v ON_ERROR_STOP=1 -d "$BANCO" -v tenant="$t" -f "$raiz/scripts/producao/teste/limpar-cadastros-dados.sql"; done

# hash por tabela e tenant (sem updated_at, geracao_base e sessao_versao, que a limpeza e a restauração andam de propósito;
# a sessao_versao do vendedor que sai é conferida à parte; sem a plataforma.limpeza_copia, conferida à parte)
q "create function public.teste_hash(p_tenant uuid) returns table (tabela text, hash text) language plpgsql as \$f\$
declare r record; h text; begin
  for r in select n.nspname || '.' || c.relname as nome, exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as tem_tenant,
                  n.nspname || '.' || c.relname = 'plataforma.tenant' as eh_tenant
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'r' and n.nspname in ('core','catalogo','vendedor','promotor','pesquisa','treinamento','gestor','integracao','plataforma')
              and (n.nspname, c.relname) <> ('plataforma', 'limpeza_copia') loop
    if r.eh_tenant then
      execute format('select md5(coalesce(string_agg((to_jsonb(t) - ''updated_at'' - ''geracao_base'')::text, ''|'' order by t.id), '''')) from %s t where t.id = %L', r.nome, p_tenant) into h;
    elsif r.tem_tenant then
      execute format('select md5(coalesce(string_agg((to_jsonb(t) - ''updated_at'' - ''sessao_versao'')::text, ''|'' order by (to_jsonb(t) - ''updated_at'' - ''sessao_versao'')::text), '''')) from %s t where t.tenant_id = %L', r.nome, p_tenant) into h;
    else continue; end if;
    tabela := r.nome; hash := h; return next;
  end loop; end \$f\$;
create table public.teste_foto (nome text, tenant uuid, tabela text, hash text);" >/dev/null
foto() { q "insert into public.teste_foto select '$1', '$2', tabela, hash from public.teste_hash('$2')" >/dev/null; }
tabelas_diferentes() { q "select coalesce(string_agg(a.tabela, ',' order by a.tabela), '') from public.teste_foto a join public.teste_foto b on b.nome = '$2' and b.tenant = a.tenant and b.tabela = a.tabela
               where a.nome = '$1' and a.tenant = '$3' and a.hash is distinct from b.hash"; }
limpar() { montar limpar | psql -X -q -d "$BANCO" -v empresa="$1" -v modo="$2" -v lote="$3" -v entidades="${4:-}" -f - ; }
restaurar() { montar restaurar | psql -X -q -d "$BANCO" -v empresa="$1" -v lote="$2" -f - ; }
descartar() { montar descartar | psql -X -q -d "$BANCO" -v empresa="$1" -v lote="$2" -f - ; }
tem_backup() { q "select count(*) > 0 from plataforma.limpeza_copia where empresa_id = '$ALFA'"; }
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
limpar alfa simular 20261123T190010Z produto > "$tmp/simular-produto.txt" || nok "simular por entidade saiu com erro"
foto simulado_produto "$ALFA"
igual "simular por entidade não muda o alfa" "$(tabelas_diferentes simulado_produto antes "$ALFA")" ""
# só a seção "o que sai" (a "o que fica" sempre lista core.cliente e core.produto)
sed -n '/^o que sai/,/^o que fica/p' "$tmp/simular-produto.txt" > "$tmp/sai-produto.txt"
igual "simular produto lista core.produto e não core.cliente" \
  "$(grep -q 'core.produto *| soft' "$tmp/sai-produto.txt" && ! grep -q 'core.cliente *|' "$tmp/sai-produto.txt" && echo sim)" sim
set +e; limpar alfa simular 20261123T190020Z nao_existe > "$tmp/entidade.txt" 2>&1; st=$?; set -e
igual "entidade fora da lista para" "$([ $st -ne 0 ] && echo sim)" sim

echo '--- 2. apagar com lote em processamento'
qa "update integracao.lote set status = 'processando' where tenant_id = '$ALFA' and chave_idempotencia = 'chave-erp-produto-0001'" >/dev/null
set +e; limpar alfa apagar 20261123T190100Z > "$tmp/processando.txt" 2>&1; st=$?; set -e
igual "apagar com lote processando sai com erro" "$([ $st -ne 0 ] && grep -q 'em processamento' "$tmp/processando.txt" && echo sim)" sim
qa "update integracao.lote set status = 'concluido_com_erros' where tenant_id = '$ALFA' and chave_idempotencia = 'chave-erp-produto-0001'" >/dev/null
foto abortado "$ALFA"
igual "apagar abortado não muda o alfa" "$(tabelas_diferentes abortado antes "$ALFA")" ""
igual "apagar abortado não deixa cópia" "$(tem_backup)" f

echo '--- 3. apagar'
g0="$(qa "select geracao_base from plataforma.tenant where id = '$ALFA'")"
# administradores: a linha, os perfis, as filiais, as sessões e as linhas deles com AUTORIA de quem sai (notificação,
# tarefa do admin, destinatário em tarefa do supervisor, meta), tudo menos updated_at
admins() { qa "select md5(concat_ws('#',
  (select string_agg((to_jsonb(u) - 'updated_at')::text, '|' order by u.id) from core.usuario u where u.tenant_id = '$ALFA' and u.perfil = 'admin'),
  (select string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id) from plataforma.usuario_perfil x join core.usuario u on u.id = x.usuario_id where u.tenant_id = '$ALFA' and u.perfil = 'admin'),
  (select string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id) from core.usuario_filial x join core.usuario u on u.id = x.usuario_id where u.tenant_id = '$ALFA' and u.perfil = 'admin'),
  (select string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id) from core.sessao x join core.usuario u on u.id = x.usuario_id where u.tenant_id = '$ALFA' and u.perfil = 'admin'),
  (select string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id) from core.notificacao x join core.usuario u on u.id = x.usuario_id where u.tenant_id = '$ALFA' and u.perfil = 'admin'),
  (select string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id) from core.tarefa x join core.usuario u on u.id = x.autor_id where u.tenant_id = '$ALFA' and u.perfil = 'admin'),
  (select string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id) from core.tarefa_destinatario x join core.usuario u on u.id = x.usuario_id where u.tenant_id = '$ALFA' and u.perfil = 'admin'),
  (select string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id) from core.meta_produtividade x join core.usuario u on u.id = x.usuario_id where u.tenant_id = '$ALFA' and u.perfil = 'admin')))"; }
autoria() { qa "select (select count(*) from core.notificacao x join core.usuario a on a.id = x.usuario_id join core.usuario s on s.id = x.autor_id
                         where x.tenant_id = '$ALFA' and a.perfil = 'admin' and s.perfil = 'supervisor' and x.deleted_at is null) || '/' ||
                       (select count(*) from core.tarefa x join core.usuario a on a.id = x.autor_id join core.usuario s on s.id = x.cancelada_por
                         where x.tenant_id = '$ALFA' and a.perfil = 'admin' and s.perfil = 'supervisor' and x.deleted_at is null) || '/' ||
                       (select count(*) from core.tarefa_destinatario d join core.tarefa x on x.id = d.tarefa_id join core.usuario a on a.id = d.usuario_id join core.usuario s on s.id = x.autor_id
                         where d.tenant_id = '$ALFA' and a.perfil = 'admin' and s.perfil = 'supervisor' and d.deleted_at is null and x.deleted_at is null) || '/' ||
                       (select count(*) from core.meta_produtividade x join core.usuario a on a.id = x.usuario_id join core.usuario g on g.id = x.atualizado_por
                         where x.tenant_id = '$ALFA' and a.perfil = 'admin' and g.perfil = 'gerente' and x.deleted_at is null)"; }
igual "dados do admin com autoria de quem vai sair (notificação, tarefa cancelada, destinatário, meta)" "$(autoria)" 1/1/1/1
admin0="$(admins)"
sv0="$(qa "select sessao_versao from core.usuario where tenant_id = '$ALFA' and external_id = 'ERP-VEND-1'")"
limpar alfa apagar 20261123T190200Z > "$tmp/apagar.txt" || nok "apagar saiu com erro"
cat "$tmp/apagar.txt"
foto apagado "$ALFA"; foto apagado "$BETA"
igual "beta intacto" "$(tabelas_diferentes apagado antes "$BETA")" ""
igual "ficam: tenant, perfis de acesso, licenças, parâmetros, conectores, credenciais, equipes (hash igual)" \
  "$(q "select count(*) from public.teste_foto a join public.teste_foto b on b.nome = 'antes' and b.tenant = a.tenant and b.tabela = a.tabela
        where a.nome = 'apagado' and a.tenant = '$ALFA' and a.hash is distinct from b.hash
          and a.tabela in ('plataforma.tenant', 'plataforma.perfil', 'plataforma.perfil_modulo', 'plataforma.perfil_permissao',
                           'plataforma.tenant_modulo', 'plataforma.assinatura', 'plataforma.parametro',
                           'integracao.conector', 'integracao.credencial', 'integracao.mapeamento', 'core.medida', 'core.equipe')")" 0
igual "administradores intactos (linha, perfis, filiais, sessões, notificações, tarefas e metas) e logando (vivos, ativos, com sessão viva)" \
  "$([ "$(admins)" = "$admin0" ] && echo iguais)/$(qa "select count(*) from core.usuario u where u.tenant_id = '$ALFA' and u.perfil = 'admin' and u.deleted_at is null and u.ativo
     and exists (select 1 from core.sessao s where s.usuario_id = u.id and s.deleted_at is null and s.revogado_em is null and s.expira_em > now())")" "iguais/1"
igual "autoria de quem saiu não leva os dados do admin (notificação, tarefa cancelada, destinatário, meta)" "$(autoria)" 1/1/1/1
igual "os outros usuários saem, com perfis, filiais, carteira e sessões; o token do vendedor cai (sessao_versao)" \
  "$(qa "select (select count(*) from core.usuario where tenant_id = '$ALFA' and deleted_at is null and perfil <> 'admin')
             + (select count(*) from plataforma.usuario_perfil x join core.usuario u on u.id = x.usuario_id where u.tenant_id = '$ALFA' and u.perfil <> 'admin' and x.deleted_at is null)
             + (select count(*) from core.usuario_filial x join core.usuario u on u.id = x.usuario_id where u.tenant_id = '$ALFA' and u.perfil <> 'admin' and x.deleted_at is null)
             + (select count(*) from core.carteira x join core.usuario u on u.id = x.usuario_id where u.tenant_id = '$ALFA' and u.perfil <> 'admin' and x.deleted_at is null)
             + (select count(*) from core.sessao x join core.usuario u on u.id = x.usuario_id where u.tenant_id = '$ALFA' and u.perfil <> 'admin' and x.deleted_at is null)") / $(qa "select sessao_versao > $sv0 from core.usuario where tenant_id = '$ALFA' and external_id = 'ERP-VEND-1'")" "0 / t"
grep -q 'usuários por perfil principal' "$tmp/apagar.txt" && ok "a saída mostra os usuários por perfil" || nok "a saída sem os usuários por perfil"
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
igual "outbox: integracao, pedido e usuário que sai saem; publicado e evento de administrador ficam" \
  "$(qa "select (select count(*) from plataforma.evento where tenant_id = '$ALFA' and publicado_em is null and deleted_at is null and (nome like 'integracao.%' or nome like 'vendedor.%')) || '/' ||
               (select count(*) from plataforma.evento where tenant_id = '$ALFA' and publicado_em is not null and deleted_at is null and nome = 'integracao.produto.atualizado@1') || '/' ||
               (select count(*) from plataforma.evento e where e.tenant_id = '$ALFA' and e.publicado_em is null and e.deleted_at is null and e.nome like 'core.usuario.%'
                  and not exists (select 1 from core.usuario u where u.id = e.agregado_id and u.perfil = 'admin')) || '/' ||
               (select count(*) from plataforma.evento e join core.usuario u on u.id = e.agregado_id where e.tenant_id = '$ALFA' and e.publicado_em is null and e.deleted_at is null and u.perfil = 'admin')")" 0/1/0/1
igual "cliente do app vivo; macuxierp ativo" \
  "$(qa "select (select count(*) from core.cliente where tenant_id = '$ALFA' and deleted_at is null and razao_social = 'Cliente do app') || '/' ||
               (select count(*) from integracao.conector where tenant_id = '$ALFA' and identificador = 'macuxierp' and ativo and deleted_at is null)")" 1/1
igual "geracao_base girada" "$([ "$(qa "select geracao_base from plataforma.tenant where id = '$ALFA'")" != "$g0" ] && echo sim)" sim
igual "cópia de segurança com as linhas do lote" "$(q "select count(*) > 0 from plataforma.limpeza_copia where lote = '20261123T190200Z' and empresa_id = '$ALFA'")" t
igual "cópia de segurança sem acesso do macuxi_app/leitura" "$(q "select has_table_privilege('macuxi_app', 'plataforma.limpeza_copia', 'select') or has_table_privilege('macuxi_leitura', 'plataforma.limpeza_copia', 'select')")" f
igual "apagar termina com o commit" "$(tail -n 1 "$tmp/apagar.txt")" "APAGADO: transação confirmada"

echo '--- 4. restaurar'
restaurar alfa 20261123T190200Z || nok "restaurar saiu com erro"
foto restaurado "$ALFA"
# o pacote de sync não volta de propósito (cache: o worker gera outro)
igual "restaurar devolve o alfa (tabelas diferentes)" "$(tabelas_diferentes restaurado antes "$ALFA")" "plataforma.sync_pacote"

echo '--- 5. arquivo do lote, descartar e empresa inexistente'
# o arquivo da VM (montar-limpeza.sh arquivo, como no workflow: as 6 colunas do #675) e a volta (\copy numa temporária + INSERT)
montar arquivo | psql -X -d "$BANCO" -v empresa=alfa -v lote=20261123T190200Z -f - > "$tmp/lote.copy"
linhas="$(q "select count(*) from plataforma.limpeza_copia where lote = '20261123T190200Z'")"
igual "arquivo do lote com só as linhas do lote" "$(wc -l < "$tmp/lote.copy" | tr -d ' ')" "$linhas"
limpar_inexistente() { limpar "$1" simular "$2"; }
for modo in limpar_inexistente restaurar descartar; do
  set +e; "$modo" nao-existe 20261123T190200Z > "$tmp/inexistente.txt" 2>&1; st=$?; set -e
  igual "${modo%_inexistente} com empresa inexistente para com 'empresa não encontrada'" \
    "$([ $st -ne 0 ] && grep -q 'empresa não encontrada' "$tmp/inexistente.txt" && echo sim)" sim
done
descartar alfa 20261123T190200Z > "$tmp/descartar.txt" || nok "descartar saiu com erro"
igual "descartar apaga as linhas do lote" "$(q "select count(*) from plataforma.limpeza_copia where lote = '20261123T190200Z'")" 0
# COPY FROM não entra em tabela com RLS (o admin do DBaaS não tem BYPASSRLS): tabela temporária e INSERT (o mesmo do workflow)
psql -X -q -v ON_ERROR_STOP=1 -d "$BANCO" -c 'create temp table c (lote text, empresa_id uuid, tabela text, modo text, linha jsonb, copiado_em timestamptz)' \
  -c '\copy c from pstdin' -c 'insert into plataforma.limpeza_copia (lote, empresa_id, tabela, modo, linha, copiado_em) select * from c' < "$tmp/lote.copy"
igual "o arquivo do lote volta para a tabela" "$(q "select count(*) from plataforma.limpeza_copia where lote = '20261123T190200Z'")" "$linhas"
descartar alfa 20261123T190200Z > /dev/null

echo '--- 6. apagar de novo e a carga nova do ERP entra'
limpar alfa apagar 20261123T190300Z > /dev/null || nok "2o apagar saiu com erro"
erp="$(qa "select id from integracao.conector where tenant_id = '$ALFA' and identificador = 'macuxierp'")"
padrao="$(qa "select id from core.filial where tenant_id = '$ALFA' and padrao and deleted_at is null")"
vemail="$(qa "select email from core.usuario where tenant_id = '$ALFA' and external_id = 'ERP-VEND-1'")"
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
-- vendedor: o upsert do consumidores-erp-vendedor.ts (mesmo external_id e mesmo e-mail do que saiu)
insert into core.usuario (tenant_id, external_id, nome, email, perfil, ativo, erp_alterado_em) values ('$ALFA', 'ERP-VEND-1', 'Vendedor ERP', '$vemail', 'vendedor', true, now())
  on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null do update set nome = excluded.nome, ativo = (core.usuario.desligado_no_bko_em is null), erp_alterado_em = excluded.erp_alterado_em;
-- filiais: adotadas pelo código (consumidores-erp-filial.ts:33-37: mesmo código e external_id nulo)
update core.filial set external_id = 'ERP-FIL-2' where tenant_id = '$ALFA' and deleted_at is null and codigo = 'ERP-F2' and external_id is null;
update core.filial set external_id = '7adf0a1a-2433-4a09-8edd-4bef759e1e24' where id = '$padrao' and external_id is null;
commit;
SQL
then ok "carga nova do ERP entra depois do apagar"; else nok "carga nova do ERP não entrou"; fi
igual "produto do ERP vivo de novo (linha nova); a antiga segue apagada" \
  "$(qa "select count(*) filter (where deleted_at is null) || '/' || count(*) filter (where deleted_at is not null) from core.produto where tenant_id = '$ALFA' and external_id = 'ERP-PRD-1'")" 1/1
igual "vendedor do ERP recriado (linha nova); o que saiu segue apagado" \
  "$(qa "select count(*) filter (where deleted_at is null) || '/' || count(*) filter (where deleted_at is not null) from core.usuario where tenant_id = '$ALFA' and external_id = 'ERP-VEND-1'")" 1/1
igual "filiais adotadas pelo ERP, sem filial nova" \
  "$(qa "select count(*) || '/' || count(*) filter (where external_id in ('ERP-FIL-2', '7adf0a1a-2433-4a09-8edd-4bef759e1e24')) from core.filial where tenant_id = '$ALFA' and deleted_at is null and codigo in ('ERP-F2', '0001')")" 2/2
igual "usuario_filial e filial_cadastro_id só apontam para filial viva" \
  "$(qa "select (select count(*) from core.usuario_filial uf join core.filial f on f.id = uf.filial_id where uf.tenant_id = '$ALFA' and uf.deleted_at is null and f.deleted_at is not null)
             + (select count(*) from core.usuario u join core.filial f on f.id = u.filial_cadastro_id where u.tenant_id = '$ALFA' and u.deleted_at is null and f.deleted_at is not null)")" 0

psql -X -q -d postgres -c "drop database if exists $BANCO" >/dev/null
if [ "$falhas" -eq 0 ]; then echo "TUDO OK"; else echo "$falhas falha(s)"; exit 1; fi
