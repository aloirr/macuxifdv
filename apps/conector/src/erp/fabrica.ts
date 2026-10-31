import type { ConfigConector } from '../config/esquema';
import type { ConexaoErp } from './driver';
import { criarConexaoPostgres } from './postgres';
import { criarConexaoSqlServer } from './sqlserver';

export async function abrirConexaoErp(erp: ConfigConector['erp'], senha: string): Promise<ConexaoErp> {
  const comum = { host: erp.host, porta: erp.porta, banco: erp.banco, usuario: erp.usuario, senha, timeoutMs: erp.timeoutSegundos * 1000 };
  if (erp.tipo === 'postgres') return criarConexaoPostgres({ ...comum, ssl: erp.criptografar, confiarCertificado: erp.confiarCertificado });
  return criarConexaoSqlServer({ ...comum, instancia: erp.instancia, criptografar: erp.criptografar, confiarCertificado: erp.confiarCertificado });
}
