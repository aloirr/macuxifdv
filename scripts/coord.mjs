#!/usr/bin/env node
// CLI do protocolo de recados do time Macuxi — igual para todos os agentes.
//
//   node scripts/coord.mjs enviar --de <agente> --para <a,b> [--cc <c>] --tipo <tipo> --assunto "..."
//        [--corpo "..." | --arquivo caminho.md] [--tarefa T-0001] [--prioridade alta|normal|baixa]
//        [--responde-a <id>] [--encerra] [--contrato modulo.entidade.fato@1]
//   node scripts/coord.mjs caixa <agente>           recados abertos/não lidos do agente
//   node scripts/coord.mjs lido <agente> <id> [...]  marca avisos/entregas/respostas como lidos
//   node scripts/coord.mjs ler <id>                 mostra um recado
//   node scripts/coord.mjs fio <id>                 mostra a conversa (recado + respostas)
//   node scripts/coord.mjs pendencias               visão geral para o gerente (abertos por destinatário)
//   node scripts/coord.mjs dono <caminho>           quem é o dono do caminho
//   node scripts/coord.mjs verificar [agente]       confere o diff do git contra .coord/donos.json
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  RAIZ, AGENTES, DESTINOS, TIPOS, TIPOS_QUE_EXIGEM_ENCERRAMENTO,
  carregarDonos, donoDe, caminhoRelativo, podeAlterar,
} from './coord-lib.mjs';

const PASTA = join(RAIZ, '.coord', 'recados');
const [, , cmd, ...resto] = process.argv;

function opcoes(args) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) o[k] = true;
      else { o[k] = v; i++; }
    } else o._.push(a);
  }
  return o;
}
const lista = (v) => (v && v !== true ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
const falhar = (m) => { console.error(`Erro: ${m}`); process.exit(1); };

function agoraLocal() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const p = (n) => String(Math.abs(n)).padStart(2, '0');
  const loc = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return { iso: `${loc}${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`, compacto: loc.replace(/[-:]/g, '').replace('T', '-') };
}

