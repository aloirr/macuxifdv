/**
 * @macuxi/db/teste — o que os testes de integração (agente `testes`, tests/) precisam do banco:
 * banco efêmero, fixture dois-tenants, conexão como papel de aplicação e contexto de tenant.
 * Ver docs/banco/README.md ("Para o agente testes").
 */
export { criarBancoDeTeste, postgresDisponivel, apagarBanco, listarBancosDeTeste, type BancoDeTeste } from '../banco-teste';
export { comTenant, definirTenant } from '../contexto';
export { lerConfig, PAPEL_APP } from '../config';
export { carregarDoisTenants, dadosDoisTenants, DOIS_TENANTS, ORDEM_TABELAS } from '../../seeds/fixtures/dois-tenants';
export { carregarFaseM, dadosFaseM, TENANT_FASE_M } from '../../seeds/fase-m/fase-m';
export { TABELAS_SEM_TENANT_ID } from '../excecoes';
