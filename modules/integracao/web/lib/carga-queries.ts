'use client';

/**
 * Chamadas da carga por arquivo no BKO (T-0100), só nas rotas `/v1/integracao/*` (JWT do usuário; a API confere licença do módulo,
 * a ação `carga.arquivo` no motor de permissões e o tenant do token). Resposta validada pelo contrato (Zod).
 *  - `GET  modelos/{entidade}.csv` e `modelos/{entidade}/dicionario` (`carga.arquivo`)
 *  - `POST cargas-arquivo` (`carga.arquivo`) → `CargaArquivoAceita`, uma chamada por parte
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiFetch, downloadBlob } from '@macuxi/platform-sdk/web';
import { CargaArquivoAceita, DicionarioModelo, type CargaArquivoEntrada, type Entidade, type ModoCarga } from '../../contracts';
import { corpoDaParte, dicionarioParaCsv, nomeArquivoDicionario, novaChaveDeCarga, planejarEnvio } from './carga';
import { qk } from './queries';

/** Baixa o modelo CSV da entidade como veio da API (bytes com BOM: o Excel abre os acentos). */
export async function baixarModelo(entidade: Entidade): Promise<void> {
  const res = await apiFetch(`/integracao/modelos/${encodeURIComponent(entidade)}.csv`);
  downloadBlob(await res.blob(), `${entidade}.csv`);
}

/** Baixa o dicionário de campos da entidade em CSV. */
export async function baixarDicionario(entidade: Entidade): Promise<void> {
  const d = DicionarioModelo.parse(await api<unknown>(`/integracao/modelos/${encodeURIComponent(entidade)}/dicionario`));
  downloadBlob(new Blob([dicionarioParaCsv(d)], { type: 'text/csv;charset=utf-8' }), nomeArquivoDicionario(entidade));
}

export interface EntradaCarga {
  entidade: Entidade;
  modo: ModoCarga;
  texto: string;
  /** Chamado a cada parte aceita (progresso da tela). */
  aoEnviarParte?: (enviadas: number, total: number) => void;
}

export interface ResultadoCarga {
  chave: string;
  totalLinhas: number;
  aceitas: CargaArquivoAceita[];
}

/** Falha de planejamento (arquivo ilegível ou vazio) antes de qualquer envio. */
export class ErroDeArquivo extends Error {}

/**
 * Envia o arquivo em ordem, parte a parte, com a MESMA chave de idempotência (RN-INT-12): repetir depois de um erro de rede não
 * duplica as partes já aceitas. Para na primeira parte que a API recusar e devolve a mensagem dela (em português, com a ação seguinte).
 */
export async function enviarCarga(e: EntradaCarga, chave: string = novaChaveDeCarga(), uuid: () => string = () => crypto.randomUUID()): Promise<ResultadoCarga> {
  const plano = planejarEnvio(e.texto);
  if (!plano.ok) throw new ErroDeArquivo(plano.mensagem);
  const sessaoId = plano.partes.length > 1 ? uuid() : null;
  const aceitas: CargaArquivoAceita[] = [];
  for (const parte of plano.partes) {
    const corpo: CargaArquivoEntrada = corpoDaParte({ entidade: e.entidade, modo: e.modo, chave, sessaoId, parte });
    aceitas.push(CargaArquivoAceita.parse(await api<unknown>('/integracao/cargas-arquivo', { method: 'POST', body: corpo })));
    e.aoEnviarParte?.(aceitas.length, plano.partes.length);
  }
  return { chave, totalLinhas: plano.totalLinhas, aceitas };
}

export function useEnviarCarga() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entrada, chave }: { entrada: EntradaCarga; chave: string }) => enviarCarga(entrada, chave),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.monitor }),
  });
}
