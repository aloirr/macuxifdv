/**
 * Nome e versão dos builds (T-0109). Puro, sem Expo: usado pelo app (linha da versão no Perfil), pelo `app.config.ts`
 * e pelos scripts do EAS (`scripts/eas/build.mjs` e `scripts/eas/baixar-apk.mjs`, que o importam pelo Node com
 * remoção de tipos — por isso aqui só entra TypeScript "apagável": nada de enum, namespace ou import de valor).
 *
 * Nome do build = `<Variante>-<Canal>-v<versão>`:
 *  - variante: `Campo` (Macuxi Campo) ou `Gestao` (Macuxi Gestão, sem acento para servir de nome de arquivo);
 *  - canal: `Oficial` (perfis `*-producao`, os únicos do eas.json desde R-20261114-200000-alexandre, sem os perfis
 *    de desenvolvimento e preview). `Dev` só aparece na linha da versão de um bundle local (`expo start`);
 *  - versão: a de `scripts/eas/versao.json` (fonte única do `version` do app.config), no formato X.Y.Z.
 * O mesmo nome vai na mensagem do build no EAS (`eas build --message`), na linha da versão do Perfil e no arquivo do
 * APK publicado (`Campo-Oficial-v1.0.0.apk`). O `versionCode` do Android não entra no nome: é do EAS (remoto, sempre
 * crescente por pacote), ver `eas.json`.
 */
import type { PerfilBuild } from './endereco-do-build';
import type { Variante } from './variante-tipo';

export const ROTULO_VARIANTE: Readonly<Record<Variante, string>> = { campo: 'Campo', gestao: 'Gestao' };

export const ROTULO_CANAL: Readonly<Record<PerfilBuild, string>> = { desenvolvimento: 'Dev', producao: 'Oficial' };

/** Versão do app: X.Y.Z, números sem zero à esquerda (o que o Android mostra como versionName). */
const VERSAO = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function versaoValida(versao: string | null | undefined): versao is string {
  return typeof versao === 'string' && VERSAO.test(versao);
}

/** Lê a versão do conteúdo de `scripts/eas/versao.json` (`{ "versao": "X.Y.Z" }`); erro claro se faltar ou vier torta. */
export function lerVersao(conteudo: unknown): string {
  const v = (conteudo as { versao?: unknown } | null)?.versao;
  if (typeof v !== 'string' || !versaoValida(v)) {
    throw new Error(`versão inválida em scripts/eas/versao.json: ${JSON.stringify(v)} (use X.Y.Z, por exemplo "1.0.0")`);
  }
  return v;
}

/** `Campo-Oficial-v1.0.0`. Versão fora do formato X.Y.Z = erro (o build não sai com nome torto). */
export function nomeDoBuild(variante: Variante, perfil: PerfilBuild, versao: string): string {
  if (!versaoValida(versao)) throw new Error(`versão inválida: ${JSON.stringify(versao)} (use X.Y.Z, por exemplo "1.0.0")`);
  return `${ROTULO_VARIANTE[variante]}-${ROTULO_CANAL[perfil]}-v${versao}`;
}

/** `Campo-Oficial-v1.0.0.apk`: nome do arquivo publicado no bucket. */
export function nomeDoApk(variante: Variante, perfil: PerfilBuild, versao: string): string {
  return `${nomeDoBuild(variante, perfil, versao)}.apk`;
}

/**
 * Linha da versão no Perfil: o nome do build. Sem versão legível (não deveria acontecer: vem do app.config), mostra
 * `v?` em vez de quebrar a tela.
 */
export function textoDaVersao(variante: Variante, perfil: PerfilBuild, versao: string | null | undefined): string {
  return versaoValida(versao) ? nomeDoBuild(variante, perfil, versao) : `${ROTULO_VARIANTE[variante]}-${ROTULO_CANAL[perfil]}-v?`;
}

/** Único canal com perfil no `eas.json` (sem os perfis de desenvolvimento e preview). */
export type PerfilEas = 'producao';

/** Perfil do `eas.json` de cada variante: `campo-producao` ou `gestao-producao`. */
export function perfilEas(variante: Variante, perfil: PerfilEas): string {
  return `${variante}-${perfil}`;
}

/** Inverso de `perfilEas` (nome do perfil do build no EAS → variante e canal); `null` se não for um perfil nosso. */
export function lerPerfilEas(nome: string): { variante: Variante; perfil: PerfilEas } | null {
  const m = /^(campo|gestao)-producao$/.exec(nome.trim());
  if (!m) return null;
  return { variante: m[1] as Variante, perfil: 'producao' };
}

const CANAIS: Readonly<Record<string, PerfilEas>> = {
  oficial: 'producao',
  producao: 'producao',
  'produção': 'producao',
};

/**
 * Argumentos dos scripts (`campo oficial`, `gestao oficial`; aceita também `producao` e maiúsculas). Erro com o uso
 * certo se não reconhecer.
 */
export function lerAlvo(varianteTexto: string | undefined, canalTexto: string | undefined): { variante: Variante; perfil: PerfilEas } {
  const v = varianteTexto?.trim().toLowerCase().replace('ã', 'a');
  const c = canalTexto?.trim().toLowerCase();
  const perfil = c ? CANAIS[c] : undefined;
  if ((v !== 'campo' && v !== 'gestao') || !perfil) {
    throw new Error(`alvo inválido: "${varianteTexto ?? ''} ${canalTexto ?? ''}". Use <campo|gestao> oficial, por exemplo: campo oficial`);
  }
  return { variante: v, perfil };
}