function parse(txt) {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const linha of m[1].split(/\r?\n/)) {
    const mm = linha.match(/^([a-z_]+):\s*(.*?)\s*(#.*)?$/i);
    if (!mm) continue;
    let v = mm[2];
    if (v.startsWith('[')) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else if (v === 'null' || v === '') v = null;
    else if (v === 'true' || v === 'false') v = v === 'true';
    else v = v.replace(/^"(.*)"$/, '$1');
    meta[mm[1]] = v;
  }
  return { meta, corpo: m[2] };
}

function todosRecados() {
  const vistos = new Map();
  if (!existsSync(PASTA)) return [];
  for (const dest of readdirSync(PASTA)) {
    const dir = join(PASTA, dest);
    let arqs = [];
    try { arqs = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const f of arqs) {
      const r = parse(readFileSync(join(dir, f), 'utf8'));
      if (!r || !r.meta.id) continue;
      const atual = vistos.get(r.meta.id) || { ...r, pastas: [] };
      atual.pastas.push(dest);
      vistos.set(r.meta.id, atual);
    }
  }
  return [...vistos.values()].sort((a, b) => String(a.meta.criado_em).localeCompare(String(b.meta.criado_em)));
}

function encerrados(recs) {
  const s = new Set();
  for (const r of recs) if (r.meta.encerra && r.meta.responde_a) s.add(r.meta.responde_a);
  return s;
}
function lidosDe(agente) {
  const arq = join(RAIZ, '.coord', 'lidos', `${agente}.txt`);
  return existsSync(arq) ? new Set(readFileSync(arq, 'utf8').split(/\r?\n/).filter(Boolean)) : new Set();
}
const titulo = (r) => (r.corpo.match(/^#\s+(.+)$/m) || [, '(sem assunto)'])[1];
const idade = (r) => {
  const h = (Date.now() - new Date(r.meta.criado_em).getTime()) / 36e5;
  return h < 24 ? `${Math.max(0, Math.round(h))}h` : `${Math.round(h / 24)}d`;
};
const linha = (r) =>
  `  ${r.meta.prioridade === 'alta' ? '!' : ' '} ${r.meta.id}  [${r.meta.tipo}] de ${r.meta.de} · ${idade(r)}${r.meta.tarefa ? ' · ' + r.meta.tarefa : ''}\n      ${titulo(r)}`;

function abertosPara(agente, recs, fechados) {
  const lidos = lidosDe(agente);
  return recs.filter((r) => {
    const direto = (r.meta.para || []).includes(agente) || (r.meta.para || []).includes('todos');
    const copia = (r.meta.cc || []).includes(agente);
    if ((!direto && !copia) || r.meta.de === agente) return false;
    if (fechados.has(r.meta.id)) return false;
    if (direto && TIPOS_QUE_EXIGEM_ENCERRAMENTO.includes(r.meta.tipo)) return true;
    return !lidos.has(r.meta.id); // informativo ou cópia: some ao marcar como lido
  });
}

switch (cmd) {
  case 'enviar': {
    const o = opcoes(resto);
    const de = o.de;
    const para = lista(o.para);
    const cc = lista(o.cc);
    const tipo = o.tipo || 'pedido';
    if (!AGENTES.includes(de) && de !== 'alexandre') falhar(`--de inválido. Use um de: ${AGENTES.join(', ')}, alexandre`);
    if (!para.length) falhar('informe --para');
    for (const p of [...para, ...cc]) if (!DESTINOS.includes(p)) falhar(`destinatário inválido: ${p}`);
    if (!TIPOS.includes(tipo)) falhar(`--tipo inválido. Use: ${TIPOS.join(', ')}`);
    if (!o.assunto || o.assunto === true) falhar('informe --assunto');
    const prioridade = ['alta', 'normal', 'baixa'].includes(o.prioridade) ? o.prioridade : 'normal';
    if (o['responde-a']) {
      const ids = new Set(todosRecados().map((r) => r.meta.id));
      if (!ids.has(o['responde-a'])) falhar(`--responde-a: recado ${o['responde-a']} não encontrado`);
    }
    if (tipo === 'bloqueio' && !cc.includes('gerente-projetos') && !para.includes('gerente-projetos')) cc.push('gerente-projetos');
    let corpo = '';
    if (o.arquivo && o.arquivo !== true) corpo = readFileSync(o.arquivo, 'utf8');
    else if (o.corpo && o.corpo !== true) {
      const partes = String(o.corpo).split('|').map((s) => s.trim());
      corpo = partes.length >= 3
        ? `## Contexto\n${partes[0]}\n\n## O que preciso / o que mudou\n${partes[1]}\n\n## Pronto quando\n${partes.slice(2).join(' | ')}\n`
        : `${o.corpo}\n`;
    } else corpo = '## Contexto\n\n## O que preciso / o que mudou\n\n## Pronto quando\n';
    const t = agoraLocal();
    let id = `R-${t.compacto}-${de}`;
    const existentes = new Set(todosRecados().map((r) => r.meta.id));
    for (let n = 2; existentes.has(id); n++) id = `R-${t.compacto}-${n}-${de}`;
    const conteudo = [
      '---',
      `id: ${id}`,
      `de: ${de}`,
      `para: [${para.join(', ')}]`,
      `cc: [${cc.join(', ')}]`,
      `tipo: ${tipo}`,
      `prioridade: ${prioridade}`,
      `tarefa: ${o.tarefa && o.tarefa !== true ? o.tarefa : 'null'}`,
      `responde_a: ${o['responde-a'] || 'null'}`,
      `encerra: ${o.encerra ? 'true' : 'false'}`,
      `contrato: ${o.contrato && o.contrato !== true ? o.contrato : 'null'}`,
      `criado_em: ${t.iso}`,
      '---',
      `# ${o.assunto}`,
      '',
      corpo,
    ].join('\n');
    const regras = carregarDonos();
    for (const d of new Set([...para, ...cc])) {
      const dir = join(PASTA, d);
      mkdirSync(dir, { recursive: true });
      const rel = `.coord/recados/${d}/${id}.md`;
      if (AGENTES.includes(de)) {
        const r = podeAlterar({ agente: de, ferramenta: 'Write', rel, regras });
        if (!r.ok) falhar(r.motivo);
      }
      writeFileSync(join(RAIZ, rel), conteudo, 'utf8');
    }
    console.log(`Recado ${id} enviado para ${[...para, ...cc.map((c) => c + ' (cc)')].join(', ')}`);
    break;
  }

  case 'caixa': {
    const agente = resto[0];
    if (!DESTINOS.includes(agente)) falhar('informe o agente: node scripts/coord.mjs caixa <agente>');
    const recs = todosRecados();
    const abertos = abertosPara(agente, recs, encerrados(recs));
    if (!abertos.length) { console.log(`Caixa de ${agente}: nada pendente.`); break; }
    const exige = (r) => TIPOS_QUE_EXIGEM_ENCERRAMENTO.includes(r.meta.tipo) && ((r.meta.para || []).includes(agente) || (r.meta.para || []).includes('todos'));
    const acao = abertos.filter(exige);
    const info = abertos.filter((r) => !exige(r));
    console.log(`Caixa de ${agente}: ${acao.length} exigem ação, ${info.length} informativos não lidos`);
    if (acao.length) console.log('\nExigem ação (responda com --responde-a; quem resolve usa --encerra):\n' + acao.map(linha).join('\n'));
    if (info.length) console.log('\nInformativos (marque com: node scripts/coord.mjs lido ' + agente + ' <id>):\n' + info.map(linha).join('\n'));
    break;
  }

  case 'lido': {
    const [agente, ...ids] = resto;
    if (!DESTINOS.includes(agente) || !ids.length) falhar('uso: lido <agente> <id> [...]');
    const dir = join(RAIZ, '.coord', 'lidos');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${agente}.txt`), ids.map((i) => i + '\n').join(''), 'utf8');
    console.log(`${ids.length} recado(s) marcado(s) como lido(s) por ${agente}.`);
    break;
  }

  case 'ler': {
    const r = todosRecados().find((x) => x.meta.id === resto[0]);
    if (!r) falhar('recado não encontrado');
    console.log(readFileSync(join(PASTA, r.pastas[0], `${r.meta.id}.md`), 'utf8'));
    break;
  }

  case 'fio': {
    const recs = todosRecados();
    const raiz = recs.find((x) => x.meta.id === resto[0]);
    if (!raiz) falhar('recado não encontrado');
    const fio = [raiz];
    const ids = new Set([raiz.meta.id]);
    for (const r of recs) if (ids.has(r.meta.responde_a)) { fio.push(r); ids.add(r.meta.id); }
    for (const r of fio) console.log(`${r.meta.criado_em}  ${r.meta.de} → ${(r.meta.para || []).join(', ')}  [${r.meta.tipo}${r.meta.encerra ? ', encerra' : ''}]\n  ${titulo(r)}\n${r.corpo.split('\n').slice(1).join('\n').trim().replace(/^/gm, '    ')}\n`);
    break;
  }

  case 'pendencias': {
    const recs = todosRecados();
    const fechados = encerrados(recs);
    const abertos = recs.filter((r) => TIPOS_QUE_EXIGEM_ENCERRAMENTO.includes(r.meta.tipo) && !fechados.has(r.meta.id));
    if (!abertos.length) { console.log('Nenhuma pendência aberta entre os agentes.'); break; }
    const bloqueios = abertos.filter((r) => r.meta.tipo === 'bloqueio');
    if (bloqueios.length) console.log(`BLOQUEIOS (${bloqueios.length}):\n` + bloqueios.map(linha).join('\n') + '\n');
    const porDest = {};
    for (const r of abertos) for (const d of r.meta.para || []) (porDest[d] ||= []).push(r);
    for (const [d, rs] of Object.entries(porDest).sort()) console.log(`${d} (${rs.length}):\n` + rs.map(linha).join('\n'));
    break;
  }

  case 'dono': {
    const rel = caminhoRelativo(resto[0] || '');
    if (!rel) falhar('caminho fora do repositório');
    console.log(`${rel} → ${donoDe(rel, carregarDonos())}`);
    break;
  }

  case 'verificar': {
    const agente = resto[0];
    let arquivos = [];
    try {
      const out = execSync('git diff --name-only HEAD && git ls-files --others --exclude-standard', { cwd: RAIZ, encoding: 'utf8' });
      arquivos = [...new Set(out.split(/\r?\n/).filter(Boolean))];
    } catch { falhar('não foi possível ler o git (o repositório tem ao menos um commit?)'); }
    const regras = carregarDonos();
    if (agente) {
      const fora = arquivos.filter((f) => !podeAlterar({ agente, ferramenta: 'Write', rel: f, regras }).ok && !f.startsWith('.coord/recados/') && !f.startsWith('.coord/lidos/'));
      if (!fora.length) console.log(`OK: ${arquivos.length} arquivo(s) alterado(s), todos dentro dos caminhos de ${agente}.`);
      else { console.log(`VIOLAÇÃO: ${fora.length} arquivo(s) fora dos caminhos de ${agente}:`); for (const f of fora) console.log(`  ${f} → dono: ${donoDe(f, regras)}`); process.exit(3); }
    } else {
      const grupos = {};
      for (const f of arquivos) {
        const g = /^\.coord\/(recados|diario|lidos)\//.test(f) ? '(recados e diários — livres pelo protocolo)' : donoDe(f, regras);
        (grupos[g] ||= []).push(f);
      }
      for (const [d, fs] of Object.entries(grupos).sort()) console.log(`${d} (${fs.length}):\n` + fs.map((f) => '  ' + f).join('\n'));
    }
    break;
  }

  default:
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}
