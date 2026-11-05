/**
 * RN-CORE-12 / RN-CORE-14 revalidadas na API (T-0039). Função pura sobre `prepararCheckoutVisita`: o servidor não confia
 * nas etapas que o aparelho diz ter cumprido; usa a verificação de cada módulo ativo (contrato `etapas-checkout`).
 * Códigos de recusa: `MOTIVO_INVALIDO` (motivo fora da lista ativa do tenant), `RN-CORE-14` (cliente fechado), `RN-CORE-12`.
 */
import { prepararCheckoutVisita, type EtapaCheckoutDaVisita, type RegistroEtapaCheckout, type ResultadoCheckout } from './checkout';

/** Etapa de um módulo ativo, como o servidor a verificou (espelha o contrato `etapas-checkout` de `contracts`). */
export interface VerificacaoEtapaServidor {
  modulo: string;
  etapa: string;
  rotulo: string;
  obrigatoria: boolean;
  concluida: boolean;
}

export interface EntradaCheckoutNoServidor {
  resultadoInformado: ResultadoCheckout;
  vendedorEfetivo: boolean;
  motivoId: string | null;
  motivoTexto: string | null;
  /** Linha de `core.motivo` do tenant (RLS) para `motivoId`; `null` = não existe neste tenant. */
  motivo: { tipo: 'nao_venda' | 'cliente_fechado' | 'fora_do_raio'; ativo: boolean; /** Quando foi desativado (ISO); ausente/null = sem data conhecida. */ desativadoEm?: string | null } | null;
  /** Horário do checkout informado pelo aparelho (ISO); com `desativadoEm`, decide se o motivo ainda valia (checkout offline). */
  checkoutEm?: string | null;
  fotoFachada: boolean;
  temPedido: boolean;
  verificacoes: readonly VerificacaoEtapaServidor[];
}

export type CodigoRecusaCheckout = 'MOTIVO_INVALIDO' | 'RN-CORE-12' | 'RN-CORE-14';

export interface AvaliacaoCheckoutNoServidor {
  pode: boolean;
  codigo: CodigoRecusaCheckout | null;
  pendencias: string[];
  etapasRegistro: RegistroEtapaCheckout[];
}

/**
 * RN-CORE-12: motivo do próprio tenant vale se ativo, ou se estava ativo no checkout (checkout offline antes da desativação).
 * Sem data de desativação, motivo desativado do tenant é aceito; inexistente/de outro tenant (`null`) é recusado.
 */
function motivoValeNoCheckout(e: EntradaCheckoutNoServidor): boolean {
  const m = e.motivo;
  if (!m) return false;
  if (!m.desativadoEm) return true;
  const des = Date.parse(m.desativadoEm);
  const chk = e.checkoutEm ? Date.parse(e.checkoutEm) : NaN;
  if (Number.isNaN(des)) return true;
  return !Number.isNaN(chk) && chk <= des;
}

export function avaliarCheckoutNoServidor(e: EntradaCheckoutNoServidor): AvaliacaoCheckoutNoServidor {
  if (e.motivoId && !motivoValeNoCheckout(e)) return { pode: false, codigo: 'MOTIVO_INVALIDO', pendencias: ['motivo'], etapasRegistro: [] };
  const etapas: EtapaCheckoutDaVisita[] = e.verificacoes.map((v) => ({ modulo: v.modulo, id: v.etapa, rotulo: v.rotulo, obrigatoria: v.obrigatoria, concluida: v.concluida }));
  const textoLivre = Boolean(e.motivoTexto?.trim());
  const prep = prepararCheckoutVisita({
    escolha: e.resultadoInformado === 'cliente_fechado' ? null : e.resultadoInformado,
    vendedorEfetivo: e.vendedorEfetivo,
    // texto livre sem item da lista conta como motivo de não venda (compatibilidade com o contrato do push)
    motivo: e.motivo ? { tipo: e.motivo.tipo } : textoLivre ? { tipo: 'nao_venda' } : null,
    fotoFachada: e.fotoFachada,
    temPedido: e.temPedido,
    etapas,
  });
  // cliente fechado no cadastro do tenant manda: outro resultado informado = aparelho incoerente (fugiria das etapas)
  const incoerente = e.resultadoInformado !== 'cliente_fechado' && prep.resultado === 'cliente_fechado';
  const pendencias = incoerente ? ['resultado'] : prep.pendencias;
  const pode = prep.pode && !incoerente;
  const codigo: CodigoRecusaCheckout | null = pode ? null : e.resultadoInformado === 'cliente_fechado' ? 'RN-CORE-14' : 'RN-CORE-12';
  return { pode, codigo, pendencias, etapasRegistro: pode ? prep.etapasRegistro : [] };
}
