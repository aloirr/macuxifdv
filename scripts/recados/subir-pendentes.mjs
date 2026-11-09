#!/usr/bin/env node
// Subida única dos recados e lidos do PC que não chegaram ao GitHub (T-0143, ADR 0039).
// Uso: node scripts/recados/subir-pendentes.mjs [--clone <pasta>] [--simular]
//  - Lê no clone das junções da ADR 0035 (padrão C:\macuxifdv-recados) os arquivos novos ou alterados em recados/ e
//    lidos/ (git status + commits locais que não estão no origin/main) e compara cada um com o main do GitHub.
//  - Recado que falta no GitHub sobe; igual ao do GitHub "já está"; mesmo caminho com outro conteúdo é CONFLITO:
//    nada é sobrescrito, e ele fica listado (saída 1). Lidos: une as linhas do GitHub com as do PC que faltam.
//  - Tudo num commit só (atômico), com nova tentativa se o main mudar no meio. Depois relê o GitHub e confere.
//  - Não altera o clone. Rodar de novo é seguro: o que já subiu aparece como "já está".
//  - Token: o mesmo do coord.mjs (MACUXI_RECADOS_TOKEN, GH_TOKEN, GITHUB_TOKEN ou gh auth token). Não imprime conteúdo.
//  saída: 0 = tudo no GitHub · 1 = conflito (nada sobrescrito) · 2 = erro (nada gravado pela metade)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { conexaoDeRecados, ErroRecados, shaDoBlob, dormir } from '../coord-lib.mjs';

const RE_RECADO = /^recados\/[^/]+\/[^/]+\.md$/i;
const RE_ANEXO = /^recados\/anexos\//i;
const RE_LIDOS = /^lidos\/[^/]+\.txt$/i;
const linhas = (t) => String(t || '').split(/\r?\n/).filter(Boolean);

