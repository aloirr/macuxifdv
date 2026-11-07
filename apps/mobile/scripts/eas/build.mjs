#!/usr/bin/env node
/**
 * Build no EAS com o nome certo (T-0109). Na pasta apps/mobile:
 *
 *   node scripts/eas/build.mjs <campo|gestao|ambos> <demo|oficial|dev> [--simular] [-- <opções extras do eas build>]
 *
 *   campo demo     → eas build --platform android --profile campo-preview  --message Campo-Demo-v1.0.0
 *   gestao oficial → eas build --platform android --profile gestao-producao --message Gestao-Oficial-v1.0.0
 *   campo dev      → eas build --platform android --profile campo          --message Campo-Dev-v1.0.0
 *   ambos demo     → os dois, um depois do outro (para no primeiro que falhar)
 *
 * A versão vem de scripts/eas/versao.json; o versionCode é do EAS (remoto, +1 a cada build; ver eas.json).
 * `--simular` só mostra os comandos. Tudo depois de `--` vai para o eas build (ex.: `-- --no-wait`).
 */
import { ehPrincipal, nomes, rodarEas, versaoAtual } from './comum.mjs';

const USO = 'uso: node scripts/eas/build.mjs <campo|gestao|ambos> <demo|oficial|dev> [--simular] [-- <opções do eas build>]';

/**
 * Plano do build a partir dos argumentos e da versão (puro, para teste).
 * @param {string[]} argv argumentos depois do nome do script
 * @param {string} versao X.Y.Z
 */
export function planoDeBuild(argv, versao) {
  const corte = argv.indexOf('--');
  const proprios = corte === -1 ? argv : argv.slice(0, corte);
  const extras = corte === -1 ? [] : argv.slice(corte + 1);
  const simular = proprios.includes('--simular');
  const posicionais = proprios.filter((a) => a !== '--simular');
  const desconhecida = posicionais.find((a) => a.startsWith('-'));
  if (desconhecida) throw new Error(`opção desconhecida: ${desconhecida} (opções do eas vão depois de --)\n${USO}`);
  if (posicionais.length !== 2) throw new Error(USO);
  const [varianteTexto, canalTexto] = posicionais;
  const ambos = ['ambos', 'todos'].includes(varianteTexto.trim().toLowerCase());
  const alvos = (ambos ? ['campo', 'gestao'] : [varianteTexto]).map((v) => nomes.lerAlvo(v, canalTexto));
  const builds = alvos.map(({ variante, perfil }) => {
    const nome = nomes.nomeDoBuild(variante, perfil, versao);
    const perfilEas = nomes.perfilEas(variante, perfil);
    return { nome, perfilEas, args: ['build', '--platform', 'android', '--profile', perfilEas, '--message', nome, ...extras] };
  });
  return { simular, builds };
}

function principal() {
  let plano;
  try {
    plano = planoDeBuild(process.argv.slice(2), versaoAtual());
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  for (const b of plano.builds) {
    console.log(`\n▶ ${b.nome} (perfil ${b.perfilEas})\n  eas ${b.args.join(' ')}`);
    if (plano.simular) continue;
    const { codigo } = rodarEas(b.args);
    if (codigo !== 0) {
      console.error(`✖ o build ${b.nome} falhou (eas saiu com ${codigo})`);
      process.exit(codigo);
    }
    console.log(`✔ ${b.nome} enviado ao EAS`);
  }
}

if (ehPrincipal(import.meta.url)) principal();
