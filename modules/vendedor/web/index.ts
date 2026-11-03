import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { OrdersPage } from './components/orders/orders-page';
import { AlcadasPage } from './pages/alcadas-page';
import { TransportadorasPage } from './pages/transportadoras-page';

/** Páginas do Vendedor no BKO (ADR 0003). O shell só monta se o módulo estiver efetivo e o perfil puder. */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'pedidos', caminho: 'pedidos', titulo: 'Pedidos', navegacao: 'Pedidos', grupo: 'operacao', acao: 'pedido.ver', perfis: manifest.perfis, componente: OrdersPage },
    { id: 'alcadas', caminho: 'alcadas', titulo: 'Alçadas', navegacao: 'Alçadas', grupo: 'cadastros', perfis: manifest.perfis, componente: AlcadasPage },
    // T-0061 (RN-VEN-16): transportadoras do FOB e padrão do frete; a escrita é só de admin, analista e gerente (a API decide)
    { id: 'transportadoras', caminho: 'transportadoras', titulo: 'Transportadoras', navegacao: 'Transportadoras', grupo: 'cadastros', acao: 'transportadora.ver', perfis: ['admin', 'analista', 'gerente', 'supervisor', 'assistente'], componente: TransportadorasPage },
  ],
});
