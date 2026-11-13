/**
 * RN-CORE-TAR-01 (destinatários), 03 (pesquisa), 04 (cliente), 10 (inativo) e 12 / RN-PRO-01 (promotor) — desenho
 * `docs/desenho/tarefas-consultor.md` §6 e §8. Funções puras; a API chama na criação, com os usuários visíveis de quem cria
 * (`usuariosVisiveis`, RN-CORE-04) como estão naquele momento. A lista sai pronta e é gravada: quem entra na equipe depois não
 * recebe e quem sai continua com a tarefa (D2). Cada destinatário conclui a sua (D3).
 */
import type { Perfil } from '@macuxi/platform-sdk';
import { ERROS_TAREFA, TAREFA_DESTINATARIOS_MAX, type DestinoTarefa, type TipoTarefa } from '../../contracts/tarefa';

/** Usuário do escopo de quem cria. `perfil` = perfil padrão (o perfil derivado já resolvido para a base). */
export interface CandidatoDestinatario {
  id: string;
  perfil: Perfil;
  ativo: boolean;
  equipe_id: string | null;
}

export interface EntradaDestinatarios {
  destino: DestinoTarefa;
  tipo: TipoTarefa;
  visiveis: readonly CandidatoDestinatario[];
  /** Tarefa com cliente: ids de quem tem o cliente na carteira agora. `null` = tarefa sem cliente. */
  com_cliente_na_carteira: ReadonlySet<string> | null;
  /** Tarefa de pesquisa: ids de quem tem a Pesquisa efetiva e está no público do questionário. Ausente = ninguém. */
  podem_responder_pesquisa?: ReadonlySet<string>;
}

export type ResultadoDestinatarios =
  | { ok: true; usuario_ids: string[] }
  | {
      ok: false;
      status: 403 | 422;
      codigo: (typeof ERROS_TAREFA)[keyof typeof ERROS_TAREFA];
      /** Quem causou a recusa (a tela mostra os nomes); vazio quando a recusa é do conjunto. */
      usuario_ids: string[];
    };

/**
 * RN-PRO-01: se o tipo envolve pedido. Nenhum tipo de hoje envolve; o `Record` obriga quem criar um tipo novo a decidir.
 * Vale pelo PERFIL, não pelo módulo (doc 03 §1).
 */
export const TIPO_ENVOLVE_PEDIDO: Readonly<Record<TipoTarefa, boolean>> = Object.freeze({ simples: false, foto: false, pesquisa: false });

export function tipoPermitidoParaPerfil(tipo: TipoTarefa, perfil: Perfil, envolvePedido: Readonly<Record<TipoTarefa, boolean>> = TIPO_ENVOLVE_PEDIDO): boolean {
  return !(perfil === 'promotor' && envolvePedido[tipo]);
}

const ehConsultor = (c: CandidatoDestinatario) => c.perfil === 'vendedor' || c.perfil === 'promotor';
const ordenar = (ids: Iterable<string>) => [...new Set(ids)].sort();
const recusa = (status: 403 | 422, codigo: (typeof ERROS_TAREFA)[keyof typeof ERROS_TAREFA], ids: Iterable<string>): ResultadoDestinatarios => ({
  ok: false,
  status,
  codigo,
  usuario_ids: ordenar(ids),
});

/**
 * Lista final de destinatários. Pessoas escolhidas uma a uma: cada problema recusa a criação com quem o causou. Equipe e
 * Todos: entram os consultores ativos (da equipe) que podem receber o tipo e que têm o cliente, quando houver; a pesquisa
 * continua exigindo que todos possam responder (RN-CORE-TAR-03).
 */
export function expandirDestinatarios(e: EntradaDestinatarios, envolvePedido: Readonly<Record<TipoTarefa, boolean>> = TIPO_ENVOLVE_PEDIDO): ResultadoDestinatarios {
  const porId = new Map(e.visiveis.map((c) => [c.id, c] as const));
  const podeTipo = (c: CandidatoDestinatario) => tipoPermitidoParaPerfil(e.tipo, c.perfil, envolvePedido);
  const temCliente = (c: CandidatoDestinatario) => e.com_cliente_na_carteira === null || e.com_cliente_na_carteira.has(c.id);

  let escolhidos: CandidatoDestinatario[];
  if (e.destino.alvo === 'usuarios') {
    const ids = ordenar(e.destino.usuario_ids);
    const fora = ids.filter((id) => !porId.has(id));
    if (fora.length) return recusa(403, ERROS_TAREFA.foraDoEscopo, fora);
    escolhidos = ids.map((id) => porId.get(id) as CandidatoDestinatario);
    const checagens: [403 | 422, (typeof ERROS_TAREFA)[keyof typeof ERROS_TAREFA], (c: CandidatoDestinatario) => boolean][] = [
      [422, ERROS_TAREFA.inativo, (c) => c.ativo],
      [422, ERROS_TAREFA.destinatarios, ehConsultor],
      [403, ERROS_TAREFA.promotor, podeTipo],
      [422, ERROS_TAREFA.cliente, temCliente],
    ];
    for (const [status, codigo, passa] of checagens) {
      const falham = escolhidos.filter((c) => !passa(c));
      if (falham.length) return recusa(status, codigo, falham.map((c) => c.id));
    }
  } else {
    const destino = e.destino;
    const daEquipe = (c: CandidatoDestinatario) => destino.alvo === 'todos' || c.equipe_id === destino.equipe_id;
    escolhidos = e.visiveis.filter((c) => daEquipe(c) && c.ativo && ehConsultor(c) && podeTipo(c) && temCliente(c));
  }

  if (e.tipo === 'pesquisa') {
    const naoPodem = escolhidos.filter((c) => !e.podem_responder_pesquisa?.has(c.id));
    if (naoPodem.length) return recusa(422, ERROS_TAREFA.pesquisa, naoPodem.map((c) => c.id));
  }
  if (escolhidos.length === 0) return recusa(422, ERROS_TAREFA.destinatarioVazio, []);
  if (escolhidos.length > TAREFA_DESTINATARIOS_MAX) return recusa(422, ERROS_TAREFA.destinatarios, []);
  return { ok: true, usuario_ids: ordenar(escolhidos.map((c) => c.id)) };
}
