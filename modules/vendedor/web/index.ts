import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { OrdersPage } from './components/orders/orders-page';
import { AlcadasPage } from './pages/alcadas-page';

/** Páginas do Vendedor no BKO (ADR 0003). O shell só monta se o módulo estiver efetivo e o perfil puder. */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'pedidos', caminho: 'pedidos', titulo: 'Pedidos', navegacao: 'Pedidos', grupo: 'operacao', componente: OrdersPage },
    { id: 'alcadas', caminho: 'alcadas', titulo: 'Alçadas', navegacao: 'Alçadas', grupo: 'cadastros', componente: AlcadasPage },
  ],
});
