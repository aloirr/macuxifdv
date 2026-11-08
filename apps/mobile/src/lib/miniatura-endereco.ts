/**
 * Endereço das miniaturas do catálogo guardadas no armazenamento da plataforma (T-0097 (a); ADR 0010). O pull traz só a
 * referência relativa e autenticada (`/v1/arquivos/<uuid>`); a tela do Catálogo pede ao shell um endereço que a `Image` abra.
 * O shell baixa os bytes UMA vez com o token da sessão (o `Image` do RN não manda cabeçalho), confere o teto (`bytes_max`),
 * guarda no cache do app e devolve o `file://`. Já baixada (mesmo arquivo e mesma versão) = devolve o arquivo sem rede.
 * Sem sinal, sem sessão, fora do teto ou em falha: `null` (a caixa fica vazia e a lista segue). Puro: a rede e o disco
 * entram por parâmetro (`services/miniaturas.ts`).
 */

/** O que a tela manda (subconjunto de `MiniaturaProduto` do contrato do Catálogo). */
export interface ReferenciaMiniatura {
  arquivo_id?: string | null;
  bytes_max: number;
  versao: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROTA_RE = new RegExp(`^/v1/arquivos/(${UUID})$`, 'i');

/** Id do arquivo da rota de arquivos da plataforma; qualquer outro endereço (externo, outra rota) = `null`. */
export function arquivoDaMiniatura(url: string): string | null {
  const m = ROTA_RE.exec(url.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/** Nome do arquivo no cache: id + versão (a foto trocada tem outra versão e outro nome). Só caracteres seguros. */
export function nomeNoCache(arquivoId: string, versao: string): string {
  const v = versao.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64) || 'v';
  return `${arquivoId}-${v}.jpg`;
}

export interface DependenciasResolvedor {
  /** Endereço já gravado no cache com este nome, ou `null`. */
  noCache(nome: string): string | null;
  /** Há sinal e sessão? */
  online(): boolean;
  /** Bytes da rota autenticada até `maxBytes` (`null` = acima do teto ou vazio). Erro = falha (não guarda nada). */
  baixar(rota: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Grava no cache e devolve o endereço `file://`. */
  gravar(nome: string, bytes: Uint8Array): string;
}

/**
 * Resolvedor para `definirResolvedorMiniatura` do Catálogo. Pedidos repetidos do mesmo arquivo enquanto o primeiro baixa
 * esperam o mesmo download (a lista mede de 350 em 350 ms).
 */
export function criarResolvedorMiniatura(d: DependenciasResolvedor): (url: string, m: ReferenciaMiniatura) => Promise<string | null> {
  const emAndamento = new Map<string, Promise<string | null>>();
  return async (url, m) => {
    const id = arquivoDaMiniatura(url);
    if (!id || (m.arquivo_id && m.arquivo_id.toLowerCase() !== id)) return null;
    const nome = nomeNoCache(id, m.versao);
    const pronto = d.noCache(nome);
    if (pronto) return pronto;
    if (!d.online()) return null;
    const atual = emAndamento.get(nome);
    if (atual) return atual;
    const tarefa = (async () => {
      try {
        const bytes = await d.baixar(`/arquivos/${id}`, m.bytes_max);
        return bytes ? d.gravar(nome, bytes) : null;
      } catch {
        return null;
      } finally {
        emAndamento.delete(nome);
      }
    })();
    emAndamento.set(nome, tarefa);
    return tarefa;
  };
}
