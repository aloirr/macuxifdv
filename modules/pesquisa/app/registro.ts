/**
 * Registro da Pesquisa no shell do app (ADR 0003; T-0057), genérico no tipo de componente para ser testado sem React
 * Native: aba "Pesquisas" e formulário (Campo e Gestão), seção na ficha do cliente (`cliente.abas`), etapa obrigatória
 * do checkout (`visita.etapas_checkout`, RN-PES-03) e card no Início. Tudo exige a ação `pesquisa.responder`.
 */
import type { AbaCliente, CardInicio, ContextoCheckout, ContextoCliente, EtapaCheckout } from '@macuxi/core/contracts';
import { definirModuloShell, type ImplementacaoConsultaAparelho, type ModuloShell } from '@macuxi/platform-sdk';
import { ENTIDADES_PESQUISA } from '../contracts/entidades';
import { manifest } from '../manifest';
import { CAMINHO_PESQUISAS, CAMINHO_RESPONDER } from './caminhos';

/** Doc 03 §2: quem responde pesquisa (vendedor, promotor, supervisor e gerente). */
export const PERFIS_RESPONDEM = ['vendedor', 'promotor', 'supervisor', 'gerente'] as const;

export interface ComponentesPesquisa<C> {
  pesquisas: C;
  responder: C;
  abaCliente: C;
  etapaCheckout: C;
  cardInicio: C;
}

/**
 * RF-PES-03: o botão "Pesquisa" da ficha só aparece com pesquisa disponível para o cliente. Campo aditivo que o
 * contrato `AbaCliente` do Core ainda não declara; quando declarar, este tipo continua compatível.
 */
export type DisponivelCliente = (contexto: ContextoCliente) => boolean;

export function montarModuloApp<C>(
  c: ComponentesPesquisa<C>,
  concluida: (ctx: ContextoCheckout) => boolean,
  consultas: readonly ImplementacaoConsultaAparelho[] = [],
  disponivel: DisponivelCliente = () => true,
): ModuloShell<C> {
  return definirModuloShell<C>({
    manifesto: manifest,
    paginas: [
      { id: 'pesquisas', caminho: CAMINHO_PESQUISAS, titulo: 'Pesquisas', navegacao: 'Pesquisas', icone: 'clipboard', ordem: 60, acao: 'pesquisa.responder', perfis: [...PERFIS_RESPONDEM], apps: ['campo', 'gestao'], componente: c.pesquisas },
      { id: 'responder', caminho: CAMINHO_RESPONDER, titulo: 'Responder pesquisa', acao: 'pesquisa.responder', perfis: [...PERFIS_RESPONDEM], apps: ['campo', 'gestao'], componente: c.responder },
    ],
    entidadesSync: ENTIDADES_PESQUISA,
    consultas,
    extensoes: [
      {
        slot: 'visita.etapas_checkout',
        id: 'pesquisa-obrigatoria',
        acao: 'pesquisa.responder',
        apps: ['campo', 'gestao'],
        payload: { rotulo: 'Pesquisa obrigatória', testID: 'checkout-etapa-pesquisa', obrigatoria: true, concluida, componente: c.etapaCheckout } satisfies EtapaCheckout<C>,
      },
      {
        slot: 'cliente.abas',
        id: 'pesquisas',
        acao: 'pesquisa.responder',
        apps: ['campo', 'gestao'],
        payload: { rotulo: 'Pesquisas', testID: 'ficha-pesquisas', componente: c.abaCliente, disponivel } satisfies AbaCliente<C> & { disponivel: DisponivelCliente },
      },
      {
        slot: 'inicio.cards',
        id: 'pesquisas',
        acao: 'pesquisa.responder',
        apps: ['campo', 'gestao'],
        payload: { testID: 'inicio.card-pesquisas', componente: c.cardInicio } satisfies CardInicio<C>,
      },
    ],
  });
}
