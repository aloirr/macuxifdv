/**
 * Equipe por CSV no portal (T-0087 fatia E; T-0094 sem convite, RN-CORE-34; spec docs/design/ciclo-de-senha.md §6). Puro, para teste.
 * Cada pessoa nova recebe a senha temporária por e-mail (o servidor gera); a tela só mostra quantos acessos foram enviados.
 * Sem e-mail configurado o Core recusa o `gravar` com 503 `EMAIL_INDISPONIVEL` antes de gravar; o "Conferir" continua.
 */
import { CODIGOS_EQUIPE_CSV, MAX_CSV_EQUIPE_BYTES } from '@macuxi/core/contracts';

/** Limite de linhas por arquivo da Equipe (o Core recusa acima disto). */
export const MAX_LINHAS_EQUIPE = 5_000;

/** 503 `EMAIL_INDISPONIVEL` no "Importar" (spec §6): nada foi gravado. */
export const MENSAGEM_EQUIPE_SEM_EMAIL = 'O envio de e-mail não está configurado, e nada foi gravado. Fale com o suporte da Macuxi.';

/** O erro do "Importar" é o 503 de e-mail indisponível? */
export function ehEmailIndisponivel(x: unknown): boolean {
  const e = (x ?? {}) as { status?: unknown; codigo?: unknown };
  return e.codigo === CODIGOS_EQUIPE_CSV.emailIndisponivel;
}

/** Linha do resultado do "Gravar" (spec §6): `null` com 0 (a linha não aparece). */
export function textoDosAcessos(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1 ? '1 acesso enviado por e-mail.' : `${n.toLocaleString('pt-BR')} acessos enviados por e-mail.`;
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
