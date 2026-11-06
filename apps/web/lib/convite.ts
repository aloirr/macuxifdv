/**
 * Equipe por CSV e convite de 1º acesso no BKO (T-0087 fatia E; RN-CORE-31; docs/modulos/core/equipe-csv.md). Puro, para teste.
 *
 * - O link do convite aponta para o BKO, nunca para o portal: no host `config.` o caminho seria do portal e o `/login` vai para
 *   a entrada do super-admin. `origemDoBko` troca o `config.` por `bko.` (produção:
 *   `config.macuxifdv.com.br` → `bko.macuxifdv.com.br`; no PC: `config.localhost:3000` → `bko.localhost:3000`).
 * - Formato do link (R-20261106-044125): `/convite#<token>` (o fragmento não sai do navegador: nem log do túnel, nem do Next); a
 *   página lê o `#`, guarda o token só na aba (`sessionStorage`, para o F5) e limpa o endereço. `/convite/<token>` continua aceito.
 * - A página `/convite` nunca manda o token a terceiros: `Referrer-Policy: no-referrer`, `no-store` e `noindex` (proxy.ts),
 *   sem analytics, sem `console`.
 * - A regra de força da senha é do Core (`validarSenhaInicial`, revalidada no aceite): a tela só mostra a regra e confere a
 *   confirmação; o 422 traz o motivo na `mensagem`.
 */
import { CODIGOS_EQUIPE_CSV, MAX_CSV_EQUIPE_BYTES } from '@macuxi/core/contracts';

export { ehPaginaDeConvite, PREFIXO_CONVITE } from './portal';

/** E-mail entregue ao login depois do aceite (só na aba, apagado na primeira leitura). O código da empresa usa a chave do login. */
export const CHAVE_EMAIL_DO_CONVITE = 'macuxi.web.convite_email';

/** Limite de linhas por arquivo da Equipe (o Core recusa acima disto). */
export const MAX_LINHAS_EQUIPE = 5_000;

/** Mensagem única (usado, vencido, revogado ou link cortado não se distinguem, por segurança); o link cortado pelo WhatsApp ou e-mail é o caso comum. */
export const MENSAGEM_CONVITE_INVALIDO =
  'Este convite não vale mais: ele já foi usado, venceu ou o link chegou incompleto. Abra o link inteiro que você recebeu ou peça um convite novo ao administrador da sua empresa.';
export const REGRA_DA_SENHA = 'Pelo menos 8 caracteres, com letras e números, e diferente do seu e-mail.';

