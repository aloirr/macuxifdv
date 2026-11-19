/**
 * Pontos do dia gravados neste aparelho (T-0156; desenho `tracking.md` §3.4): a tarefa `macuxi-trajeto` (engenheiro-apps) grava no SQLite do
 * aparelho e o shell entrega a leitura aqui, no mesmo padrão de `definirCapturaFoto`. "Meu trajeto" de hoje e o km parcial leem por esta porta
 * e funcionam sem sinal. Sem o shell, a porta devolve vazio e a tela busca o dia no servidor.
 */
import type { PontoDoTrajeto } from '../../contracts';

export type LeitorDePontosLocais = (data: string, fuso: string) => Promise<PontoDoTrajeto[]>;

let leitor: LeitorDePontosLocais | null = null;

export function definirPontosLocaisDoDia(l: LeitorDePontosLocais | null): void {
  leitor = l;
}

export async function pontosLocaisDoDia(data: string, fuso: string): Promise<PontoDoTrajeto[] | null> {
  return leitor ? leitor(data, fuso) : null;
}
