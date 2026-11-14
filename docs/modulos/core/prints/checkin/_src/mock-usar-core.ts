// Dublê de dados do Core: carteira com o cliente da ficha, rota do dia e o atendimento aberto de cada cenário.
import { C, CHECKIN_EM, CLIENTE, EU, OUTRO, TZ } from './cenario';

const cliente = (id: string, nome: string, endereco: string) => ({
  id, erp_code: '1001', trade_name: nome, legal_name: `${nome} Ltda`, cnpj: '00000000000000', segment: 'Varejo', abc_curve: 'A',
  address: endereco, city: 'Boa Vista', district: 'Centro', lat: 2.82, lng: -60.67, phone: '95999990000', email: '', seller_id: EU,
  seller_name: 'Maria', customer_since: '2019-03-01', credit_limit_cents: 0, days_since_purchase: null,
});
const visita = (id: string, clienteId: string, nome: string) => ({
  id, seller_id: EU, customer_id: clienteId, customer_name: nome, route_stop_id: null, checkin_at: CHECKIN_EM, lat: null, lng: null,
  outcome: null, no_order_reason: '', order_id: null, order_total_cents: null, checkout_at: null,
});
const aqui = visita('00000000-0000-4000-8000-0000000000v1', CLIENTE, 'Mercadinho Boa Vista');
const la = visita('00000000-0000-4000-8000-0000000000v2', OUTRO, 'Supermercado Pérola');
// folha do check-in: a visita recém-registrada já está no aparelho (senão a tela fecha a folha)
export const VISITA_NOVA = visita('00000000-0000-4000-8000-0000000000v3', CLIENTE, 'Mercadinho Boa Vista');
const aberto = C === 'checkout' ? aqui : C === 'bloqueado' ? la : null;
const visitas = C.startsWith('folha') ? [VISITA_NOVA] : aberto ? [aberto] : [];

const uso = {
  armazem: {},
  motor: {},
  estado: { carregado: true, me: null, clientes: [cliente(CLIENTE, 'Mercadinho Boa Vista', 'Av. Ene Garcez, 1250'), cliente(OUTRO, 'Supermercado Pérola', 'Rua Cecília Brasil, 300')], rota: null, metas: null, pedidos: [], visitas, motivos: [], raioCheckinM: null, sincronizadoEm: null },
  tz: TZ,
  vendedorId: EU,
  atendimentoAberto: C.startsWith('folha') ? null : aberto,
  rota: { stops: [{ id: 'parada-1', customer: { id: CLIENTE }, visit: null }, { id: 'parada-2', customer: { id: OUTRO }, visit: null }] },
  pedidos: [],
  sincronizando: false,
  sincronizar: () => undefined,
};
export const useCore = () => uso;
