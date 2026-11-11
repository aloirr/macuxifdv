-- 0058_plataforma_diagnostico (down) — desfaz a 0058 (T-0158, ADR 0043) e volta exatamente ao catálogo e às ACLs da 0057.
-- APAGA os diagnósticos e a sequência do protocolo (a numeração recomeça em 1 se a 0058 for reaplicada). Os metadados dos
-- prints (plataforma.arquivo, modulo 'plataforma', finalidade 'print_diagnostico') e os bytes no armazenamento FICAM: antes do
-- down, se precisar, liste as chaves com
--   select chave_armazenamento from plataforma.arquivo where modulo = 'plataforma' and finalidade = 'print_diagnostico';
-- e apague os objetos e as linhas. Pré-condição: a API e o worker sem as rotas e as tarefas do diagnóstico (T-0158).

drop function if exists plataforma.expurgar_diagnosticos(timestamptz, integer);
drop function if exists plataforma.sa_diagnostico(uuid, uuid);
drop function if exists plataforma.sa_listar_diagnosticos(uuid, jsonb);
-- a tabela leva junto índices, gatilho, políticas, grants e a sequência (owned by plataforma.diagnostico.protocolo)
drop table if exists plataforma.diagnostico;
drop sequence if exists plataforma.diagnostico_protocolo_seq;
