// Dublê do shell: extensões que os outros módulos registram na ficha (Pesquisa e, no Campo, o "Novo pedido" do Vendedor).
import { C } from './cenario';

const PesquisaVazia = () => null;
const abas = [{ modulo: 'pesquisa', id: 'pesquisas', payload: { rotulo: 'Pesquisas', testID: 'ficha-pesquisas', componente: PesquisaVazia } }];
const acoes = C === 'gestao' ? [] : [{ modulo: 'vendedor', id: 'novo-pedido', acao: 'pedido.criar', payload: { rotulo: 'Novo pedido', testID: 'pedido-novo', icone: 'plus', destaque: true, abrir: () => undefined } }];
export const useExtensoes = (ponto: string) => (ponto === 'cliente.abas' ? abas : ponto === 'cliente.acoes' ? acoes : []);
export const usePode = () => true;
export const useMotorSync = () => ({ motor: null, estado: { fila: [], aceitos: [], sincronizado_em: null } });
