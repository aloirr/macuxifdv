// T-0086/T-0157: o SMTP da produção (T-0094, ADR 0032) chega à api e ao worker com os nomes que a API lê.
// node --test scripts/ci/*.test.mjs. Confere, sem segredo nenhum: config.ts da API × env.modelo × compose.yml × preparar-vm.sh
// × producao-publicar.yml (ou, até o rito de governança, o patch docs/desenho/T-0086-smtp-producao.patch).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = new URL('../../', import.meta.url);
const ler = (c) => readFileSync(fileURLToPath(new URL(c, RAIZ)), 'utf8').replace(/\r\n/g, '\n');

// o prazo de cada etapa SMTP não é segredo nem varia por ambiente: fica no padrão da API
const FORA_DO_SECRET = new Set(['MACUXI_SMTP_TIMEOUT_MS']);
const lidosPelaApi = [...new Set(ler('apps/api/src/email/config.ts').match(/MACUXI_SMTP_[A-Z_]+/g))].filter((n) => !FORA_DO_SECRET.has(n)).sort();

/** Blocos de serviço do compose (`  nome:` sob `services:`) → texto do bloco. */
function servicos(compose) {
  const corpo = compose.slice(compose.indexOf('\nservices:\n'), compose.indexOf('\nnetworks:\n'));
  const mapa = new Map();
  let atual = null;
  for (const linha of corpo.split('\n')) {
    const m = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(linha);
    if (m) mapa.set((atual = m[1]), '');
    else if (atual) mapa.set(atual, `${mapa.get(atual)}${linha}\n`);
  }
  return mapa;
}

/** Texto do workflow de produção depois do rito: o arquivo, se já grava o email.env; senão, o lado "depois" do patch. */
function workflowPublicar() {
  const wf = ler('.github/workflows/producao-publicar.yml');
  if (wf.includes('grava email.env')) return { origem: 'workflow', texto: wf };
  const caminho = 'docs/desenho/T-0086-smtp-producao.patch';
  assert.ok(existsSync(fileURLToPath(new URL(caminho, RAIZ))), `${caminho} ausente e o workflow ainda não grava o email.env`);
  const patch = ler(caminho);
  const inicio = patch.indexOf('+++ b/.github/workflows/producao-publicar.yml');
  assert.ok(inicio >= 0, `${caminho} não altera o producao-publicar.yml`);
  const fim = patch.indexOf('\ndiff --git', inicio);
  const trecho = patch.slice(inicio, fim < 0 ? undefined : fim);
  const depois = trecho
    .split('\n')
    .filter((l) => (l.startsWith('+') || l.startsWith(' ')) && !l.startsWith('+++'))
    .map((l) => l.slice(1))
    .join('\n');
  return { origem: 'patch', texto: depois };
}

test('a API lê exatamente host, porta, TLS, usuário, senha e remetente', () => {
  assert.deepEqual(lidosPelaApi, [
    'MACUXI_SMTP_HOST',
    'MACUXI_SMTP_PORTA',
    'MACUXI_SMTP_REMETENTE',
    'MACUXI_SMTP_SENHA',
    'MACUXI_SMTP_TLS',
    'MACUXI_SMTP_USUARIO',
  ]);
});

test('env.modelo: bloco email.env com os mesmos nomes, descomentados, e nenhum SMTP no segredos.env', () => {
  const modelo = ler('scripts/deploy/producao/env.modelo');
  const blocos = modelo.split(/^# -{5,} /m);
  const email = blocos.find((b) => b.startsWith('/opt/macuxi/email.env'));
  assert.ok(email, 'falta o bloco /opt/macuxi/email.env');
  const nomes = [...email.matchAll(/^(MACUXI_SMTP_[A-Z_]+)=$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(nomes, lidosPelaApi);
  const segredos = blocos.find((b) => b.startsWith('/opt/macuxi/segredos.env'));
  assert.doesNotMatch(segredos, /MACUXI_SMTP_/);
});

test('compose: email.env só na api e no worker, opcional', () => {
  const svc = servicos(ler('scripts/deploy/producao/compose.yml'));
  const com = [...svc].filter(([, t]) => /- path: email\.env\n\s+required: false/.test(t)).map(([n]) => n).sort();
  assert.deepEqual(com, ['api', 'worker']);
  for (const [nome, texto] of svc) if (!com.includes(nome)) assert.doesNotMatch(texto, /email\.env/, `${nome} não pode ler o email.env`);
});

test('preparar-vm.sh: email.env entra no acerto de dono e modo 600', () => {
  const linha = ler('scripts/deploy/producao/preparar-vm.sh').match(/^for f in (.*\.env.*); do$/m);
  assert.ok(linha, 'laço dos .env não encontrado');
  assert.ok(linha[1].split(/\s+/).includes('email.env'));
});

test('producao-publicar: cada MACUXI_SMTP_X vem do secret PROD_SMTP_X e vai para o email.env; sem convite do super-admin', () => {
  const { origem, texto } = workflowPublicar();
  for (const n of lidosPelaApi) {
    const sufixo = n.replace(/^MACUXI_/, '');
    assert.match(texto, new RegExp(`\\$\\{\\{ secrets\\.PROD_${sufixo} \\}\\}`), `${origem}: falta secrets.PROD_${sufixo}`);
    assert.match(texto, new RegExp(`${n}=`), `${origem}: falta gravar ${n}`);
  }
  assert.match(texto, /\| grava email\.env/);
  assert.doesNotMatch(texto, /PROD_SUPERADMIN_CONVITE|MACUXI_SUPERADMIN_CONVITE/);
});
