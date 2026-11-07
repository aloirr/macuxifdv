-- 0038_plataforma_papel_portal (down) — T-0091 (ADR 0029)
-- Desfaz a 0038: as 20 funções plataforma.sa_* voltam ao estado da 0035 (EXECUTE só ao macuxi_app, nunca a PUBLIC nem ao
-- macuxi_worker) e o macuxi_portal perde o EXECUTE e o USAGE no schema plataforma. A API com o pool do portal passa a
-- receber 42501 nas rotas do super-admin (falha fechada): desfaça junto a versão da API que usa o macuxi_portal.
-- O papel macuxi_portal FICA (objeto do cluster, como o macuxi_manutencao na 0031): outro banco do mesmo servidor pode ter
-- grants para ele. Para remover de vez, num servidor sem nenhum banco que o use: drop role macuxi_portal;
-- Idempotente. Pré-condição: 0039+ desfeitas.

do $$
declare
  v_f text;
begin
  foreach v_f in array array[
    'plataforma.sa_existe()',
    'plataforma.sa_criar_primeiro(text, text, text)',
    'plataforma.sa_para_login(text)',
    'plataforma.sa_por_id(uuid)',
    'plataforma.sa_registrar_falha(uuid)',
    'plataforma.sa_registrar_sucesso(uuid)',
    'plataforma.sa_gravar_totp_pendente(uuid, text)',
    'plataforma.sa_confirmar_totp(uuid, bigint, text[])',
    'plataforma.sa_marcar_passo(uuid, bigint)',
    'plataforma.sa_usar_recuperacao(uuid, text)',
    'plataforma.sa_regerar_recuperacao(uuid, text[])',
    'plataforma.sa_abrir_desafio(uuid, text)',
    'plataforma.sa_ver_desafio(text)',
    'plataforma.sa_abrir_sessao(text)',
    'plataforma.sa_sessao_valida(uuid)',
    'plataforma.sa_revogar(uuid)',
    'plataforma.sa_auditar(jsonb)',
    'plataforma.sa_listar_tenants(uuid)',
    'plataforma.sa_tenant_ativo(uuid, uuid)',
    'plataforma.sa_provisionar_tenant(uuid, jsonb)'
  ] loop
    if exists (select 1 from pg_roles where rolname = 'macuxi_portal') then
      execute format('revoke all on function %s from macuxi_portal', v_f);
    end if;
    execute format('grant execute on function %s to macuxi_app', v_f);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'macuxi_portal') then
    revoke usage on schema plataforma from macuxi_portal;
  end if;
end
$$;
