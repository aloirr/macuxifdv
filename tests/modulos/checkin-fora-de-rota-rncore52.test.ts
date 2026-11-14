/**
 * RN-CORE-52 (PR #258, modulo-core; R-20261114-150000/150500): check-in só no cliente da rota do dia; fora da rota, só com a
 * ação `visita.checkin_fora_de_rota` no perfil de acesso (padrão ligado em todos os perfis; o BKO desliga por perfil).
 * A regra pura (`checkinPermitido`) já tem teste de unidade no módulo; aqui fica a costura entre as camadas: o manifesto
 * declara a ação com o padrão, a API revalida antes do raio e recusa com o código próprio, o app usa a MESMA regra no rodapé e
 * no check-in automático da Rota, e o BKO mostra a chave. A recusa no banco está em modules/core/api/visita.db.test.ts (CI).
 * Antes do #258 (main): a ação não existe e nada disso vale; o teste afirma esse estado.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { manifest as core } from '../../modules/core/manifest';
import { CHECKIN_NA_FICHA as com258 } from './apoio/estado-prs';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const ACAO = 'visita.checkin_fora_de_rota';

describe('RN-CORE-52 — check-in fora da rota do dia depende da ação do perfil', () => {
  if (!com258) {
    it('antes do #258: o Core não declara a ação e a API não consulta a rota no check-in', () => {
      expect(Object.keys(core.acoes ?? {})).not.toContain(ACAO);
      expect(ler('modules/core/api/visita-push.ts')).not.toContain('CHECKIN_FORA_DE_ROTA');
    });
    return;
  }

  it('o manifesto declara a ação, ligada por padrão em todos os perfis (preserva o comportamento anterior)', () => {
    const acoes = core.acoes as Record<string, { perfis: readonly string[] }>;
    expect([...acoes[ACAO]!.perfis].sort()).toEqual(['admin', 'analista', 'assistente', 'gerente', 'promotor', 'supervisor', 'vendedor']);
    expect(ler('modules/core/web/lib/perfis.ts')).toContain(`'${ACAO}': 'Check-in fora de rota'`);
  });

  it('a API revalida (a ação do perfil e a rota do dia no fuso do tenant) depois da carteira e antes do raio, e recusa com CHECKIN_FORA_DE_ROTA', () => {
    const api = ler('modules/core/api/visita-push.ts');
    expect(api).toContain('pode(ctx.usuario.perfis, ACAO_CHECKIN_FORA_DE_ROTA)');
    expect(api).toContain('dataLocal(p.checkin_em, ctx.fuso())');
    expect(api).toMatch(/r\.situacao <> 'cancelada'/);
    const corpo = api.slice(api.indexOf('export async function receberCheckins('));
    const carteira = corpo.indexOf("'FORA_DA_CARTEIRA'");
    const rota = corpo.indexOf('rejeitado(item.id, CODIGO_CHECKIN_FORA_DE_ROTA, MENSAGEM_CHECKIN_FORA_DE_ROTA)');
    const raio = corpo.indexOf("'RN-CORE-10'");
    expect(carteira).toBeGreaterThan(0);
    expect(rota).toBeGreaterThan(carteira);
    expect(raio).toBeGreaterThan(rota);
  });

  it('o app usa a mesma regra offline: sem a ação e fora da rota, nem o botão Check-in nem o check-in automático da Rota', () => {
    const tela = ler('modules/core/app/telas/cliente.tsx');
    expect(tela).toContain('usePode(ACAO_CHECKIN_FORA_DE_ROTA)');
    expect(tela).toMatch(/botoesDoRodapeCliente\(\{ temPesquisa: Boolean\(PesquisaComp\), atendimentoAqui: openHere, checkinPermitido: checkinLiberado( && !visited \}|, visitadoHoje: visited \})\)/);
    expect(tela).toMatch(/const checkinLiberado = checkinPermitido\(\{[^}]*podeForaDeRota \}\)(\.permitido)?;/);
    expect(tela).toMatch(/else if \((!openHere && !visited && checkinLiberado|botoes\.checkin)\) void startCheckin\(\);/);
  });
});
