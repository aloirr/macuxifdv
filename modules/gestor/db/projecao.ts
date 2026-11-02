/**
 * EstadoProjecao <-> linhas de gestor.projecao_fato / gestor.evento_aplicado (dono: banco-dados; T-0055, 0014).
 * Funções PURAS, sem pg: usadas pelo seed da demo (db/seeds/demo/gestor.ts) e pela fábrica SQL do RepositorioGestor
 * (modules/gestor/api). Formato (docs/banco/gestor.md §2):
 *  - cada chave de cada tabela do EstadoProjecao (menos `processados`) vira UMA linha (tabela, chave, dados);
 *  - `dados` = o valor do fato exatamente como o domain o guarda (objeto com `v`, ou texto em carteira_pendente e
 *    entradas_carteira); `carimbo` = maior `v` do fato (texto "<ms 15 dígitos>|<evento_id>", ordena como texto);
 *  - `ocorrido_em` / `usuario_id` = cópias para recorte por período e por pessoa (podem ser nulos);
 *  - `processados` = os `evento_id` de gestor.evento_aplicado.
 * `montarEstado(achatarEstado(e).fatos, idsDe(e))` devolve um estado igual a `e` (teste em db/testes/gestor.test.ts).
 */
import { estadoInicial, type EstadoProjecao } from '../domain/projecao';
import { TABELAS_PROJECAO, type TabelaProjecao } from './nuvem';

export interface FatoProjecao {
  tabela: TabelaProjecao;
  chave: string;
  carimbo: string;
  dados: unknown;
  ocorrido_em: string | null;
  usuario_id: string | null;
}

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : null);
const texto = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);

/** Maior carimbo `v` do fato (no próprio objeto ou um nível abaixo: pedidos.criado, visitas.checkin/checkout). */
export function carimboDoFato(tabela: TabelaProjecao, dados: unknown): string {
  if (tabela === 'carteira_pendente') return texto(dados) ?? '';
  const o = obj(dados);
  if (!o) return '';
  let maior = texto(o.v) ?? '';
  for (const filho of Object.values(o)) {
    const v = texto(obj(filho)?.v);
    if (v && v > maior) maior = v;
  }
  return maior;
}

/** Instante principal do fato (UTC ISO) para recorte por período; `null` quando o fato não tem um. */
export function instanteDoFato(tabela: TabelaProjecao, dados: unknown): string | null {
  const o = obj(dados);
  switch (tabela) {
    case 'entradas_carteira':
      return texto(dados);
    case 'pedidos':
      return texto(obj(o?.criado)?.criado_em);
    case 'visitas':
      return texto(obj(o?.checkin)?.checkin_em) ?? texto(obj(o?.checkout)?.checkin_em);
    case 'aprovacoes':
      return texto(o?.solicitada_em);
    case 'visitas_loja':
      return texto(o?.checkin_em) ?? texto(o?.concluida_em);
    case 'respostas':
      return texto(o?.respondida_em);
    case 'licoes':
      return texto(o?.concluida_em);
    case 'medalhas':
      return texto(o?.conquistada_em);
    default:
      return null;
  }
}

/** Pessoa dona do fato (vendedor/promotor/usuário) para recorte por escopo; `null` quando não se aplica. */
export function usuarioDoFato(tabela: TabelaProjecao, chave: string, dados: unknown): string | null {
  const o = obj(dados);
  switch (tabela) {
    case 'clientes':
    case 'aprovacoes':
      return texto(o?.vendedor_id);
    case 'entradas_carteira':
      return texto(chave.split('|')[1]);
    case 'pedidos':
      return texto(obj(o?.criado)?.vendedor_id);
    case 'visitas':
      return texto(obj(o?.checkin)?.usuario_id) ?? texto(obj(o?.checkout)?.usuario_id);
    case 'carteira_pendente':
      return null;
    default:
      return texto(o?.usuario_id) ?? texto(o?.promotor_id);
  }
}

/** Achata o estado em fatos (uma linha por tabela/chave), em ordem estável. */
export function achatarEstado(estado: EstadoProjecao): FatoProjecao[] {
  const fatos: FatoProjecao[] = [];
  for (const tabela of TABELAS_PROJECAO) {
    const t = estado[tabela] as Record<string, unknown>;
    for (const chave of Object.keys(t).sort()) {
      const dados = t[chave];
      fatos.push({ tabela, chave, carimbo: carimboDoFato(tabela, dados), dados, ocorrido_em: instanteDoFato(tabela, dados), usuario_id: usuarioDoFato(tabela, chave, dados) });
    }
  }
  return fatos;
}

/** Remonta o estado a partir das linhas (`dados` já como JSON lido do jsonb) e dos `evento_id` aplicados. */
export function montarEstado(fatos: ReadonlyArray<Pick<FatoProjecao, 'tabela' | 'chave' | 'dados'>>, eventosAplicados: Iterable<string>): EstadoProjecao {
  const estado = estadoInicial();
  for (const id of eventosAplicados) estado.processados[id] = true;
  for (const f of fatos) {
    if (!(TABELAS_PROJECAO as readonly string[]).includes(f.tabela)) continue;
    (estado[f.tabela] as Record<string, unknown>)[f.chave] = f.dados;
  }
  return estado;
}
