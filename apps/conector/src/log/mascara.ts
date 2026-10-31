/**
 * Máscara de dados pessoais e segredos para log (CLAUDE.md regra 8: sem dado pessoal em log).
 * Duas camadas: (1) chaves sensíveis têm o valor trocado por `***`; (2) em qualquer texto, CPF/CNPJ,
 * e-mail, telefone, tokens e senhas de string de conexão são mascarados. Segredos registrados em runtime
 * (`registrarSegredo`) são removidos de qualquer saída.
 */
const CHAVES_SENSIVEIS = [
  'senha', 'password', 'pwd', 'secret', 'segredo', 'token', 'authorization', 'apikey', 'api_key', 'chave', 'credencial',
  'cpf', 'cnpj', 'documento', 'email', 'e_mail', 'telefone', 'celular', 'fone', 'nome', 'razao_social', 'nome_fantasia',
  'endereco', 'logradouro', 'contato', 'latitude', 'longitude', 'registro', 'registros', 'linha', 'linhas_dados', 'payload',
];

const segredos = new Set<string>();

/** Registra um valor que nunca pode aparecer em log (senha do banco, token do Hub). */
export function registrarSegredo(valor: string | undefined): void {
  if (valor && valor.length >= 4) segredos.add(valor);
}
export function limparSegredosRegistrados(): void {
  segredos.clear();
}

const REGRAS: [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***'],
  [/(password|pwd|senha|token|secret|apikey)\s*[=:]\s*[^;\s,&"']+/gi, '$1=***'],
  [/(:\/\/[^:/\s@]+:)[^@\s]+@/g, '$1***@'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]'],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'],
  [/(?<![\d.])\(?\d{2}\)?[\s-]?9?\d{4}-?\d{4}(?![\d.])/g, '[telefone]'],
];

export function mascararTexto(texto: string): string {
  let t = texto;
  for (const s of segredos) t = t.split(s).join('***');
  for (const [re, troca] of REGRAS) t = t.replace(re, troca);
  return t;
}

function sensivel(chave: string): boolean {
  const k = chave.toLowerCase();
  return CHAVES_SENSIVEIS.some((c) => k === c || k.endsWith(`_${c}`) || k.startsWith(`${c}_`) || (c.length > 5 && k.includes(c)));
}

/** Copia o valor mascarando chaves sensíveis e textos; limita a profundidade e o tamanho. */
export function mascararValor(valor: unknown, chave = '', profundidade = 0): unknown {
  if (sensivel(chave) && valor !== null && valor !== undefined && typeof valor !== 'boolean' && typeof valor !== 'number') return '***';
  if (typeof valor === 'string') return mascararTexto(valor.length > 500 ? `${valor.slice(0, 500)}…` : valor);
  if (valor instanceof Error) return mascararTexto(`${valor.name}: ${valor.message}`);
  if (profundidade > 4) return '[…]';
  if (Array.isArray(valor)) return valor.slice(0, 20).map((v) => mascararValor(v, chave, profundidade + 1));
  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) saida[k] = mascararValor(v, k, profundidade + 1);
    return saida;
  }
  return valor;
}

/** `external_id` pode ser chave do ERP, mas por precaução só os 2 últimos caracteres aparecem em log. */
export function mascararId(id: string | null | undefined): string {
  if (!id) return '';
  return id.length <= 4 ? '***' : `***${id.slice(-2)}`;
}
