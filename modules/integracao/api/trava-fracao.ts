/**
 * ADR 0076 D6: aplica a trava da quantidade fracionária nas rotas do Hub (lote e retorno). Fração inválida (mais de 4 casas) é
 * sempre 422 `quantidade_fracionaria_invalida`; fração válida com a trava fechada é 422 `quantidade_fracionaria_bloqueada`.
 * "Fechada" também vale quando a rota não tem `ctx.versaoApp` (porta ainda não injetada no contexto do Conector).
 */
import { type ContextoConector, ErroConector, fracaoLiberadaNaPorta } from '@macuxi/platform-sdk';
import type { ResultadoFracao } from '../domain';

type ContextoComVersao = Pick<ContextoConector, 'agora' | 'versaoApp'>;

export async function exigirFracaoLiberada(ctx: ContextoComVersao, avaliar: (liberada: boolean) => ResultadoFracao): Promise<void> {
  // só consulta as versões publicadas quando há fração válida de verdade (o caminho comum, sem fração, não paga a consulta)
  let r = avaliar(true);
  if (r.ok) {
    const fechada = avaliar(false);
    if (fechada.ok) return;
    if (await fracaoLiberadaNaPorta(ctx.versaoApp, ctx.agora())) return;
    r = fechada;
  }
  if (!r.ok) throw new ErroConector(422, { codigo: r.codigo, mensagem: r.mensagem, erros: r.erros });
}
