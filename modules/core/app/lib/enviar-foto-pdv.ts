/**
 * Envio da foto do PDV pelo aparelho (RN-CORE-38; T-0147; ADR 0041). Offline primeiro: o comando `cliente_foto` entra na fila de
 * itens e o arquivo na fila de arquivos (sobe depois do comando); a ficha mostra "Na fila" na hora (`fotosComPendentes` + `na_fila`).
 * Tipo sensível: o arquivo local é apagado assim que o envio é aceito (`apagarAoEnviar`). Sem rede nenhuma dessas etapas falha.
 */
import type { MotorSync } from '@macuxi/platform-sdk';
import type { FotoTipoSync } from '../../contracts';
import { apagarArquivoLocalAoEnviar, montarFotoPdvPush } from '../../domain';
import { capturaFotoPdvRegistrada } from './foto-fachada';

export type ResultadoEnvioFotoPdv =
  | { kind: 'enviada' }
  | { kind: 'cancelada' }
  | { kind: 'erro'; mensagem: string };

export const MSG_SEM_CAMERA_PDV = 'A câmera não está disponível neste aparelho. Confira a permissão do app e tente de novo.';
export const MSG_FALHA_CAPTURA_PDV = 'Não foi possível abrir a câmera ou a galeria. Tente de novo.';
export const MSG_FALHA_FOTO_PDV = 'Não foi possível guardar a foto neste aparelho. Libere espaço e tente de novo.';

/** Título da folha de captura (spec cliente-documentacao-v1034): "Foto da fachada" ou "Foto: <Nome>". */
export function tituloDaFolhaFotoPdv(tipo: { nome: string; fachada?: boolean }): string {
  return tipo.fachada ? 'Foto da fachada' : `Foto: ${tipo.nome}`;
}

export async function enviarFotoPdv(
  c: { motor: Pick<MotorSync, 'enfileirar' | 'enfileirarArquivo' | 'enviar' | 'ambiente'> },
  e: { clienteId: string; nomeCliente: string; tipo: Pick<FotoTipoSync, 'id' | 'nome' | 'sensivel' | 'fachada'> },
): Promise<ResultadoEnvioFotoPdv> {
  const captura = capturaFotoPdvRegistrada();
  if (!captura) return { kind: 'erro', mensagem: MSG_SEM_CAMERA_PDV };
  let foto;
  try {
    foto = await captura.escolher({ titulo: tituloDaFolhaFotoPdv(e.tipo) });
  } catch {
    // a porta do shell lança quando a câmera/galeria devolve `erro` (cancelar e negar a câmera não lançam)
    return { kind: 'erro', mensagem: MSG_FALHA_CAPTURA_PDV };
  }
  if (!foto) return { kind: 'cancelada' };
  try {
    const comando = c.motor.ambiente.novoId();
    const payload = montarFotoPdvPush({ id: comando, cliente_id: e.clienteId, foto_tipo_id: e.tipo.id, arquivo_id: foto.id, origem: foto.origem, agora: new Date() });
    const rotulo = `Foto do PDV · ${e.tipo.nome}`;
    await c.motor.enfileirar({ id: comando, entidade: 'cliente_foto', payload, rotulo, detalhe: e.nomeCliente });
    // o arquivo vai depois do comando que o referencia (ADR 0010 §4)
    await c.motor.enfileirarArquivo({ id: foto.id, modulo: 'core', rotulo: `${rotulo} · ${e.nomeCliente}`, apagarAoEnviar: apagarArquivoLocalAoEnviar(e.tipo) });
    void c.motor.enviar();
    return { kind: 'enviada' };
  } catch {
    return { kind: 'erro', mensagem: MSG_FALHA_FOTO_PDV };
  }
}
