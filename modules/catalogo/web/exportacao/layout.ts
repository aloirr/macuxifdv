/** Layout do catálogo exportado (RF-CAT-09): funções puras, sem DOM. */
import { NO_SEM_LINHA } from '../../domain/hierarquia';
import { MAX_APLICACAO, MAX_OFERECE_JUNTO, MAX_REFERENCIAS, type DadosExportacao } from './formato';

export const COLUNAS = ['Código', 'Aplicação', 'Oferece junto', 'Equivale a'] as const;
export const SEM_SISTEMA = 'Sem sistema';
export const SEM_GRUPO = 'Sem grupo';
export const SEM_LINHA = 'Sem linha';

export interface LinhaCatalogo {
  codigo: string;
  aplicacao: string;
  oferece_junto: string[];
  equivale_a: string[];
}
export interface SecaoCatalogo {
  sistema: string;
  grupo: string;
  linha: string;
  itens: LinhaCatalogo[];
}
export type Catalogo = SecaoCatalogo[];

const cmp = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true });
/** Nome vazio vai para o fim. */
const cmpNulos = (a: string, b: string, vazio: string) => (a === vazio ? (b === vazio ? 0 : 1) : b === vazio ? -1 : cmp(a, b));
const nome = (v: string | null, vazio: string) => v?.trim() || vazio;

export function sistemasDisponiveis(dados: DadosExportacao): string[] {
  const s = new Set(dados.produtos.map((p) => nome(p.hierarquia.sistema, SEM_SISTEMA)));
  return [...s].sort((a, b) => cmpNulos(a, b, SEM_SISTEMA));
}

/** Recorte da exportação: o nível aberto na hierarquia (RF-CAT-09 "exportação por sistema/linha"); vazio = catálogo inteiro. */
export interface EscopoExportacao {
  sistema?: string;
  grupo?: string;
  linha?: string;
}

/** Escopo do nível aberto: a trilha dá sistema › grupo › linha (os que existirem); "Sem classificação" = produtos sem sistema. */
export function escopoDoNivel(h: { trilha: readonly { nome: string }[]; no: string | null } | undefined): EscopoExportacao {
  if (!h) return {};
  if (h.no === NO_SEM_LINHA) return { sistema: SEM_SISTEMA };
  const [sistema, grupo, linha] = h.trilha.map((n) => n.nome);
  return { ...(sistema ? { sistema } : {}), ...(grupo ? { grupo } : {}), ...(linha ? { linha } : {}) };
}

/** "Freios › Pastilhas › Cerâmica" (só o que existe); `null` = catálogo inteiro. */
export const rotuloDoEscopo = (e: EscopoExportacao): string | null => [e.sistema, e.grupo, e.linha].filter(Boolean).join(' › ') || null;

/** Coluna "Caminho" da busca no BKO: "Sistema › Grupo › Linha", só com o que o produto tem; sem hierarquia, "Sem classificação". */
export function caminhoDoProduto(h: { sistema: string | null; grupo: string | null; linha: string | null } | undefined): string {
  return [h?.sistema, h?.grupo, h?.linha].map((x) => x?.trim()).filter(Boolean).join(' › ') || 'Sem classificação';
}

export function montarCatalogo(dados: DadosExportacao, opcoes: EscopoExportacao = {}): Catalogo {
  const porId = new Map(dados.produtos.map((p) => [p.id, p]));
  const marcas = new Map(dados.marcas.map((m) => [m.id, m.nome]));
  const secoes = new Map<string, SecaoCatalogo>();
  for (const p of dados.produtos) {
    const sistema = nome(p.hierarquia.sistema, SEM_SISTEMA);
    if (opcoes.sistema && sistema !== opcoes.sistema) continue;
    const grupo = nome(p.hierarquia.grupo, SEM_GRUPO);
    if (opcoes.grupo && grupo !== opcoes.grupo) continue;
    const linha = nome(p.hierarquia.linha, SEM_LINHA);
    if (opcoes.linha && linha !== opcoes.linha) continue;
    const chave = JSON.stringify([sistema, grupo, linha]);
    let sec = secoes.get(chave);
    if (!sec) secoes.set(chave, (sec = { sistema, grupo, linha, itens: [] }));
    sec.itens.push({
      codigo: p.codigo,
      aplicacao: (p.aplicacao ?? '').slice(0, MAX_APLICACAO),
      oferece_junto: p.oferece_junto
        .filter((id) => id !== p.id)
        .map((id) => porId.get(id)?.codigo)
        .filter((c): c is string => !!c)
        .slice(0, MAX_OFERECE_JUNTO),
      equivale_a: p.referencias.slice(0, MAX_REFERENCIAS).map((r) => {
        // marca ativa do cadastro de marcas do Catálogo; senão o retrato gravado na referência; senão só o código (RN-CAT-09)
        const m = marcas.get(r.marca_id) ?? r.marca_nome?.trim();
        return m ? `${m} ${r.codigo}` : r.codigo;
      }),
    });
  }
  const lista = [...secoes.values()];
  for (const s of lista) s.itens.sort((a, b) => cmp(a.codigo, b.codigo));
  return lista.sort((a, b) => cmpNulos(a.sistema, b.sistema, SEM_SISTEMA) || cmpNulos(a.grupo, b.grupo, SEM_GRUPO) || cmpNulos(a.linha, b.linha, SEM_LINHA));
}

export interface LinhaSumario {
  sistema: string;
  grupo: string;
  linha: string;
  itens: number;
}
export function sumario(catalogo: Catalogo): { linhas: LinhaSumario[]; total: number } {
  const linhas = catalogo.map((s) => ({ sistema: s.sistema, grupo: s.grupo, linha: s.linha, itens: s.itens.length }));
  return { linhas, total: linhas.reduce((n, l) => n + l.itens, 0) };
}
