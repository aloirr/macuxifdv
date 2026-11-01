-- 0010_integracao (down) — T-0032
-- Desfaz a 0010 inteira: drop schema integracao cascade. APAGA Conectores, chaves de API (hashes), política de versão,
-- lotes e seus corpos/erros, o espelho dos registros do ERP (registro_atual), sessões de carga, pendências e a auditoria das
-- decisões de inativação, cursores, reconciliações, mapeamentos, a fila de pedidos para o ERP e as trilhas de retorno.
-- Depois de um novo up, cada Conector precisa de cadastro e chave nova no BKO, e a primeira carga completa recria o espelho.
-- As funções do schema (sem_repeticao, autenticar_chave, expurgar_retencao) e os grants de usage aos papéis caem junto.
-- Pré-condição: 0011+ desfeitas. Os papéis macuxi_app e macuxi_worker são do cluster e ficam.
drop schema if exists integracao cascade;
