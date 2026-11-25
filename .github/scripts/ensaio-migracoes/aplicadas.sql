-- Ensaio das migrações em produção (producao-ensaio-migracoes.yml), passo 1: lista o que o migrador (db/src/migrador.ts)
-- já aplicou em public.macuxi_migracao. Só leitura. Saída: "versao checksum checksum_down" (ou "-"), uma por linha.
\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
\set SHOW_CONTEXT never
begin transaction read only;
\pset format unaligned
\pset tuples_only on
\pset fieldsep ' '
select versao, checksum, coalesce(checksum_down, '-') from public.macuxi_migracao order by versao;
rollback;
