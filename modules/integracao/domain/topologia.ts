/**
 * Topologia dos Conectores na v1 (T-0027; decisões P-6 e P-7 do Alexandre, RN-INT-13): numa empresa (tenant), **cada entidade vem
 * de um único Conector ativo** e **um único Conector recebe os pedidos** aprovados. Filial com ERP próprio vira outra empresa. O
 * Hub recusa o cadastro conflitante no BKO (`verificarTopologiaConectores` → 409 `topologia_conflitante`) e, por defesa, o lote
 * de uma entidade que não é do Conector (`validarEnvelope` com `entidadesDoConector` → 422 `entidade_de_outro_conector`).
 * Motivo: cursor, reconciliação e inativação da carga completa são por (Conector, entidade); dois Conectores na mesma entidade
 * inativariam os registros um do outro.
 */
import type { Entidade, ErroEnvelope } from '../contracts';

export interface ConectorTopologia {
  /** Id interno (uuid) — o mesmo Conector em edição não conflita consigo. */
  id: string;
  /** Identificador do Conector (slug), para a mensagem. */
  conector_id: string;
  ativo: boolean;
  recebe_pedidos: boolean;
  entidades: readonly Entidade[];
}

export type ConflitoTopologia =
  | { codigo: 'entidade_em_outro_conector'; entidade: Entidade; conector_id: string; mensagem: string }
  | { codigo: 'pedidos_em_outro_conector'; conector_id: string; mensagem: string };

export type ResultadoTopologia = { ok: true } | { ok: false; codigo: 'topologia_conflitante'; conflitos: ConflitoTopologia[] };

/**
 * Confere o cadastro (criar, editar ou reativar) contra os outros Conectores ATIVOS da empresa. Conector inativo nunca conflita
 * (desativar sempre pode; reativar confere de novo). Todos os conflitos voltam juntos, em português, com a ação seguinte.
 */
export function verificarTopologiaConectores(proposto: ConectorTopologia, existentes: readonly ConectorTopologia[]): ResultadoTopologia {
  if (!proposto.ativo) return { ok: true };
  const outros = existentes.filter((c) => c.ativo && c.id !== proposto.id);
  const conflitos: ConflitoTopologia[] = [];
  for (const entidade of new Set(proposto.entidades)) {
    const dono = outros.find((c) => c.entidades.includes(entidade));
    if (dono) {
      conflitos.push({
        codigo: 'entidade_em_outro_conector',
        entidade,
        conector_id: dono.conector_id,
        mensagem: `A entidade "${entidade}" já vem do Conector "${dono.conector_id}". Na v1 cada entidade tem um único Conector por empresa: tire "${entidade}" de um dos dois. Filial com ERP próprio é cadastrada como outra empresa.`,
      });
    }
  }
  if (proposto.recebe_pedidos) {
    const dono = outros.find((c) => c.recebe_pedidos);
    if (dono) {
      conflitos.push({
        codigo: 'pedidos_em_outro_conector',
        conector_id: dono.conector_id,
        mensagem: `Os pedidos já vão para o ERP pelo Conector "${dono.conector_id}". Na v1 só um Conector por empresa recebe pedidos: desmarque "recebe pedidos" em um dos dois.`,
      });
    }
  }
  return conflitos.length === 0 ? { ok: true } : { ok: false, codigo: 'topologia_conflitante', conflitos };
}

/** Defesa no `POST /lotes` (e na reconciliação): o lote de entidade que não é deste Conector é recusado inteiro, sem lote criado. */
export function erroEntidadeDeOutroConector(entidade: Entidade, entidadesDoConector: readonly Entidade[]): ErroEnvelope | null {
  if (entidadesDoConector.includes(entidade)) return null;
  return {
    codigo: 'entidade_de_outro_conector',
    campo: 'entidade',
    mensagem: `Este Conector não está cadastrado para a entidade "${entidade}" (na v1 cada entidade vem de um único Conector por empresa). Ajuste em Integração ERP > Conectores ou desative a entidade no arquivo do Conector e rode: conector retomar ${entidade}.`,
  };
}
