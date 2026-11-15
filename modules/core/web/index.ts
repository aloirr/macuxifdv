import { createElement, Suspense, type ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
export { entrarComSenha, mensagemDeErroDeLogin } from '../app/lib/login';
export { validarLogin } from '../contracts';
import { manifest } from '../manifest';
import { CarteiraPage } from './components/carteira/carteira-page';
import { Cliente360Page } from './components/cliente360/cliente360-page';
import { CoordenadasPage } from './components/coordenadas/coordenadas-page';
import { FarolPage } from './components/farol/farol-page';
import { PlanoRvPage } from './components/plano-rv/plano-rv-page';
import { ProdutosPage } from './components/produtos/produtos-page';
import { MotivosPage } from './components/motivos/motivos-page';
import { VisitasPage } from './components/visitas/visitas-page';
import { FotosPdvPage } from './components/fotos-pdv/fotos-pdv-page';
import { FiliaisPage } from './components/filiais/filiais-page';
import { AparelhosPage } from './components/aparelhos/aparelhos-page';
import { LicencasPage } from './components/licencas/licencas-page';
import { UsuariosPage } from './components/usuarios/usuarios-page';
import { PerfisPage } from './components/perfis/perfis-page';
import { MetasPage } from './components/metas/metas-page';
import { IndicadoresPage } from './components/indicadores/indicadores-page';
import { RecadosPage } from './components/recados/recados-page';
import { CalendarioPage } from './components/calendario/calendario-page';
import { CurvasAbcParametrosPanel } from './components/farol/curvas-abc-parametros-panel';
import { FarolParametrosPanel } from './components/farol/farol-parametros-panel';
import { FrasesDoDiaPanel } from './components/frases-do-dia/frases-do-dia-panel';
import { PromotorPedidosPanel } from './components/licencas/promotor-pedidos-panel';
import { CheckoutPendenciaPanel } from './components/metas/checkout-pendencia-panel';
import { InicioParametrosPanel } from './components/metas/inicio-parametros-panel';
import { DescontoPadraoPanel } from './components/produtos/desconto-padrao-panel';
import { MedidasParametrosPanel } from './components/produtos/medidas-parametros-panel';
import { RoutesPage } from './components/routes/routes-page';

/** A página de rotas lê filtros da URL (`useSearchParams`), que no Next exige Suspense. */
const RotasPagina: ComponentType = () => createElement(Suspense, null, createElement(RoutesPage));

const painel = (C: ComponentType<{ semMoldura?: boolean }>): ComponentType => () => createElement(C, { semMoldura: true });
const PainelFarol = painel(FarolParametrosPanel);
const PainelCurvasAbc = painel(CurvasAbcParametrosPanel);
const PainelInicio = painel(InicioParametrosPanel);
const PainelFrases = painel(FrasesDoDiaPanel);
const PainelEtapaPendente = painel(CheckoutPendenciaPanel);
const PainelDesconto = painel(DescontoPadraoPanel);
const PainelMedidas = painel(MedidasParametrosPanel);
const PainelPromotorPedidos = painel(PromotorPedidosPanel);
const PainelPerfis: ComponentType = () => createElement(PerfisPage, { emPainel: true });
const PainelModulos: ComponentType = () => createElement(LicencasPage, { emPainel: true });
const PainelMotivos: ComponentType = () => createElement(MotivosPage, { emPainel: true });
const PainelFotosPdv: ComponentType = () => createElement(FotosPdvPage, { emPainel: true });
const PainelCalendario: ComponentType = () => createElement(CalendarioPage, { embutido: true });

/**
 * Páginas do Core no BKO (ADR 0003; desenho T-0001 §5 e §14). Os rótulos de `navegacao` são os de
 * `manifest.apps.web.menus`. O shell só mostra se o módulo estiver efetivo e o perfil puder.
 * "Usuários e módulos" (licenças por tenant, perfil e usuário, só admin) é a tela de licenças da T-0003.
 * "Usuários" (T-0067) é a gestão de usuários: lista para supervisor/gerente/admin (recortada pelo escopo), escrita só do admin.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  // ADR 0058: página única de Parâmetros; cada painel mantém a ação de antes (a API revalida)
  paineisParametros: [
    { id: 'perfis', secao: 'acesso', titulo: 'Perfis de acesso', ordem: 10, acao: 'perfil.gerir', caminhosAntigos: ['perfis'], componente: PainelPerfis },
    { id: 'usuarios-e-modulos', secao: 'acesso', titulo: 'Módulos', ordem: 20, acao: 'modulo.gerir_licencas', caminhosAntigos: ['usuarios-e-modulos'], componente: PainelModulos },
    { id: 'motivos', secao: 'visitas', titulo: 'Motivos de não venda', ordem: 10, acao: 'motivo.editar', caminhosAntigos: ['motivos'], componente: PainelMotivos },
    { id: 'fotos-pdv', secao: 'visitas', titulo: 'Fotos do PDV', ordem: 20, acao: 'foto_tipo.editar', caminhosAntigos: ['fotos-pdv'], componente: PainelFotosPdv },
    { id: 'farol', secao: 'clientes', titulo: 'Farol', ordem: 10, acao: 'parametro.farol', componente: PainelFarol },
    { id: 'curvas-abc', secao: 'clientes', titulo: 'Curvas ABC', ordem: 20, acao: 'parametro.curva_abc', componente: PainelCurvasAbc },
    { id: 'inicio', secao: 'inicio', titulo: 'Dias úteis e equipe parada', ordem: 10, acao: 'parametro.inicio', componente: PainelInicio },
    { id: 'frases-do-dia', secao: 'inicio', titulo: 'Frases do dia', ordem: 20, acao: 'frase_dia.editar', componente: PainelFrases },
    { id: 'etapa-pendente', secao: 'visitas', titulo: 'Etapa pendente', ordem: 50, acao: 'parametro.checkout_pendencia', componente: PainelEtapaPendente },
    { id: 'calendario', secao: 'calendario', titulo: 'Calendário', ordem: 10, acao: 'parametro.inicio', componente: PainelCalendario },
    { id: 'desconto', secao: 'produtos', titulo: 'Desconto máximo padrão', ordem: 10, acao: 'produto.parametros', componente: PainelDesconto },
    { id: 'medidas', secao: 'produtos', titulo: 'Medidas', ordem: 20, acao: 'medida.gerenciar', componente: PainelMedidas },
    { id: 'promotor-pedidos', secao: 'acesso', titulo: 'Promotor vê pedidos', ordem: 50, acao: 'parametro.promotor_ve_pedidos', componente: PainelPromotorPedidos },
  ],
  paginas: [
    { id: 'clientes', caminho: 'clientes', titulo: 'Farol de clientes', navegacao: 'Clientes', grupo: 'cadastros', ordem: 10, acao: 'farol.ver', componente: FarolPage },
    { id: 'rotas', caminho: 'rotas', titulo: 'Rotas', navegacao: 'Rotas', grupo: 'operacao', ordem: 20, componente: RotasPagina },
    { id: 'visitas', caminho: 'visitas', titulo: 'Visitas', navegacao: 'Visitas', grupo: 'operacao', ordem: 30, componente: VisitasPage },
    { id: 'recados', caminho: 'recados', titulo: 'Recados', navegacao: 'Recados', grupo: 'comunicacao', ordem: 40, acao: 'notificacao.enviar', componente: RecadosPage },
    { id: 'carteira', caminho: 'carteira', titulo: 'Carteira', navegacao: 'Carteira', grupo: 'cadastros', ordem: 5, componente: CarteiraPage },
    // Cliente 360 (T-0017): abre da Carteira (`/cliente?id=…`); sem item de menu
    { id: 'cliente', caminho: 'cliente', titulo: 'Cliente 360', componente: Cliente360Page },
    { id: 'coordenadas-sugeridas', caminho: 'coordenadas-sugeridas', titulo: 'Coordenadas sugeridas', navegacao: 'Coordenadas sugeridas', grupo: 'cadastros', ordem: 6, acao: 'cliente.aprovar_coordenada', componente: CoordenadasPage },
    { id: 'motivos', caminho: 'motivos', titulo: 'Motivos de não venda', navegacao: 'Motivos', grupo: 'cadastros', ordem: 7, acao: 'motivo.editar', componente: MotivosPage },
    { id: 'produtos', caminho: 'produtos', titulo: 'Preço e custo dos produtos', navegacao: 'Preço e custo', grupo: 'produtos', ordem: 8, acao: 'produto.editar_preco', componente: ProdutosPage },
    { id: 'filiais', caminho: 'filiais', titulo: 'Filiais', navegacao: 'Filiais', grupo: 'cadastros', ordem: 9, acao: 'filial.ver', componente: FiliaisPage },
    { id: 'fotos-pdv', caminho: 'fotos-pdv', titulo: 'Fotos do PDV', navegacao: 'Fotos do PDV', grupo: 'cadastros', ordem: 9, acao: 'foto_tipo.editar', componente: FotosPdvPage },
    { id: 'metas', caminho: 'metas', titulo: 'Metas e RV', navegacao: 'Metas', grupo: 'analise', ordem: 10, componente: MetasPage },
    { id: 'indicadores', caminho: 'indicadores', titulo: 'Indicadores', navegacao: 'Indicadores', grupo: 'analise', ordem: 20, componente: IndicadoresPage },
    { id: 'plano-rv', caminho: 'plano-rv', titulo: 'Plano de RV', navegacao: 'Plano de RV', grupo: 'comercial', ordem: 10, acao: 'plano_rv.ver', componente: PlanoRvPage },
    {
      id: 'usuarios-e-modulos',
      caminho: 'usuarios-e-modulos',
      titulo: 'Usuários e módulos',
      // sem `navegacao`: fora do menu (spec bko-revisao §M7, R-20261114-144500); a página segue valendo por URL
      grupo: 'acesso',
      ordem: 10,
      acao: 'modulo.gerir_licencas',
      componente: LicencasPage,
    },
    {
      id: 'usuarios',
      caminho: 'usuarios',
      titulo: 'Usuários',
      navegacao: 'Usuários',
      grupo: 'acesso',
      ordem: 17,
      acao: 'usuario.ver',
      componente: UsuariosPage,
    },
    // T-0111 (desenho docs/design/perfis-de-acesso.md): lista em /core/perfis e edição em /core/perfis?perfil=<codigo> (o shell não tem rota dinâmica)
    { id: 'perfis', caminho: 'perfis', titulo: 'Perfis de acesso', navegacao: 'Perfis de acesso', grupo: 'acesso', ordem: 16, acao: 'perfil.gerir', componente: PerfisPage },
    {
      id: 'aparelhos',
      caminho: 'aparelhos',
      titulo: 'Aparelhos',
      navegacao: 'Aparelhos',
      grupo: 'acesso',
      ordem: 20,
      acao: 'dispositivo.bloquear',
      componente: AparelhosPage,
    },
  ],
});
