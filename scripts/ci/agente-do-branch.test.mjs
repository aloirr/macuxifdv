// Agente declarado no branch da nuvem × trailer "Agente:" (ADR 0045). node --test scripts/ci/agente-do-branch.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agenteDeclaradoNoBranch, conferirAgenteDoBranch } from './agente-do-branch.mjs';

const c = (agente, sha = 'abc1234') => ({ sha, assunto: 'x', corpo: `T-0170: x\n\nAgente: ${agente}\n` });
const niveis = (r) => r.anotacoes.map((a) => a.nivel);

test('declaração explícita: nuvem/<assunto>--<agente>', () => {
  assert.deepEqual(agenteDeclaradoNoBranch('nuvem/T-0170-migracao--engenheiro-software'), { agente: 'engenheiro-software', forma: 'explicita' });
  assert.deepEqual(agenteDeclaradoNoBranch('refs/heads/nuvem/x--Modulo-Core'), { agente: 'modulo-core', forma: 'explicita' });
  assert.deepEqual(agenteDeclaradoNoBranch('nuvem/a--b--testes'), { agente: 'testes', forma: 'explicita' }, 'vale o último --');
  assert.match(agenteDeclaradoNoBranch('nuvem/x--alexandre').erro, /nunca dá a identidade alexandre/);
  assert.match(agenteDeclaradoNoBranch('nuvem/x--fulano').erro, /não é um agente do time/);
});

test('sufixo de um hífen: o agente mais longo que casa; sem casar, nada', () => {
  assert.deepEqual(agenteDeclaradoNoBranch('nuvem/migracao-nuvem-engenheiro-software'), { agente: 'engenheiro-software', forma: 'sufixo' });
  assert.deepEqual(agenteDeclaradoNoBranch('nuvem/T-0170-ajuste-testes'), { agente: 'testes', forma: 'sufixo' });
  assert.deepEqual(agenteDeclaradoNoBranch('nuvem/T-0170-sync'), { agente: null, forma: null });
  assert.deepEqual(agenteDeclaradoNoBranch('modulo-core/T-0003-x'), { agente: null, forma: null }, 'fora de nuvem/*');
});

test('explícito + trailer igual = ok; trailer de outro (alexandre inclusive) = vermelho', () => {
  assert.deepEqual(conferirAgenteDoBranch({ branch: 'nuvem/x--modulo-core', commits: [c('modulo-core')] }), { codigo: 0, anotacoes: [] });
  const outro = conferirAgenteDoBranch({ branch: 'nuvem/x--modulo-core', commits: [c('engenheiro-software')] });
  assert.equal(outro.codigo, 1);
  assert.deepEqual(niveis(outro), ['error']);
  const alex = conferirAgenteDoBranch({ branch: 'nuvem/x--modulo-core', commits: [c('alexandre')] });
  assert.equal(alex.codigo, 1);
  assert.deepEqual(niveis(alex), ['error', 'warning']);
});

test('sufixo inválido ou --alexandre = vermelho mesmo sem trailer', () => {
  assert.equal(conferirAgenteDoBranch({ branch: 'nuvem/x--alexandre', commits: [c('modulo-core')] }).codigo, 1);
  assert.equal(conferirAgenteDoBranch({ branch: 'nuvem/x--fulano', commits: [] }).codigo, 1);
});

test('sufixo de um hífen com trailer de outro = só aviso (pode ser o fim do assunto)', () => {
  const r = conferirAgenteDoBranch({ branch: 'nuvem/T-0170-ajuste-testes', commits: [c('modulo-vendedor')] });
  assert.equal(r.codigo, 0);
  assert.deepEqual(niveis(r), ['warning']);
});

test('trailer alexandre num nuvem/* sem declaração = aviso do rito; trailer ausente = só registro', () => {
  const r = conferirAgenteDoBranch({ branch: 'nuvem/T-0171-guardiao', commits: [c('alexandre')] });
  assert.equal(r.codigo, 0);
  assert.deepEqual(niveis(r), ['warning']);
  const sem = conferirAgenteDoBranch({ branch: 'nuvem/x--modulo-core', commits: [{ sha: 'a', corpo: 'sem trailer' }] });
  assert.equal(sem.codigo, 0);
  assert.deepEqual(niveis(sem), ['notice']);
});

test('branch fora de nuvem/* não é conferido aqui (o verificar cobre)', () => {
  assert.deepEqual(conferirAgenteDoBranch({ branch: 'modulo-core/T-0003-x', commits: [c('testes')] }), { codigo: 0, anotacoes: [] });
});
