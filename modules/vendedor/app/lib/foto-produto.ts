/**
 * T-0148: foto do produto na busca do pedido, pela consulta `catalogo.foto_produto@1` (só via contrato do Catálogo).
 * `abrir:false` só diz quem tem foto (sem rede); `abrir:true` baixa, guarda no cache e devolve `file://`, ou `uri` nula sem sinal.
 */
export const MENSAGEM_SEM_SINAL_FOTO = 'Sem sinal para baixar a foto. Tente de novo com internet.';

interface SaidaFoto {
  itens: ReadonlyArray<{ produto_id: string; tem_foto: boolean; uri: string | null }>;
}
type Consultar = (entrada: { produto_ids: string[]; abrir: boolean }) => Promise<SaidaFoto>;

/** Quem tem foto entre os ids (sem rede). Falha ou aparelho sem a leitura = ninguém tem (a busca segue sem o ícone). */
export async function idsComFoto(consultar: Consultar, ids: readonly string[]): Promise<Set<string>> {
  const unicos = [...new Set(ids)].slice(0, 200);
  if (unicos.length === 0) return new Set();
  try {
    const r = await consultar({ produto_ids: unicos, abrir: false });
    return new Set(r.itens.filter((i) => i.tem_foto).map((i) => i.produto_id));
  } catch {
    return new Set();
  }
}

export type ResultadoFoto = { tipo: 'foto'; uri: string } | { tipo: 'aviso'; texto: string };

/** Abre a foto de um produto: `foto` com o endereço local ou `aviso` curto (sem sinal e sem cache, ou falha). */
export async function abrirFotoDoProduto(consultar: Consultar, id: string): Promise<ResultadoFoto> {
  try {
    const r = await consultar({ produto_ids: [id], abrir: true });
    const uri = r.itens.find((i) => i.produto_id === id)?.uri ?? null;
    return uri ? { tipo: 'foto', uri } : { tipo: 'aviso', texto: MENSAGEM_SEM_SINAL_FOTO };
  } catch {
    return { tipo: 'aviso', texto: MENSAGEM_SEM_SINAL_FOTO };
  }
}
