/**
 * Extras do cartão de produto (RF-CAT-09, T-0142): o que a lista rica mostra além do cadastro — aplicação (2 linhas),
 * "Equivale a" e etiquetas — vindo do conteúdo e das referências do pull (tipos do contrato). O cartão é um só
 * (`telas/comum.tsx`, `CartaoProduto`): na busca traz o trecho destacado (RN-CAT-12, RN-CAT-09); sem busca, estes extras.
 * Funções puras + a leitura do aparelho (offline, por `produto_id`, só dos itens que vão para a tela).
 */
import type { LinhaSync } from '@macuxi/platform-sdk';
import type { ProdutoConteudoSync, ProdutoReferenciaSync, Referencia } from '../../contracts';
import { nomeMarcaDaReferencia } from '../../domain/marcas';
import { contagem } from './apresentacao';
import type { LeitorLocal } from './local';

/** RN-CAT-09: corte defensivo; o contrato já limita a 3 referências por produto. */
export const MAXIMO_REFERENCIAS = 3;
/** Itens a mais por toque em "Mostrar mais". */
export const PASSO_MOSTRAR_MAIS = 100;

export interface ExtrasProduto {
  aplicacao: string | null;
  /** Já com o nome da marca resolvido (`marca_nome`, RN-CAT-09). */
  referencias: Referencia[];
  etiquetas: string[];
}
export const SEM_EXTRAS: ExtrasProduto = { aplicacao: null, referencias: [], etiquetas: [] };

const vivo = <L extends { deleted_at: string | null }>(l: L) => !l.deleted_at;

/**
 * Monta os extras de UM produto a partir das linhas do pull (`produto_conteudo`, `produto_referencia`). Referência sem
 * retrato do nome da marca fica de fora (RN-CAT-09, mesma regra da ficha); conteúdo removido = vazio.
 */
export function montarExtras(conteudo: Pick<ProdutoConteudoSync, 'aplicacao' | 'etiquetas' | 'deleted_at'> | undefined, referencias: readonly ProdutoReferenciaSync[]): ExtrasProduto {
  const c = conteudo && vivo(conteudo) ? conteudo : undefined;
  return {
    aplicacao: c?.aplicacao?.trim() || null,
    referencias: referencias
      .filter(vivo)
      .sort((a, b) => a.ordem - b.ordem)
      .flatMap((r) => {
        const marca_nome = nomeMarcaDaReferencia(r.marca_id, r.marca_nome, new Map());
        return marca_nome === null ? [] : [{ marca_id: r.marca_id, marca_nome, codigo: r.codigo }];
      }),
    etiquetas: etiquetasDoItem(c?.etiquetas ?? []),
  };
}

/** "Equivale a: CB 3401" ou, com várias, "Equivale a: Bosch CB 3401 · NGK X9"; sem referência = `null` (a linha some). RN-CAT-09. */
export function textoEquivale(refs: readonly Pick<Referencia, 'marca_nome' | 'codigo'>[]): string | null {
  const r = refs.slice(0, MAXIMO_REFERENCIAS);
  return r.length === 0 ? null : `Equivale a: ${r.map((x) => `${x.marca_nome} ${x.codigo}`).join(' · ')}`;
}

/** Etiquetas sem repetição (ignora maiúsculas); tamanho e quantidade (até 4 de 20) o contrato já valida. */
export function etiquetasDoItem(etiquetas: readonly string[]): string[] {
  const vistas = new Set<string>();
  return etiquetas.map((e) => e.trim()).filter((t) => t !== '' && !vistas.has(t.toLowerCase()) && !!vistas.add(t.toLowerCase()));
}

/** Textos do botão "Mostrar mais" (RF-CAT-09): número com separador de milhar e plural certo. */
export function textosMostrarMais(restantes: number): { rotulo: string; rotuloAcessivel: string } {
  const r = contagem(restantes, 'restante', 'restantes');
  return { rotulo: `Mostrar mais (${r})`, rotuloAcessivel: `Mostrar mais produtos, ${r}` };
}

/** Lê do aparelho (sem rede) os extras dos produtos que vão para a tela; sem `linhasPorCampo` (leitor dos testes), lê tudo e filtra. */
export async function extrasLocais(leitor: LeitorLocal, ids: readonly string[]): Promise<Map<string, ExtrasProduto>> {
  if (ids.length === 0) return new Map();
  const pedidos = new Set(ids);
  const doProduto = async <L extends LinhaSync & { produto_id: string }>(entidade: string) => {
    const linhas = leitor.linhasPorCampo ? await leitor.linhasPorCampo<L>(entidade, 'produto_id', ids) : await leitor.linhas<L>(entidade);
    return linhas.filter((l) => !l.deleted_at && pedidos.has(l.produto_id));
  };
  const [conteudos, referencias] = await Promise.all([doProduto<ProdutoConteudoSync & LinhaSync>('produto_conteudo'), doProduto<ProdutoReferenciaSync & LinhaSync>('produto_referencia')]);
  const refs = new Map<string, ProdutoReferenciaSync[]>();
  for (const r of referencias) refs.set(r.produto_id, [...(refs.get(r.produto_id) ?? []), r]);
  const cont = new Map(conteudos.map((c) => [c.produto_id, c]));
  return new Map(ids.map((id) => [id, montarExtras(cont.get(id), refs.get(id) ?? [])]));
}
