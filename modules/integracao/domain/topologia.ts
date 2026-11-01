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

export type ResultadoTopologia =
  | { ok: true }
  | {
      ok: false;
      codigo: 'topologia_conflitante';
      /** Resumo para o topo da tela (corpo do 409): qual Conector já recebe o quê e o que informar no cadastro do novo. */
      mensagem: string;
      conflitos: ConflitoTopologia[];
      /** Entidades pedidas que nenhum outro Conector ativo recebe (sugestão para a lista do Conector em cadastro). */
      entidades_livres: Entidade[];
    };

const aspas = (xs: readonly string[]) => xs.map((x) => `"${x}"`);
const listar = (xs: readonly string[]): string => {
  const q = aspas(xs);
  return q.length <= 1 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} e ${q[q.length - 1]}`;
};

/**
 * Confere o cadastro (criar, editar ou reativar) contra os outros Conectores ATIVOS da empresa. Conector inativo nunca conflita
 * (desativar sempre pode; reativar confere de novo). Todos os conflitos voltam juntos, em português, com a ação seguinte: a
 * mensagem diz **qual Conector já recebe** cada entidade e que é preciso **informar a lista de entidades** do Conector em cadastro
 * (sem a lista, o cadastro leva as 8 — `ConectorCriar.entidades` — e conflita com qualquer Conector que já exista). T-0031.
 */
export function verificarTopologiaConectores(proposto: ConectorTopologia, existentes: readonly ConectorTopologia[]): ResultadoTopologia {
  if (!proposto.ativo) return { ok: true };
  const outros = existentes.filter((c) => c.ativo && c.id !== proposto.id);
  const conflitos: ConflitoTopologia[] = [];
  const livres: Entidade[] = [];
  const porDono = new Map<string, Entidade[]>();
  for (const entidade of new Set(proposto.entidades)) {
    const dono = outros.find((c) => c.entidades.includes(entidade));
    if (!dono) {
      livres.push(entidade);
      continue;
    }
    porDono.set(dono.conector_id, [...(porDono.get(dono.conector_id) ?? []), entidade]);
    conflitos.push({
      codigo: 'entidade_em_outro_conector',
      entidade,
      conector_id: dono.conector_id,
      mensagem: `A entidade "${entidade}" já é recebida pelo Conector "${dono.conector_id}". Na v1 cada entidade vem de um único Conector por empresa: informe a lista de entidades do Conector "${proposto.conector_id}" sem "${entidade}" (ou tire "${entidade}" do Conector "${dono.conector_id}" antes). Filial com ERP próprio é cadastrada como outra empresa.`,
    });
  }
  let donoPedidos: string | null = null;
  if (proposto.recebe_pedidos) {
    const dono = outros.find((c) => c.recebe_pedidos);
    if (dono) {
      donoPedidos = dono.conector_id;
      conflitos.push({
        codigo: 'pedidos_em_outro_conector',
        conector_id: dono.conector_id,
        mensagem: `Os pedidos já vão para o ERP pelo Conector "${dono.conector_id}". Na v1 só um Conector por empresa recebe pedidos: desmarque "recebe pedidos" no Conector "${proposto.conector_id}" (ou no "${dono.conector_id}" antes).`,
      });
    }
  }
  if (conflitos.length === 0) return { ok: true };

  const partes: string[] = [];
  for (const [dono, ents] of porDono) {
    partes.push(`${ents.length > 1 ? 'as entidades' : 'a entidade'} ${listar(ents)} já ${ents.length > 1 ? 'são recebidas' : 'é recebida'} pelo Conector "${dono}"`);
  }
  if (donoPedidos) partes.push(`os pedidos já vão para o ERP pelo Conector "${donoPedidos}"`);
  const acoes: string[] = [];
  if (porDono.size > 0) {
    acoes.push(
      livres.length > 0
        ? `informe a lista de entidades do Conector "${proposto.conector_id}" só com as que ele alimenta (livres: ${listar(livres)}) — sem a lista, o cadastro leva as 8 entidades`
        : `informe a lista de entidades do Conector "${proposto.conector_id}" — todas as escolhidas já têm Conector (sem a lista, o cadastro leva as 8); se é uma filial com ERP próprio, cadastre como outra empresa`,
    );
  }
  if (donoPedidos) acoes.push('desmarque "recebe pedidos"');
  const mensagem = `O Conector "${proposto.conector_id}" não foi salvo: ${partes.join('; ')}. Na v1 cada entidade vem de um único Conector por empresa e só um recebe pedidos. Para salvar, ${acoes.join(' e ')}.`;
  return { ok: false, codigo: 'topologia_conflitante', mensagem, conflitos, entidades_livres: livres };
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
