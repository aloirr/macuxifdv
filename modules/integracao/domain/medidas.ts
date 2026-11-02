/**
 * RN-CORE-19 (medidas por tenant): `unidade` do produto, do preço e de `produto_unidade` é a SIGLA de uma medida cadastrada e
 * ativa no tenant. O dono do cadastro é o Core; o Hub só pergunta (`core.medidas@1`, pelo `ctx.consultar` do consumidor A7) e
 * trata sigla desconhecida como `referencia_ausente` (reprocessável: some quando o BKO cadastra a medida, RN-INT-04).
 * Enquanto a consulta não responde (módulo indisponível ou ainda sem a consulta), a lista é `null`: NÃO se recusa a linha.
 */
import type { Entidade, LinhaErro } from '../contracts';
import { erroReferenciaAusente } from './erros';

export interface SiglaDoRegistro {
  campo: string;
  sigla: string;
}

/**
 * Siglas de medida que o registro (já validado) cita, cada uma com o seu campo. Produto: `unidade` e `embalagem_medida`
 * (a embalagem é opcional); produto_unidade e preço: `unidade`. Preço sem unidade = unidade base do produto (sem conferência).
 */
export function siglasDeMedidaDoRegistro(entidade: Entidade, registro: unknown): SiglaDoRegistro[] {
  if (entidade !== 'produto' && entidade !== 'produto_unidade' && entidade !== 'preco') return [];
  const r = (registro && typeof registro === 'object' ? registro : {}) as Record<string, unknown>;
  const campos = entidade === 'produto' ? ['unidade', 'embalagem_medida'] : ['unidade'];
  const saida: SiglaDoRegistro[] = [];
  for (const campo of campos) {
    const v = r[campo];
    if (typeof v === 'string' && v.trim() !== '') saida.push({ campo, sigla: v.trim().toUpperCase() });
  }
  return saida;
}

export function siglasParaConferir(entidade: Entidade, linhas: readonly { registro: unknown }[]): string[] {
  return [...new Set(linhas.flatMap((l) => siglasDeMedidaDoRegistro(entidade, l.registro).map((s) => s.sigla)))];
}

/**
 * Separa as linhas cuja sigla está entre as medidas ativas das que citam sigla desconhecida/inativa.
 * `ativas === null` = não deu para conferir: tudo é aceito. `inativas` (opcional) = siglas que existem mas estão inativas: a mensagem
 * pede para reativar em vez de cadastrar.
 */
export function verificarMedidas<L extends { indice: number; external_id: string; registro: unknown }>(
  entidade: Entidade,
  linhas: readonly L[],
  ativas: ReadonlySet<string> | null,
  inativas: ReadonlySet<string> = new Set(),
): { aceitas: L[]; erros: LinhaErro[] } {
  if (ativas === null) return { aceitas: [...linhas], erros: [] };
  const aceitas: L[] = [];
  const erros: LinhaErro[] = [];
  for (const l of linhas) {
    const ruins = siglasDeMedidaDoRegistro(entidade, l.registro).filter((s) => !ativas.has(s.sigla));
    if (ruins.length === 0) aceitas.push(l);
    else {
      for (const s of ruins) {
        const e = erroReferenciaAusente(l.indice, l.external_id, s.campo, 'medida');
        const acao = inativas.has(s.sigla)
          ? `Medida '${s.sigla}' está inativa (campo ${s.campo}). Reative em Parâmetros → Produtos e reprocesse.`
          : `Medida '${s.sigla}' não cadastrada (campo ${s.campo}). Cadastre em Parâmetros → Produtos e reprocesse.`;
        erros.push({ ...e, mensagem: acao });
      }
    }
  }
  return { aceitas, erros };
}
