-- 0016_pesquisa (down) — T-0057
-- Desfaz a 0016. APAGA todos os questionários, versões e respostas da Pesquisa (schema pesquisa inteiro, com as
-- funções dos gatilhos). Os metadados das fotos em plataforma.arquivo (finalidade pesquisa_foto) ficam, sem dono
-- lógico; as linhas de licença (plataforma.tenant_modulo/perfil_modulo com modulo = 'pesquisa') e a auditoria também
-- ficam (são da plataforma). Pré-condição: 0017+ desfeitas. Depois do down, a API da Pesquisa ligada ao repositório
-- SQL falha por falta das tabelas (volte a fábrica para o repositório em memória).
drop schema if exists pesquisa cascade;
