/** Leitura do arquivo de configuração (JSON ou YAML) com mensagens de erro legíveis em português. */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigConector } from './esquema';

const CHAVES_PROIBIDAS = /^(senha|password|pwd|secret|segredo|token|apikey|api_key|chave_api)$/i;

export class ErroConfig extends Error {
  constructor(message: string, readonly problemas: string[] = []) {
    super(message);
    this.name = 'ErroConfig';
  }
}

/** Procura chaves de segredo em qualquer nível: senha e token não ficam no arquivo. */
function acharSegredos(v: unknown, caminho: string[] = []): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => acharSegredos(x, [...caminho, String(i)]));
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => {
      const aqui = CHAVES_PROIBIDAS.test(k) ? [[...caminho, k].join('.')] : [];
      return [...aqui, ...acharSegredos(x, [...caminho, k])];
    });
  }
  return [];
}

export function interpretarConfig(texto: string, formato: 'json' | 'yaml'): ConfigConector {
  let bruto: unknown;
  try {
    bruto = formato === 'json' ? JSON.parse(texto) : parseYaml(texto);
  } catch (e) {
    throw new ErroConfig(`Arquivo de configuração ilegível (${formato}): ${(e as Error).message.split('\n')[0]}`);
  }
  const segredos = acharSegredos(bruto);
  if (segredos.length > 0) {
    throw new ErroConfig(
      `Segredo no arquivo de configuração: ${segredos.join(', ')}. Senhas e tokens não ficam no arquivo: use a variável de ambiente ` +
        'MACUXI_CONECTOR_ERP_SENHA / MACUXI_CONECTOR_HUB_TOKEN ou o Gerenciador de Credenciais do Windows (conector segredo definir).',
      segredos,
    );
  }
  const r = ConfigConector.safeParse(bruto);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`);
    throw new ErroConfig(`Configuração inválida:\n - ${problemas.join('\n - ')}`, problemas);
  }
  return r.data;
}

export function carregarConfig(caminho: string): ConfigConector {
  let texto: string;
  try {
    texto = readFileSync(caminho, 'utf8');
  } catch {
    throw new ErroConfig(`Arquivo de configuração não encontrado: ${caminho}. Informe com --config <arquivo> ou MACUXI_CONECTOR_CONFIG.`);
  }
  const ext = extname(caminho).toLowerCase();
  return interpretarConfig(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto, ext === '.yaml' || ext === '.yml' ? 'yaml' : 'json');
}
