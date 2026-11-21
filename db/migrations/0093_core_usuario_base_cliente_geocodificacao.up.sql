-- 0093_core_usuario_base_cliente_geocodificacao (up) — T-0191 (Rotas: endereço da casa e base do vendedor, prévia da rota e
-- geração de coordenada do cliente; RN-CORE-75 a 77). Desenho de dados: .coord/tarefas/T-0191.md ("Desenho de dados").
-- Migração em cima da 0092 (RF-CAT-04, 0092_catalogo_no_codigo_por_pai); o número segue a ordem de merge. Dicionário:
-- docs/banco/core.md ("0093"). Teste: db/testes/usuario-base-cliente-geocodificacao.db.test.ts (estático sempre; banco e
-- up/down com o Postgres local).
--
-- Migração ADITIVA: só colunas nulas, sem default, e CHECKs. Nenhuma tabela, índice ou política nova; RLS (isolamento_tenant,
-- manutencao e leitura), gatilhos e grants do macuxi_app em core.usuario e core.cliente não mudam (as colunas herdam os da
-- tabela). Nenhum contrato muda de versão. Coordenadas em numeric(9,6), o tipo de core.cliente.latitude/longitude (0002).
--
-- 1. core.usuario (dono: Core) — endereço da casa e base do vendedor/promotor (ponto de partida da rota, RN-CORE-75):
--      casa_cep text · casa_logradouro text · casa_numero text · casa_bairro text · casa_cidade text · casa_uf text
--      casa_lat numeric(9,6) · casa_lng numeric(9,6)            ponto da casa, marcado no mapa
--      base_tipo text                                           'casa' (a base usa o ponto da casa) | 'outro'; nulo = sem base
--      base_cep text · base_logradouro text · base_numero text · base_bairro text · base_cidade text · base_uf text
--      base_lat numeric(9,6) · base_lng numeric(9,6)            ponto da base quando base_tipo = 'outro'
--      base_alterada_em timestamptz                             última troca da base (UTC), gravada pela API
--    CHECKs: CEP com 8 dígitos (usuario_casa_cep_formato, usuario_base_cep_formato); UF com 2 letras maiúsculas
--    (usuario_casa_uf_formato, usuario_base_uf_formato); lat -90..90 e lng -180..180 (usuario_casa_coordenada_faixa,
--    usuario_base_coordenada_faixa); lat e lng juntos (usuario_casa_coordenada_par, usuario_base_coordenada_par);
--    base_tipo válido (usuario_base_tipo_valido) e base 'outro' com o ponto (usuario_base_outro_com_ponto).
--    Quem grava: o BKO do Core (PUT /v1/core/usuarios/:id/endereco e /base). ERP e CSV da Equipe não tocam. Fora do pull.
--    macuxi_leitura (0078, SELECT por coluna em core.usuario): NENHUM grant nas colunas novas — o endereço e o ponto da casa
--    (e a base, que pode ser a casa) são dado pessoal do trabalhador, e a saída da consulta vai para o log do Actions
--    (regra 8; mesmo critério da 0089, ADR 0061 item 7).
--
-- 2. core.cliente (dono: Core) — origem e precisão da coordenada e geocodificação (botão "Gerar coordenada", RN-CORE-77):
--      coordenada_origem text            'erp' | 'checkin' | 'geocodificacao' | 'manual'; nulo = desconhecida
--      coordenada_precisao text          'numero' | 'rua' | 'cep' (da geocodificação); nulo
--      geocodificacao_tentada_em timestamptz  última tentativa de geocodificar (UTC)
--      geocodificacao_chave text         hash do endereço e do CEP tentados (a mesma chave tentada de novo = JA_TENTADO)
--    CHECKs: cliente_coordenada_origem_valida e cliente_coordenada_precisao_valida.
--    Backfill: cliente com latitude preenchida recebe coordenada_origem = 'erp' (a coordenada de hoje só vem do ERP), com o
--    gatilho cliente_updated_at desligado só neste UPDATE (nenhum aparelho puxa o cliente de novo por causa da 0093).
--    Depois: o consumidor do ERP grava 'erp'; a aprovação de Coordenadas sugeridas grava 'checkin'.
--    macuxi_leitura (0078): core.cliente tinha SELECT de TABELA (nenhuma coluna sensível); geocodificacao_chave tem "chave" no
--    nome (sensível pela regra da 0078), então o SELECT passa a ser POR COLUNA, com todas as colunas menos ela (como a 0083
--    fez em plataforma.tenant). As outras 3 colunas novas ficam legíveis.
--
-- Volume: o de core.usuario (dezenas a centenas por tenant) e core.cliente (milhares a dezenas de milhares); leitura por PK
-- e pela carteira (já indexadas); nenhum índice novo.
--
-- Caminho de volta: 0093_core_usuario_base_cliente_geocodificacao.down.sql (APAGA as 22 colunas e os CHECKs; perde a casa,
-- a base, a origem/precisão das coordenadas e as tentativas de geocodificação — as coordenadas dos clientes ficam — e devolve
-- ao macuxi_leitura o SELECT de tabela em core.cliente). Volte antes o código do Core que lê ou grava as colunas (senão 42703).