/** Caminhos do clone que podem não estar no GitHub: status (novos e alterados) + commits locais fora do origin/main. */
export function candidatosDoClone(clone) {
  const git = (a) => execFileSync('git', ['-C', clone, '-c', 'core.quotepath=off', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const lista = new Set();
  for (const e of git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', 'recados', 'lidos']).split('\0').filter(Boolean)) {
    if (!e.slice(0, 2).includes('D')) lista.add(e.slice(3));
  }
  let temOrigem = true;
  try { git(['rev-parse', '--verify', '-q', 'origin/main']); } catch { temOrigem = false; }
  if (temOrigem) {
    for (const c of git(['diff', '--name-only', '-z', '--diff-filter=AM', 'origin/main...HEAD', '--', 'recados', 'lidos']).split('\0').filter(Boolean)) lista.add(c);
  }
  return [...lista].filter((c) => RE_RECADO.test(c) || RE_ANEXO.test(c) || RE_LIDOS.test(c)).sort();
}

/**
 * Plano da subida contra uma leitura do main: {adicoes, jaEsta, conflitos, lidos: [{caminho, linhas}]}.
 * `lerLocal(caminho)` → Buffer do clone; `listagem` = cliente.listar(); `textoRemoto(caminho)` → texto no main ou null.
 */
export function planejarSubida({ candidatos, lerLocal, listagem, textoRemoto, blobRemoto }) {
  const plano = { adicoes: [], jaEsta: [], conflitos: [], lidos: [] };
  for (const caminho of candidatos) {
    const bruto = lerLocal(caminho);
    if (RE_LIDOS.test(caminho)) {
      const remoto = textoRemoto(caminho) || '';
      const noGitHub = new Set(linhas(remoto));
      const faltam = [...new Set(linhas(bruto.toString('utf8')))].filter((l) => !noGitHub.has(l));
      if (!faltam.length) { plano.jaEsta.push(caminho); continue; }
      plano.adicoes.push({ caminho, conteudo: `${remoto}${remoto && !remoto.endsWith('\n') ? '\n' : ''}${faltam.join('\n')}\n` });
      plano.lidos.push({ caminho, linhas: faltam.length });
      continue;
    }
    // recado: LF, como o .gitattributes do repositório de recados; anexo: bytes como estão
    const conteudo = RE_ANEXO.test(caminho) ? bruto : Buffer.from(bruto.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    const remoto = RE_ANEXO.test(caminho) ? blobRemoto(caminho) : listagem.arquivos[caminho] || null;
    if (!remoto) plano.adicoes.push({ caminho, conteudo });
    else if (remoto === shaDoBlob(conteudo)) plano.jaEsta.push(caminho);
    else plano.conflitos.push(caminho);
  }
  return plano;
}

function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--clone');
  const clone = i >= 0 && args[i + 1] ? args[i + 1] : 'C:\\macuxifdv-recados';
  const simular = args.includes('--simular');
  const candidatos = candidatosDoClone(clone);
  console.log(`Clone: ${clone} — ${candidatos.length} arquivo(s) novo(s) ou alterado(s) em recados/ e lidos/`);
  if (!candidatos.length) { console.log('Resultado: OK — nada a subir.'); return 0; }
  const { cliente } = conexaoDeRecados();
  const lerLocal = (c) => readFileSync(join(clone, ...c.split('/')));
  let plano;
  let listagem;
  let commit = null;
  for (let t = 1; t <= 5; t++) {
    listagem = cliente.listar();
    const lidosRemotos = cliente.textos(candidatos.filter((c) => RE_LIDOS.test(c)).map((c) => listagem.arquivos[c]).filter(Boolean));
    plano = planejarSubida({
      candidatos, lerLocal, listagem,
      textoRemoto: (c) => lidosRemotos[listagem.arquivos[c]] ?? null,
      blobRemoto: (c) => cliente.arquivo(c).blob,
    });
    const recados = plano.adicoes.filter((a) => !RE_LIDOS.test(a.caminho));
    console.log(`GitHub ${cliente.repo}@${listagem.oid.slice(0, 7)}: ${recados.length} recado(s)/anexo(s) a subir, ${plano.lidos.length} arquivo(s) de lidos a unir (${plano.lidos.reduce((s, l) => s + l.linhas, 0)} linha(s)), ${plano.jaEsta.length} já no GitHub, ${plano.conflitos.length} conflito(s)`);
    for (const a of recados) console.log(`  + ${a.caminho}`);
    for (const l of plano.lidos) console.log(`  ∪ ${l.caminho} (+${l.linhas})`);
    for (const c of plano.conflitos) console.log(`  ! ${c} — CONFLITO: o GitHub tem outro conteúdo com este caminho; nada sobrescrito`);
    if (simular || !plano.adicoes.length) break;
    try {
      commit = cliente.commitar({
        esperado: listagem.oid, adicoes: plano.adicoes,
        titulo: `recados: subida única dos pendentes do PC (${recados.length} recado(s), ${plano.lidos.length} lidos) (T-0143)`,
        corpo: `Arquivos do clone ${clone} que não tinham chegado ao GitHub (ADR 0039).`,
      });
      break;
    } catch (e) {
      if (!(e instanceof ErroRecados)) throw e;
      if (cliente.cabeca() === listagem.oid) throw e;
      console.log(`O main mudou durante a subida (tentativa ${t}); relendo.`);
      dormir(300 * t);
    }
  }
  if (simular) { console.log('\nSimulação: nada foi gravado.'); return plano.conflitos.length ? 1 : 0; }
  if (plano.adicoes.length && !commit) throw new ErroRecados('o main mudou 5 vezes seguidas; nada foi gravado. Rode de novo');
  if (commit) {
    // Conferência: relê o main e confere cada arquivo do plano.
    const depois = cliente.listar();
    const textos = cliente.textos(plano.adicoes.filter((a) => RE_LIDOS.test(a.caminho)).map((a) => depois.arquivos[a.caminho]).filter(Boolean));
    const faltando = plano.adicoes.filter((a) => {
      if (RE_ANEXO.test(a.caminho)) return cliente.arquivo(a.caminho).blob !== shaDoBlob(a.conteudo);
      if (!RE_LIDOS.test(a.caminho)) return depois.arquivos[a.caminho] !== shaDoBlob(a.conteudo);
      const noGitHub = new Set(linhas(textos[depois.arquivos[a.caminho]]));
      return linhas(a.conteudo).some((l) => !noGitHub.has(l));
    });
    if (faltando.length) throw new ErroRecados(`o commit ${commit.oid.slice(0, 7)} entrou, mas a conferência não achou: ${faltando.map((a) => a.caminho).join(', ')}`);
    console.log(`\nSubida feita e conferida: commit ${commit.oid.slice(0, 7)} (${commit.url || cliente.repo}).`);
  }
  if (plano.conflitos.length) {
    console.log(`\nResultado: CONFLITO — ${plano.conflitos.length} arquivo(s) com outro conteúdo no GitHub; nada foi sobrescrito. Compare à mão.`);
    return 1;
  }
  console.log('\nResultado: OK — tudo o que estava no PC está no GitHub.');
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = principal();
  } catch (e) {
    console.error(`Erro: ${e instanceof ErroRecados ? e.message : e?.stack || e}`);
    process.exitCode = 2;
  }
}
