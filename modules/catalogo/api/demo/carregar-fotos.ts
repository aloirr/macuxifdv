/**
 * Carga de fotos de produto na base DEMO (T-0097): gera um placeholder (nome + cor da categoria, sem imagem de marca real)
 * para 20 a 30 produtos de vitrine e os grava pelo caminho de produção, sem tocar no banco nem no seed:
 *   1. login de gerente, analista ou admin (`POST /v1/auth/login`);
 *   2. `GET /v1/catalogo/produtos` (vitrine) e escolha distribuída por categoria;
 *   3. por produto: `PUT /v1/catalogo/produtos/:id/foto-principal` { arquivo_id } e `PUT /v1/arquivos/:id` com o JPEG.
 * Idempotente: o arquivo_id é derivado do produto (mesmo produto, mesmo id, mesmos bytes); repetir não duplica.
 *
 * Uso (a senha vem do ambiente e nunca é impressa):
 *   MACUXI_DEMO_URL=https://<api-da-demo>/v1 MACUXI_DEMO_EMPRESA=<codigo> MACUXI_DEMO_EMAIL=<usuario> MACUXI_DEMO_SENHA=<senha> \
 *     pnpm --filter @macuxi/catalogo exec tsx api/demo/carregar-fotos.ts [--quantidade 30] [--simular]
 * `--simular` gera e confere os JPEGs na memória sem chamar a API.
 */
import { gerarPlaceholderJpeg } from './placeholder-jpeg';
import { idDaFoto } from './id-foto';
import { escolherProdutosDeVitrine, type ItemParaFoto } from './selecao-fotos';

const argumento = (nome: string): string | undefined => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const simular = process.argv.includes('--simular');
const quantidade = Math.min(30, Math.max(1, Number(argumento('quantidade') ?? 30)));

async function principal(): Promise<void> {
  const base = (process.env.MACUXI_DEMO_URL ?? 'http://127.0.0.1:8100/v1').replace(/\/+$/, '');
  const { MACUXI_DEMO_EMPRESA: empresa, MACUXI_DEMO_EMAIL: email, MACUXI_DEMO_SENHA: senha } = process.env;
  let token = '';
  const itens: ItemParaFoto[] = [];
  if (simular) {
    for (let n = 0; n < 40; n++) itens.push({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, description: `Produto de teste ${n}`, line: ['Mercearia', 'Bebidas', 'Laticínios'][n % 3]! });
  } else {
    if (!empresa || !email || !senha) {
      console.error('[fotos] defina MACUXI_DEMO_EMPRESA, MACUXI_DEMO_EMAIL e MACUXI_DEMO_SENHA (a senha não é impressa).');
      process.exit(2);
    }
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo_empresa: empresa, email, senha }) });
    const j = (await login.json().catch(() => null)) as { access_token?: string } | null;
    if (!login.ok || !j?.access_token) {
      console.error(`[fotos] login falhou (status ${login.status}); confira a URL e as credenciais.`);
      process.exit(2);
    }
    token = j.access_token;
    for (let offset = 0; ; ) {
      const r = await fetch(`${base}/catalogo/produtos?limit=100&offset=${offset}`, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) {
        console.error(`[fotos] vitrine falhou (status ${r.status}).`);
        process.exit(2);
      }
      const pagina = (await r.json()) as { items: ItemParaFoto[]; next_offset: number | null };
      itens.push(...pagina.items);
      if (pagina.next_offset === null || itens.length >= 1000) break;
      offset = pagina.next_offset;
    }
  }
  const escolhidos = escolherProdutosDeVitrine(itens, quantidade);
  const autorizacao = { authorization: `Bearer ${token}` };
  let ok = 0;
  const falhas: string[] = [];
  for (const p of escolhidos) {
    const jpeg = gerarPlaceholderJpeg({ nome: p.description, categoria: p.line ?? '' });
    if (simular) {
      ok++;
      continue;
    }
    const arquivoId = idDaFoto(p.id);
    const a = await fetch(`${base}/catalogo/produtos/${p.id}/foto-principal`, {
      method: 'PUT',
      headers: { ...autorizacao, 'content-type': 'application/json' },
      body: JSON.stringify({ arquivo_id: arquivoId, titulo: 'Foto de demonstração' }),
    });
    if (!a.ok) {
      falhas.push(`${p.id}: rota ${a.status}`);
      continue;
    }
    const b = await fetch(`${base}/arquivos/${arquivoId}`, { method: 'PUT', headers: { ...autorizacao, 'content-type': 'image/jpeg' }, body: jpeg });
    if (b.ok) ok++;
    else falhas.push(`${p.id}: upload ${b.status}`);
  }
  console.log(`[fotos] ${simular ? 'simulado' : 'gravado'}: ${ok} de ${escolhidos.length} produtos${falhas.length > 0 ? `; falhas: ${falhas.slice(0, 5).join(' | ')}` : ''}`);
  if (falhas.length > 0) process.exit(1);
}

void principal();