-- =============================================================================================
-- 1. core.usuario — casa e base
-- =============================================================================================
alter table core.usuario add column casa_cep text;
alter table core.usuario add column casa_logradouro text;
alter table core.usuario add column casa_numero text;
alter table core.usuario add column casa_bairro text;
alter table core.usuario add column casa_cidade text;
alter table core.usuario add column casa_uf text;
alter table core.usuario add column casa_lat numeric(9,6);
alter table core.usuario add column casa_lng numeric(9,6);
alter table core.usuario add column base_tipo text;
alter table core.usuario add column base_cep text;
alter table core.usuario add column base_logradouro text;
alter table core.usuario add column base_numero text;
alter table core.usuario add column base_bairro text;
alter table core.usuario add column base_cidade text;
alter table core.usuario add column base_uf text;
alter table core.usuario add column base_lat numeric(9,6);
alter table core.usuario add column base_lng numeric(9,6);
alter table core.usuario add column base_alterada_em timestamptz;

alter table core.usuario add constraint usuario_casa_cep_formato check (casa_cep is null or casa_cep ~ '^[0-9]{8}$');
alter table core.usuario add constraint usuario_casa_uf_formato check (casa_uf is null or casa_uf ~ '^[A-Z]{2}$');
alter table core.usuario add constraint usuario_casa_coordenada_faixa
  check ((casa_lat is null or casa_lat between -90 and 90) and (casa_lng is null or casa_lng between -180 and 180));
alter table core.usuario add constraint usuario_casa_coordenada_par check ((casa_lat is null) = (casa_lng is null));
alter table core.usuario add constraint usuario_base_tipo_valido check (base_tipo is null or base_tipo in ('casa', 'outro'));
alter table core.usuario add constraint usuario_base_cep_formato check (base_cep is null or base_cep ~ '^[0-9]{8}$');
alter table core.usuario add constraint usuario_base_uf_formato check (base_uf is null or base_uf ~ '^[A-Z]{2}$');
alter table core.usuario add constraint usuario_base_coordenada_faixa
  check ((base_lat is null or base_lat between -90 and 90) and (base_lng is null or base_lng between -180 and 180));
alter table core.usuario add constraint usuario_base_coordenada_par check ((base_lat is null) = (base_lng is null));
alter table core.usuario add constraint usuario_base_outro_com_ponto
  check (base_tipo is distinct from 'outro' or (base_lat is not null and base_lng is not null));

-- =============================================================================================
-- 2. core.cliente — origem e precisão da coordenada, geocodificação
-- =============================================================================================
alter table core.cliente add column coordenada_origem text;
alter table core.cliente add column coordenada_precisao text;
alter table core.cliente add column geocodificacao_tentada_em timestamptz;
alter table core.cliente add column geocodificacao_chave text;

alter table core.cliente add constraint cliente_coordenada_origem_valida
  check (coordenada_origem is null or coordenada_origem in ('erp', 'checkin', 'geocodificacao', 'manual'));
alter table core.cliente add constraint cliente_coordenada_precisao_valida
  check (coordenada_precisao is null or coordenada_precisao in ('numero', 'rua', 'cep'));

-- Backfill: a coordenada que já existe veio do ERP. Gatilho de updated_at desligado só neste UPDATE (dentro da transação da
-- migração): nenhum cliente é puxado de novo pelo app só por causa da 0093.
alter table core.cliente disable trigger cliente_updated_at;
update core.cliente set coordenada_origem = 'erp' where latitude is not null;
alter table core.cliente enable trigger cliente_updated_at;

-- consulta só leitura (0078): SELECT por coluna em core.cliente, sem a sensível geocodificacao_chave
do $$
declare
  v_colunas text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_colunas
    from pg_attribute a
   where a.attrelid = 'core.cliente'::regclass and a.attnum > 0 and not a.attisdropped
     and not (a.attname ~ '(hash|token|senha|segredo|chave|carga|cifrad)' and a.atttypid <> 'boolean'::regtype);
  execute 'revoke select on core.cliente from macuxi_leitura';
  execute format('grant select (%s) on core.cliente to macuxi_leitura', v_colunas);
end
$$;
