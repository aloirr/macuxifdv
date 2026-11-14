// Dublê das linhas do sync no aparelho; a ficha é montada pelo `montarFichaLocal` real.
import { PARAMETROS_CURVA_ABC_PADRAO } from '@core/domain';
import { ANA, CLIENTE } from './cenario';

export { montarFichaLocal } from '@core/app/lib/usar-clientes-locais.ts';

const base = { tenant_id: '00000000-0000-4000-8000-0000000000t1', created_at: '2019-03-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', deleted_at: null, external_id: null };
const dados = {
  clientes: [{ ...base, id: CLIENTE, documento: '00000000000000', razao_social: 'Mercadinho Boa Vista Ltda', nome_fantasia: 'Mercadinho Boa Vista', segmento: 'Varejo', telefone: '95999990000', email: null, logradouro: 'Av. Ene Garcez', numero: '1250', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301000', latitude: 2.82, longitude: -60.67, ativo: true }],
  financeiros: [], titulos: [], historico: [], contatos: [], enderecos: [], filiais: [], fotoTipos: [], clienteFotos: [], fotosPendentes: [],
  pronto: true, carregado: true, verPedidos: true, faixasCurva: PARAMETROS_CURVA_ABC_PADRAO, pedidos: [], pedidoItens: [], visitasSync: [],
  resumosVisita: [{ ...base, id: CLIENTE, cliente_id: CLIENTE, total_visitas: 37, ultima_visita_em: '2026-11-12T14:05:00.000Z', ultima_visita_usuario_id: ANA, ultima_visita_usuario_nome: 'Ana Souza' }],
};
export const useClientesLocais = () => ({ dados, hoje: '2026-11-14' });
