/**
 * Estado do Promotor no aparelho (`motor.armazenamentoDoModulo('promotor')`, apagado se o módulo for desativado,
 * RN-CORE-02): visitas de loja abertas/fechadas, o que já foi registrado em cada uma (para a tela mostrar "feito") e o
 * último preço por loja/produto (base da confirmação de variação, RN-PRO-04). Offline-first: a tela lê só daqui e das
 * linhas do pull; a rede só confirma o envio.
 */
import type { ArmazenamentoSync } from '@macuxi/platform-sdk';
import type { VisitaLoja } from '../../contracts';

/** O que foi registrado numa visita: `chave` agrupa (ex.: `share:<categoria>`, `ruptura:<mix>`, `etapa:<item>`). */
export interface RegistroLocal {
  entidade: string;
  id: string;
  chave: string;
  rotulo: string;
}

export interface DadosLoja {
  visitas: Record<string, VisitaLoja>;
  registros: Record<string, RegistroLocal[]>;
  /** `<cliente_id>:<produto_id>` → último preço de prateleira em centavos. */
  precos: Record<string, number>;
}

export const DADOS_LOJA_VAZIOS: DadosLoja = { visitas: {}, registros: {}, precos: {} };

export function criarRepositorioLoja(arm: ArmazenamentoSync) {
  const ler = async <K extends keyof DadosLoja>(k: K): Promise<DadosLoja[K]> => (await arm.ler<DadosLoja[K]>(k)) ?? DADOS_LOJA_VAZIOS[k];
  const alterar = async <K extends keyof DadosLoja>(k: K, fn: (x: DadosLoja[K]) => DadosLoja[K]) => arm.gravar(k, fn(await ler(k)));
  return {
    async carregar(): Promise<DadosLoja> {
      const [visitas, registros, precos] = await Promise.all([ler('visitas'), ler('registros'), ler('precos')]);
      return { visitas, registros, precos };
    },
    guardarVisita: (v: VisitaLoja) => alterar('visitas', (x) => ({ ...x, [v.id]: v })),
    /** Registro novo da visita; o mesmo `chave` substitui o anterior (refez a medição). */
    registrar: (visitaLojaId: string, r: RegistroLocal) =>
      alterar('registros', (x) => ({ ...x, [visitaLojaId]: [...(x[visitaLojaId] ?? []).filter((y) => y.chave !== r.chave), r] })),
    guardarPreco: (clienteId: string, produtoId: string, cents: number) => alterar('precos', (x) => ({ ...x, [`${clienteId}:${produtoId}`]: cents })),
  };
}

export type RepositorioLoja = ReturnType<typeof criarRepositorioLoja>;

/** Visita de loja aberta sobre o check-in do Core informado (a do aparelho), ou `null`. */
export function visitaDaLoja(dados: DadosLoja, visitaCoreId: string | null): VisitaLoja | null {
  if (!visitaCoreId) return null;
  return Object.values(dados.visitas).find((v) => v.visita_id === visitaCoreId) ?? null;
}
