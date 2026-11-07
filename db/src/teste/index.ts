/**
 * @macuxi/db/teste — o que os testes de integração (agente `testes`, tests/) precisam do banco:
 * banco efêmero, fixture dois-tenants, conexão como papel de aplicação e contexto de tenant.
 * Ver docs/banco/README.md ("Para o agente testes").
 */
export { criarBancoDeTeste, postgresDisponivel, apagarBanco, listarBancosDeTeste, type BancoDeTeste } from '../banco-teste';
export { comTenant, definirTenant } from '../contexto';
export { lerConfig, PAPEL_APP, PAPEL_WORKER } from '../config';
export { carregarDoisTenants, dadosDoisTenants, CONVITES_FIXTURE, DOIS_TENANTS, ORDEM_TABELAS, PAGAMENTO_FIXTURE, PEPPER_HUB_FIXTURE } from '../../seeds/fixtures/dois-tenants';
export { carregarFaseM, dadosFaseM, TENANT_FASE_M } from '../../seeds/fase-m/fase-m';
export { carregarDemo, dadosDemo, TENANT_DEMO, CODIGO_DEMO, USUARIOS_DEMO } from '../../seeds/demo/demo';
export { TABELAS_SEM_TENANT_ID, TABELAS_FORA_DO_SYNC, TABELAS_SO_POR_FUNCAO } from '../excecoes';
export { idDeChave, idMotivoPadrao, idParametroCore, MOTIVOS_PADRAO } from '../ids';
export { hojeNoFuso, somarDias, anoMes, agoraDosTestes, VAR_AGORA } from '../datas';
// Instante da carga da fixture no globalSetup (T-0042, B3): uma linha do tempo só entre a fixture e os testes.
export { agoraDaFixture, hojeDaFixture } from '../../testes/estado';