/** Origem do BKO a partir da origem em uso (portal `config.` → `bko.`; BKO → ela mesma). Inválida = `null` (a API devolve só o caminho). */
export function origemDoBko(origem: string | null | undefined): string | null {
  let u: URL;
  try {
    u = new URL(origem ?? '');
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const novoHost = host.startsWith('config.') && host.length > 'config.'.length ? `bko.${host.slice('config.'.length)}` : host;
  return `${u.protocol}//${novoHost}${u.port ? `:${u.port}` : ''}`;
}

/** Link completo do convite: o `link` da API ou, sem ele, a origem do BKO + `caminho`. */
export function linkDoConvite(c: { link: string | null; caminho: string }, origemBko: string | null): string {
  return c.link ?? (origemBko ? `${origemBko}${c.caminho}` : c.caminho);
}

/** Célula de CSV: aspas quando preciso e neutralização de fórmula de planilha (`= + - @`), como o `convites_csv` do Core. */
function celula(v: string): string {
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/**
 * CSV dos convites gerado na tela (links novos acumulados e renovados; revisão de UX R-20261106-050553 Y2), nas mesmas colunas do
 * `convites_csv` do Core: nome, email, perfil, link, expira_em (UTC). Só na memória até o download (LGPD, T-0087 §7).
 */
export function csvDosConvites(
  convites: readonly { nome: string; email: string; perfil: string; link: string | null; caminho: string; expira_em: string }[],
  origemBko: string | null,
): string {
  const linhas = convites.map((c) => [c.nome, c.email, c.perfil, linkDoConvite(c, origemBko), c.expira_em].map(celula).join(','));
  return ['nome,email,perfil,link,expira_em', ...linhas].join('\r\n') + '\r\n';
}

/** Junta convites novos aos que ainda não foram baixados: o mais recente de cada pessoa vale (o anterior deixou de valer). */
export function juntarConvites<T extends { usuario_id: string }>(novos: readonly T[], anteriores: readonly T[]): T[] {
  const ids = new Set(novos.map((c) => c.usuario_id));
  return [...novos, ...anteriores.filter((c) => !ids.has(c.usuario_id))];
}

/** Token guardado na aba entre o primeiro carregamento e o aceite (o endereço já foi limpo). */
export const CHAVE_TOKEN_DO_CONVITE = 'macuxi.web.convite_token';

/**
 * De onde vem o token: o fragmento (`#<token>`, o formato preferido), o caminho (`/convite/<token>`) ou a aba (F5 depois de o
 * endereço ser limpo). O primeiro válido vale; `limparEndereco` = o token estava no endereço e deve sair dele.
 */
export function tokenDoConvite(o: { hash: string; caminho: string | null; guardado: string | null }): { token: string | null; limparEndereco: boolean } {
  const doHash = tokenDaUrl(decodificar(o.hash.replace(/^#/, '')));
  if (doHash) return { token: doHash, limparEndereco: true };
  const doCaminho = tokenDaUrl(o.caminho);
  if (doCaminho) return { token: doCaminho, limparEndereco: true };
  return { token: tokenDaUrl(o.guardado), limparEndereco: o.hash !== '' || !!o.caminho };
}

function decodificar(x: string): string {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

/** Token do segmento da URL (o Next entrega já decodificado; espaço ou barra = inválido). */
export function tokenDaUrl(bruto: string | undefined | null): string | null {
  const t = (bruto ?? '').trim();
  return t.length >= 20 && t.length <= 100 && /^[A-Za-z0-9._~-]+$/.test(t) ? t : null;
}

/** Conferência local do formulário de aceite: só o que não é regra de negócio (vazio e confirmação igual). */
export function conferirFormularioDoConvite(senha: string, confirmar: string): { senha?: string; confirmar?: string } {
  const erros: { senha?: string; confirmar?: string } = {};
  if (!senha) erros.senha = 'Crie a sua senha.';
  if (!confirmar) erros.confirmar = 'Digite a senha de novo para confirmar.';
  else if (senha && senha !== confirmar) erros.confirmar = 'As duas senhas não são iguais. Digite de novo.';
  return erros;
}

export type ResultadoDoAceite = { tipo: 'invalido' } | { tipo: 'senha'; mensagem: string } | { tipo: 'erro'; mensagem: string };

/** Erro do `POST /v1/auth/convite/aceitar` → o que a tela mostra. 410 = convite inválido (mensagem única); 422 = motivo da senha. */
export function resultadoDoErroDeAceite(status: number, corpo: unknown): ResultadoDoAceite {
  const b = (corpo && typeof corpo === 'object' ? corpo : {}) as { codigo?: unknown; mensagem?: unknown };
  const mensagem = typeof b.mensagem === 'string' && b.mensagem.trim() && !b.mensagem.trim().startsWith('{') && !b.mensagem.trim().startsWith('[') ? b.mensagem.trim() : null;
  if (status === 410 || b.codigo === CODIGOS_EQUIPE_CSV.conviteInvalido) return { tipo: 'invalido' };
  if (status === 422 && (b.codigo === CODIGOS_EQUIPE_CSV.senhaFraca || mensagem)) return { tipo: 'senha', mensagem: mensagem ?? REGRA_DA_SENHA };
  if (status === 429) return { tipo: 'erro', mensagem: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.' };
  if (status === 0) return { tipo: 'erro', mensagem: 'Sem conexão com o servidor. Confira a internet e tente de novo.' };
  if (status === 400) return { tipo: 'invalido' };
  return { tipo: 'erro', mensagem: 'Não foi possível criar a senha agora. Tente de novo; se continuar, avise o administrador da sua empresa.' };
}

export type ArquivoDaEquipe = { ok: true; csv: string; linhas: number } | { ok: false; mensagem: string };

/** Confere o tamanho do arquivo antes de enviar (2 MB e 5.000 linhas; o Core confere de novo). */
export function lerArquivoDaEquipe(texto: string): ArquivoDaEquipe {
  const csv = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  if (!csv.trim()) return { ok: false, mensagem: 'O arquivo está vazio. Baixe o modelo, preencha e escolha de novo.' };
  if (new TextEncoder().encode(csv).length > MAX_CSV_EQUIPE_BYTES) return { ok: false, mensagem: 'O arquivo passa de 2 MB. Divida a equipe em dois arquivos e importe um de cada vez.' };
  const linhas = csv.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;
  if (linhas < 1) return { ok: false, mensagem: 'O arquivo só tem o cabeçalho. Preencha uma pessoa por linha e escolha de novo.' };
  if (linhas > MAX_LINHAS_EQUIPE) return { ok: false, mensagem: `O arquivo tem ${linhas.toLocaleString('pt-BR')} pessoas; o limite é ${MAX_LINHAS_EQUIPE.toLocaleString('pt-BR')} por arquivo. Divida e importe um de cada vez.` };
  return { ok: true, csv, linhas };
}

export function formatarPessoas(n: number): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? 'pessoa' : 'pessoas'}`;
}

/** Resumo da conferência/gravação numa frase. */
export function textoDoResumo(r: { novos: number; atualizados: number; sem_mudanca: number; com_erro: number }): string {
  const n = (x: number) => x.toLocaleString('pt-BR');
  return `${n(r.novos)} ${r.novos === 1 ? 'nova' : 'novas'} · ${n(r.atualizados)} ${r.atualizados === 1 ? 'atualizada' : 'atualizadas'} · ${n(r.sem_mudanca)} sem mudança · ${n(r.com_erro)} com erro`;
}
