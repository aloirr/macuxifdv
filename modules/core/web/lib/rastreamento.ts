/**
 * Parâmetros › Rastreamento no BKO (T-0156; desenho `tracking.md` §4.1; RN-CORE-13): o texto digitado vira o `ParametrosRastreamento`
 * do contrato. Função pura; a API revalida (`validarParametrosRastreamento`). Erro só ao salvar, no texto do campo, em português.
 */
import { minutoDoTextoHora, textoDoMinuto, type Expediente, type FrequenciaRastreamento } from '../../contracts';

/** Segunda a domingo, na ordem da semana de trabalho; a chave é a do contrato ('0' = domingo). */
export const DIAS_EXPEDIENTE: ReadonlyArray<{ chave: keyof Expediente; rotulo: string }> = [
  { chave: '1', rotulo: 'Segunda' },
  { chave: '2', rotulo: 'Terça' },
  { chave: '3', rotulo: 'Quarta' },
  { chave: '4', rotulo: 'Quinta' },
  { chave: '5', rotulo: 'Sexta' },
  { chave: '6', rotulo: 'Sábado' },
  { chave: '0', rotulo: 'Domingo' },
];

export interface TextoFaixa {
  inicio: string;
  fim: string;
}
/** Até 2 faixas por dia; as duas em branco = sem expediente. */
export type TextosExpediente = Record<keyof Expediente, [TextoFaixa, TextoFaixa]>;
export type ErrosExpediente = Partial<Record<string, string>>;

const VAZIA: TextoFaixa = { inicio: '', fim: '' };

export function textosDoExpediente(e: Expediente): TextosExpediente {
  const faixa = (f: Expediente[keyof Expediente][number] | undefined): TextoFaixa => (f ? { inicio: textoDoMinuto(f.inicio_min), fim: textoDoMinuto(f.fim_min) } : { ...VAZIA });
  return Object.fromEntries(DIAS_EXPEDIENTE.map(({ chave }) => [chave, [faixa(e[chave][0]), faixa(e[chave][1])]])) as TextosExpediente;
}

/** Chave do erro de uma faixa: `<dia>.<0|1>`. */
export const chaveDaFaixa = (dia: keyof Expediente, i: 0 | 1): string => `${dia}.${i}`;

export function lerExpedienteTexto(t: TextosExpediente): { ok: true; expediente: Expediente } | { ok: false; erros: ErrosExpediente } {
  const erros: ErrosExpediente = {};
  const expediente = {} as Expediente;
  for (const { chave } of DIAS_EXPEDIENTE) {
    const lidas: Array<{ inicio_min: number; fim_min: number }> = [];
    for (const i of [0, 1] as const) {
      const f = t[chave][i];
      const ini = f.inicio.trim();
      const fim = f.fim.trim();
      if (ini === '' && fim === '') continue;
      const a = minutoDoTextoHora(ini);
      const b = minutoDoTextoHora(fim);
      if (a === null || b === null) erros[chaveDaFaixa(chave, i)] = 'Use o horário no formato 08:00, com início e fim.';
      else if (a >= b) erros[chaveDaFaixa(chave, i)] = 'O fim vem depois do início.';
      else if (i === 1 && lidas.length === 0) erros[chaveDaFaixa(chave, i)] = 'Preencha a 1ª faixa antes da 2ª.';
      else if (i === 1 && a < lidas[0]!.fim_min) erros[chaveDaFaixa(chave, i)] = 'A 2ª faixa começa depois do fim da 1ª.';
      else lidas.push({ inicio_min: a, fim_min: b });
    }
    expediente[chave] = lidas;
  }
  return Object.keys(erros).length > 0 ? { ok: false, erros } : { ok: true, expediente };
}

export interface TextosFrequencia {
  distancia_m: string;
  intervalo_min: string;
  lote_min: string;
}
const LIMITES: Record<keyof FrequenciaRastreamento, { min: number; max: number; mensagem: string }> = {
  distancia_m: { min: 50, max: 2000, mensagem: 'Use um número inteiro de 50 a 2000 metros.' },
  intervalo_min: { min: 1, max: 60, mensagem: 'Use um número inteiro de 1 a 60 minutos.' },
  lote_min: { min: 1, max: 60, mensagem: 'Use um número inteiro de 1 a 60 minutos.' },
};

export const textosDaFrequencia = (f: FrequenciaRastreamento): TextosFrequencia => ({ distancia_m: String(f.distancia_m), intervalo_min: String(f.intervalo_min), lote_min: String(f.lote_min) });

export function lerFrequenciaTexto(t: TextosFrequencia): { ok: true; frequencia: FrequenciaRastreamento } | { ok: false; erros: Partial<Record<keyof FrequenciaRastreamento, string>> } {
  const erros: Partial<Record<keyof FrequenciaRastreamento, string>> = {};
  const v = {} as FrequenciaRastreamento;
  for (const c of Object.keys(LIMITES) as Array<keyof FrequenciaRastreamento>) {
    const txt = t[c].trim();
    const n = /^\d+$/.test(txt) ? Number(txt) : Number.NaN;
    if (!(n >= LIMITES[c].min && n <= LIMITES[c].max)) erros[c] = LIMITES[c].mensagem;
    else v[c] = n;
  }
  return Object.keys(erros).length > 0 ? { ok: false, erros } : { ok: true, frequencia: v };
}

/** "dd/mm/aaaa" de uma data civil "AAAA-MM-DD" (sem fuso: é data do calendário). */
export const dataCivilBr = (d: string): string => d.split('-').reverse().join('/');
