/**
 * Adaptadores de API por ERP (F4a). SAP B1 e Sankhya primeiro (D2); Protheus REST e Senior ficam para depois da confirmação com o
 * primeiro cliente de cada um (desenho §3: meio padrão deles é o Conector com views).
 */
import { MODELOS_ERP, type ModeloErp, type ModeloErpResumo } from '../../contracts';
import { adaptadorSankhya } from './sankhya';
import { adaptadorSapB1 } from './sap-b1';
import type { AdaptadorErp } from './tipos';

export * from './conversao';
export * from './tipos';
export { adaptadorSankhya, adaptadorSapB1 };

export const ADAPTADORES_ERP: Readonly<Partial<Record<ModeloErp, AdaptadorErp>>> = { sap_b1: adaptadorSapB1, sankhya: adaptadorSankhya };

/** ERPs do contrato que ainda não têm adaptador de API (a busca não liga para eles; o meio é o Conector com views). */
export const MODELOS_SEM_ADAPTADOR: readonly ModeloErp[] = MODELOS_ERP.filter((m) => !(m in ADAPTADORES_ERP));

export function adaptadorDoErp(erp: string): AdaptadorErp | null {
  return (ADAPTADORES_ERP as Record<string, AdaptadorErp | undefined>)[erp] ?? null;
}

export function resumoDoModelo(a: AdaptadorErp): ModeloErpResumo {
  return {
    erp: a.erp,
    situacao: a.situacao,
    entidades_suportadas: [...a.entidadesSuportadas],
    entidades_sem_data_de_alteracao: a.entidadesSuportadas.filter((e) => !a.suportaDelta(e)),
    parametros: a.parametros.map((p) => ({ chave: p.chave, obrigatorio: p.obrigatorio, descricao: p.descricao })),
    pedido_pela_api: a.pedido !== null,
  };
}
