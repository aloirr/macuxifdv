import { createElement, Suspense, type ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
export { entrarComSenha, mensagemDeErroDeLogin, validarLogin } from '../app/lib/login';
import { manifest } from '../manifest';
import { CarteiraPage } from './components/carteira/carteira-page';
import { Cliente360Page } from './components/cliente360/cliente360-page';
import { CoordenadasPage } from './components/coordenadas/coordenadas-page';
import { EmBrevePage } from './components/em-breve/em-breve-page';
import { ProdutosPage } from './components/produtos/produtos-page';
import { MotivosPage } from './components/motivos/motivos-page';
import { VisitasPage } from './components/visitas/visitas-page';
import { AparelhosPage } from './components/aparelhos/aparelhos-page';
import { LicencasPage } from './components/licencas/licencas-page';
import { UsuariosPage } from './components/usuarios/usuarios-page';
import { IndicadoresPage } from './components/indicadores/indicadores-page';
import { RecadosPage } from './components/recados/recados-page';
import { RoutesPage } from './components/routes/routes-page';

/** A página de rotas lê filtros da URL (`useSearchParams`), que no Next exige Suspense. */
const FarolEmBreve: ComponentType = () => createElement(EmBrevePage, { titulo: 'Farol de clientes', alternativa: 'Hoje, consulte a Carteira e o Cliente 360.' });
const MetasEmBreve: ComponentType = () => createElement(EmBrevePage, { titulo: 'Metas e RV', alternativa: 'Hoje, acompanhe as metas na tela Indicadores.' });
const PlanoRvEmBreve: ComponentType = () => createElement(EmBrevePage, { titulo: 'Parâmetros do plano de RV', alternativa: 'Os parâmetros em vigor seguem valendo.' });
const RotasPagina: ComponentType = () => createElement(Suspense, null, createElement(RoutesPage));

/**
 * Páginas do Core no BKO (ADR 0003; desenho T-0001 §5 e §14). Os rótulos de `navegacao` são os de
 * `manifest.apps.web.menus`. O shell só mostra se o módulo estiver efetivo e o perfil puder.
 * "Usuários e módulos" (licenças por tenant, perfil e usuário, só admin) é a tela de licenças da T-0003.
 * "Usuários" (T-0067) é a gestão de usuários: lista para supervisor/gerente/admin (recortada pelo escopo), escrita só do admin.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'clientes', caminho: 'clientes', titulo: 'Farol de clientes', navegacao: 'Clientes', grupo: 'operacao', ordem: 10, componente: FarolEmBreve },
    { id: 'rotas', caminho: 'rotas', titulo: 'Rotas', navegacao: 'Rotas', grupo: 'operacao', ordem: 20, componente: RotasPagina },
    { id: 'visitas', caminho: 'visitas', titulo: 'Visitas', navegacao: 'Visitas', grupo: 'operacao', ordem: 30, componente: VisitasPage },
    { id: 'recados', caminho: 'recados', titulo: 'Recados', navegacao: 'Recados', grupo: 'operacao', ordem: 40, acao: 'notificacao.enviar', componente: RecadosPage },
    { id: 'carteira', caminho: 'carteira', titulo: 'Carteira', navegacao: 'Carteira', grupo: 'cadastros', ordem: 5, componente: CarteiraPage },
    // Cliente 360 (T-0017): abre da Carteira (`/cliente?id=…`); sem item de menu
    { id: 'cliente', caminho: 'cliente', titulo: 'Cliente 360', componente: Cliente360Page },
    { id: 'coordenadas-sugeridas', caminho: 'coordenadas-sugeridas', titulo: 'Coordenadas sugeridas', navegacao: 'Coordenadas sugeridas', grupo: 'cadastros', ordem: 6, acao: 'cliente.aprovar_coordenada', componente: CoordenadasPage },
    { id: 'motivos', caminho: 'motivos', titulo: 'Motivos de não venda', navegacao: 'Motivos', grupo: 'cadastros', ordem: 7, acao: 'motivo.editar', componente: MotivosPage },
    { id: 'produtos', caminho: 'produtos', titulo: 'Preço e custo dos produtos', navegacao: 'Produtos', grupo: 'cadastros', ordem: 8, acao: 'produto.editar_preco', componente: ProdutosPage },
    { id: 'metas', caminho: 'metas', titulo: 'Metas e RV', navegacao: 'Metas', grupo: 'analise', ordem: 10, componente: MetasEmBreve },
    { id: 'indicadores', caminho: 'indicadores', titulo: 'Indicadores', navegacao: 'Indicadores', grupo: 'analise', ordem: 20, componente: IndicadoresPage },
    { id: 'plano-rv', caminho: 'plano-rv', titulo: 'Parâmetros do plano de RV', navegacao: 'Plano de RV', grupo: 'cadastros', ordem: 10, componente: PlanoRvEmBreve },
    {
      id: 'usuarios-e-modulos',
      caminho: 'usuarios-e-modulos',
      titulo: 'Usuários e módulos',
      navegacao: 'Usuários e módulos',
      grupo: 'administracao',
      ordem: 10,
      acao: 'modulo.gerir_licencas',
      componente: LicencasPage,
    },
    {
      id: 'usuarios',
      caminho: 'usuarios',
      titulo: 'Usuários',
      navegacao: 'Usuários',
      grupo: 'administracao',
      ordem: 15,
      acao: 'usuario.ver',
      componente: UsuariosPage,
    },
    {
      id: 'aparelhos',
      caminho: 'aparelhos',
      titulo: 'Aparelhos',
      navegacao: 'Aparelhos',
      grupo: 'administracao',
      ordem: 20,
      acao: 'dispositivo.bloquear',
      componente: AparelhosPage,
    },
  ],
});
