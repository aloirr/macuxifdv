-- 0093_core_usuario_base_cliente_geocodificacao (down) — desfaz a 0093 (T-0191) e volta exatamente ao catálogo e às ACLs da
-- 0092. APAGA as 22 colunas com os CHECKs: a casa e a base dos usuários, a origem e a precisão das coordenadas e as tentativas
-- de geocodificação dos clientes (as coordenadas dos clientes ficam). O macuxi_leitura volta ao SELECT de tabela em
-- core.cliente. Idempotente. Pré-condição: o código do Core sem as rotas de endereço, base, prévia, lote e "Gerar coordenada"
-- e sem ler ou gravar as colunas (senão 42703).

-- core.cliente (drop column leva os CHECKs e o SELECT por coluna da coluna)
alter table core.cliente drop constraint if exists cliente_coordenada_precisao_valida;
alter table core.cliente drop constraint if exists cliente_coordenada_origem_valida;
alter table core.cliente drop column if exists geocodificacao_chave;
alter table core.cliente drop column if exists geocodificacao_tentada_em;
alter table core.cliente drop column if exists coordenada_precisao;
alter table core.cliente drop column if exists coordenada_origem;
-- o revoke de tabela leva junto o SELECT por coluna da 0093
revoke select on core.cliente from macuxi_leitura;
grant select on core.cliente to macuxi_leitura;

-- core.usuario
alter table core.usuario drop constraint if exists usuario_base_outro_com_ponto;
alter table core.usuario drop constraint if exists usuario_base_coordenada_par;
alter table core.usuario drop constraint if exists usuario_base_coordenada_faixa;
alter table core.usuario drop constraint if exists usuario_base_uf_formato;
alter table core.usuario drop constraint if exists usuario_base_cep_formato;
alter table core.usuario drop constraint if exists usuario_base_tipo_valido;
alter table core.usuario drop constraint if exists usuario_casa_coordenada_par;
alter table core.usuario drop constraint if exists usuario_casa_coordenada_faixa;
alter table core.usuario drop constraint if exists usuario_casa_uf_formato;
alter table core.usuario drop constraint if exists usuario_casa_cep_formato;
alter table core.usuario drop column if exists base_alterada_em;
alter table core.usuario drop column if exists base_lng;
alter table core.usuario drop column if exists base_lat;
alter table core.usuario drop column if exists base_uf;
alter table core.usuario drop column if exists base_cidade;
alter table core.usuario drop column if exists base_bairro;
alter table core.usuario drop column if exists base_numero;
alter table core.usuario drop column if exists base_logradouro;
alter table core.usuario drop column if exists base_cep;
alter table core.usuario drop column if exists base_tipo;
alter table core.usuario drop column if exists casa_lng;
alter table core.usuario drop column if exists casa_lat;
alter table core.usuario drop column if exists casa_uf;
alter table core.usuario drop column if exists casa_cidade;
alter table core.usuario drop column if exists casa_bairro;
alter table core.usuario drop column if exists casa_numero;
alter table core.usuario drop column if exists casa_logradouro;
alter table core.usuario drop column if exists casa_cep;
