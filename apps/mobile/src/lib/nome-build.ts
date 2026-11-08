/**
 * Nome e versão dos builds (T-0109). Puro, sem Expo: usado pelo app (linha da versão no Perfil), pelo `app.config.ts`
 * e pelos scripts do EAS (`scripts/eas/build.mjs` e `scripts/eas/baixar-apk.mjs`, que o importam pelo Node com
 * remoção de tipos — por isso aqui só entra TypeScript "apagável": nada de enum, namespace ou import de valor).
 *
 * Nome do build = `<Variante>-<Canal>-v<versão>`:
 *  - variante: `Campo` (Macuxi Campo) ou `Gestao` (Macuxi Gestão, sem acento para servir de nome de arquivo);
 *  - canal: `Demo` (perfis `*-preview`, apontam para a demo), `Oficial` (perfis `*-producao`) e `Dev` (perfis de
 *    desenvolvimento `campo`/`gestao`, com expo-dev-client — premissa da T-0109: o pedido só nomeou Demo e Oficial);
 *  - versão: a de `scripts/eas/versao.json` (fonte única do `version` do app.config), no formato X.Y.Z.
 * O mesmo nome vai na mensagem do build no EAS (`eas build --message`), na linha da versão do Perfil e no arquivo do
 * APK publicado (`Campo-Demo-v1.0.0.apk`). O `versionCode` do Android não entra no nome: é do EAS (remoto, sempre
 * crescente por pacote), ver `eas.json`.
 */
import type { PerfilBuild } from './endereco-do-build';
import type { Variante } from './variante-tipo';

export const ROTULO_VARIANTE: Readonly<Record<Variante, string>> = { campo: 'Campo', gestao: 'Gestao' };

export const ROTULO_CANAL: Readonly<Record<PerfilBuild, string>> = { desenvolvimento: 'Dev', preview: 'Demo', producao: 'Oficial' };

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

/** `Campo-Demo-v1.0.0`. Versão fora do formato X.Y.Z = erro (o build não sai com nome torto). */
export function nomeDoBuild(variante: Variante, perfil: PerfilBuild, versao: string): string {
  if (!versaoValida(versao)) throw new Error(`versão inválida: ${JSON.stringify(versao)} (use X.Y.Z, por exemplo "1.0.0")`);
  return `${ROTULO_VARIANTE[variante]}-${ROTULO_CANAL[perfil]}-v${versao}`;
}

/** `Campo-Demo-v1.0.0.apk`: nome do arquivo publicado no bucket. */
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

/** Perfil do `eas.json` de cada variante e canal: `campo`, `campo-preview`, `campo-producao` (idem gestao). */
export function perfilEas(variante: Variante, perfil: PerfilBuild): string {
  if (perfil === 'desenvolvimento') return variante;
  return `${variante}-${perfil}`;
}

/** Inverso de `perfilEas` (nome do perfil do build no EAS → variante e canal); `null` se não for um perfil nosso. */
export function lerPerfilEas(nome: string): { variante: Variante; perfil: PerfilBuild } | null {
  const m = /^(campo|gestao)(?:-(preview|producao))?$/.exec(nome.trim());
  if (!m) return null;
  return { variante: m[1] as Variante, perfil: (m[2] as PerfilBuild | undefined) ?? 'desenvolvimento' };
}

const CANAIS: Readonly<Record<string, PerfilBuild>> = {
  demo: 'preview',
  preview: 'preview',
  oficial: 'producao',
  producao: 'producao',
  'produção': 'producao',
  dev: 'desenvolvimento',
  desenvolvimento: 'desenvolvimento',
};

/**
 * Argumentos dos scripts (`campo demo`, `gestao oficial`, `campo dev`; aceita também `preview`/`producao`/
 * `desenvolvimento` e maiúsculas). Erro com o uso certo se não reconhecer.
 */
export function lerAlvo(varianteTexto: string | undefined, canalTexto: string | undefined): { variante: Variante; perfil: PerfilBuild } {
  const v = varianteTexto?.trim().toLowerCase().replace('ã', 'a');
  const c = canalTexto?.trim().toLowerCase();
  const perfil = c ? CANAIS[c] : undefined;
  if ((v !== 'campo' && v !== 'gestao') || !perfil) {
    throw new Error(`alvo inválido: "${varianteTexto ?? ''} ${canalTexto ?? ''}". Use <campo|gestao> <demo|oficial|dev>, por exemplo: campo demo`);
  }
  return { variante: v, perfil };
}
