-- 0063_core_usuario_limite_desconto (up) — T-0168 (RN-VEN-11a): limite de desconto por item e por pedido, por usuário.
-- Pedido: R-20261112-151014-engenheiro-software. Desenho: docs/desenho/T-0168.md §1. Migração em cima da 0062.
-- Dicionário: docs/banco/core.md ("0063"). Teste: db/testes/usuario-limite-desconto.db.test.ts.
--
-- Migração ADITIVA: 3 colunas em core.usuario e 2 CHECKs. Sem backfill explícito: `add column ... not null default <constante>`
-- preenche quem já existe pelo default, sem reescrever a tabela (PG >= 11) e SEM andar o updated_at (nenhum aparelho puxa de
-- novo por causa da 0063). Todo usuário antigo fica "por item" ligada e "por pedido" desligada, o comportamento de hoje.
-- Nenhum contrato muda de versão; RLS, políticas e grants de core.usuario não mudam (as colunas herdam os da tabela).
--
-- core.usuario (dono: Core):
--   desconto_limita_item           boolean not null default true   "Limitar desconto por item" (RN-VEN-11 ligada: o item
--                                                                  respeita o desconto máximo do produto).
--   desconto_limita_pedido         boolean not null default false  "Limitar desconto por pedido".
--   desconto_maximo_pedido_permil  integer null                     desconto máximo do pedido em DÉCIMOS de % (‰): 8,0% = 80,
--                                                                  7,5% = 75; faixa 0..1000 (usuario_desconto_pedido_permil_faixa).
--                                                                  Nome `_permil` de propósito: no repositório `_pct` é % decimal.
--   usuario_desconto_pedido_com_limite: "por pedido" ligada exige o número. Desligar "por pedido" MANTÉM o número gravado
--   (religar devolve o valor), por isso o CHECK não exige nulo com a função desligada.
-- A carga do ERP e o CSV da Equipe não gravam as 3 colunas (usuário novo nasce com o padrão); quem grava é o BKO do Core.
-- O updated_at sobe pelo gatilho usuario_updated_at em toda edição (o sync puxa a linha de novo).
-- Volume: o de core.usuario (dezenas a centenas por tenant). Consultas: as de hoje por PK (cadastro_resumo, sync do usuário);
-- nenhum índice novo.
--
-- Caminho de volta: 0063_core_usuario_limite_desconto.down.sql (apaga os 2 CHECKs e as 3 colunas; os limites gravados no BKO
-- se perdem e reaplicar a 0063 volta todos ao padrão). Volte antes o código do Core e do Vendedor que lê ou grava as colunas
-- (senão 42703).

alter table core.usuario add column desconto_limita_item boolean not null default true;
alter table core.usuario add column desconto_limita_pedido boolean not null default false;
alter table core.usuario add column desconto_maximo_pedido_permil integer;

alter table core.usuario add constraint usuario_desconto_pedido_permil_faixa
  check (desconto_maximo_pedido_permil is null or desconto_maximo_pedido_permil between 0 and 1000);
alter table core.usuario add constraint usuario_desconto_pedido_com_limite
  check (not desconto_limita_pedido or desconto_maximo_pedido_permil is not null);
