/**
 * T-0176 — RN-CORE-39 revista (R-20261115-073000 e R-20261115-080000), SEM banco: o caminho da filial do vendedor entre módulos —
 * Hub (`VendedorPayload.filial_external_id`, `validarLinhas`, ordem e referências) → evento `integracao.vendedor.atualizado@1` → Core
 * (consumidor tolerante, regra do domain por cargo). A API com Postgres está em tests/integracao/api/filial-vendedor-rncore39.test.ts.
 * Matriz: docs/testes/T-0176.md.
 *
 * Vale nos dois estados do repositório (tests/modulos/apoio/estado-prs.ts). O que ainda não está no main fica em bloco cujo nome diz
 * qual PR espera; as funções novas são lidas do índice do domain (que já existe no main), para o typecheck do main não depender delas.
 */
import { describe, expect, it } from 'vitest';
import * as dominioCore from '../../modules/core/domain';
import { consumidorVendedorDoErp } from '../../modules/core/api/consumidores-erp-vendedor';
import { ordenarCarga, validarLinhas, verificarReferencias } from '../../modules/integracao/domain';
import { FILIAL_USUARIO_BANCO, FILIAL_USUARIO_CORE, VENDEDOR_FILIAL_HUB } from './apoio/estado-prs';

const F1 = '0f176000-0000-4000-8000-000000000001';
const F2 = '0f176000-0000-4000-8000-000000000002';
const F3 = '0f176000-0000-4000-8000-000000000003';
const BASE = { external_id: 'V-T176', alterado_em: '2026-11-15T12:00:00Z', nome: 'Vendedor Fictício' };

type ErroFilial = { codigo: string; mensagem: string } | null;
interface DominioFilial {
  validarFiliaisDoUsuario(cargo: string | null, filiais: readonly string[]): ErroFilial;
  vendedorBloqueadoPorFilial(u: { cargo: string | null; filiais: readonly string[] }): boolean;
}
const dominio = dominioCore as unknown as Partial<DominioFilial>;

describe('T-0176 RN-CORE-39 — estado dos PRs', () => {
  it('RN-CORE-39: o Core da T-0176 só entra no main junto com (ou depois de) a 0077 — sem a tabela, o login do vendedor e o pull `usuario` quebram', () => {
    // modules/core/api/filiais-usuario.ts (login: vendedorSemFilial) e sync.ts (pull `usuario`) leem core.usuario_filial
    expect(!FILIAL_USUARIO_CORE || FILIAL_USUARIO_BANCO).toBe(true);
  });
});

describe.runIf(FILIAL_USUARIO_CORE)('T-0176 RN-CORE-39 — regra por cargo no domain do Core [aguarda merge: nuvem/filial-usuario-modulo-core]', () => {
  const validar = (cargo: string | null, filiais: readonly string[]) => dominio.validarFiliaisDoUsuario!(cargo, filiais);

  it.each([
    [0, [] as string[]],
    [2, [F1, F2]],
    [3, [F1, F2, F3]],
  ] as const)('RN-CORE-39 (critério a): vendedor com %i filiais = USUARIO_FILIAL_QUANTIDADE "Escolha a filial do vendedor."', (_n, filiais) => {
    expect(validar('vendedor', filiais)).toEqual({ codigo: 'USUARIO_FILIAL_QUANTIDADE', mensagem: 'Escolha a filial do vendedor.' });
  });

  it('RN-CORE-39 (limite): vendedor com exatamente 1 = válido; a mesma repetida conta uma', () => {
    expect(validar('vendedor', [F1])).toBeNull();
    expect(validar('vendedor', [F1, F1])).toBeNull();
  });

  it.each(['supervisor', 'promotor', 'gerente'])('RN-CORE-39 (critério c): %s com 1, 2 ou 3 filiais = válido; com 0 = "Escolha ao menos uma filial."', (cargo) => {
    for (const filiais of [[F1], [F1, F2], [F1, F2, F3]]) expect(validar(cargo, filiais)).toBeNull();
    expect(validar(cargo, [])).toEqual({ codigo: 'USUARIO_FILIAL_QUANTIDADE', mensagem: 'Escolha ao menos uma filial.' });
  });

  it('RN-CORE-39 (critério b): só o vendedor sem filial fica bloqueado; com filial, ou de outro cargo sem filial, não', () => {
    const bloqueado = dominio.vendedorBloqueadoPorFilial!;
    expect(bloqueado({ cargo: 'vendedor', filiais: [] })).toBe(true);
    expect(bloqueado({ cargo: 'vendedor', filiais: [F1] })).toBe(false);
    for (const cargo of ['supervisor', 'promotor', 'gerente', 'administrativo', null]) expect(bloqueado({ cargo, filiais: [] }), String(cargo)).toBe(false);
  });
});

describe.runIf(VENDEDOR_FILIAL_HUB)('T-0176 RN-CORE-39 — carga do vendedor no Hub [aguarda merge: nuvem/marca-codigo-modulo-integracao]', () => {
  it('RN-CORE-39: vendedor com filial_external_id é válido, sem aviso, e a filial segue no registro que vai no evento', () => {
    const r = validarLinhas('vendedor', [{ ...BASE, filial_external_id: 'FIL-1' }]);
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.validas[0]?.registro).toMatchObject({ filial_external_id: 'FIL-1' });
  });

  it.each([
    ['ausente', {}],
    ['null', { filial_external_id: null }],
  ])('RN-CORE-39: vendedor com filial %s entra (não é erro) com o aviso vendedor_sem_filial, frase clara', (_rotulo, extra) => {
    const r = validarLinhas('vendedor', [{ ...BASE, ...extra }]);
    expect(r.erros).toEqual([]);
    expect(r.validas).toHaveLength(1);
    expect(r.avisos).toEqual([expect.objectContaining({ indice: 0, external_id: 'V-T176', codigo: 'vendedor_sem_filial' })]);
    expect(r.avisos[0]!.mensagem).toMatch(/filial/i);
  });

  it('RN-CORE-39 (critério a): 2 filiais na linha (lista) = linha com erro no campo filial_external_id, não aplicada', () => {
    const r = validarLinhas('vendedor', [{ ...BASE, filial_external_id: ['FIL-1', 'FIL-2'] }]);
    expect(r.validas).toEqual([]);
    expect(r.erros).toEqual([expect.objectContaining({ indice: 0, external_id: 'V-T176', campo: 'filial_external_id', reprocessavel: false })]);
  });

  it('RN-CORE-39: filial_external_id vazio ("") = linha com erro no campo (não vira "sem filial")', () => {
    const r = validarLinhas('vendedor', [{ ...BASE, filial_external_id: '' }]);
    expect(r.validas).toEqual([]);
    expect(r.erros.map((e) => e.campo)).toEqual(['filial_external_id']);
  });

  it('RN-CORE-39 × RN-INT-04: filial que o Hub não tem = referencia_ausente reprocessável; a filial vai antes do vendedor na carga', () => {
    const v = validarLinhas('vendedor', [{ ...BASE, filial_external_id: 'FIL-NAO' }, { ...BASE, external_id: 'V-T176-B', filial_external_id: 'FIL-1' }]);
    const ref = verificarReferencias('vendedor', v.validas, { filial: new Set(['FIL-1']) });
    expect(ref.aceitas.map((l) => l.external_id)).toEqual(['V-T176-B']);
    expect(ref.erros).toEqual([expect.objectContaining({ external_id: 'V-T176', codigo: 'referencia_ausente', campo: 'filial_external_id', reprocessavel: true })]);
    const ordem = ordenarCarga(['vendedor', 'filial']);
    expect(ordem.ok && ordem.ordem).toEqual(['filial', 'vendedor']);
  });
});

describe.runIf(VENDEDOR_FILIAL_HUB && FILIAL_USUARIO_CORE)('T-0176 RN-CORE-39 — Hub → evento → Core [aguarda merge: nuvem/marca-codigo-modulo-integracao + nuvem/filial-usuario-modulo-core]', () => {
  it('RN-CORE-39: o registro validado pelo Hub chega ao consumidor do Core com filial_external_id (o evento tolerante não descarta o campo)', () => {
    const r = validarLinhas('vendedor', [{ ...BASE, filial_external_id: 'FIL-1' }]);
    const payload = { lote_id: '0e176000-0000-4000-8000-000000000001', entidade: 'vendedor', external_id: 'V-T176', acao: 'criado', hash: r.validas[0]!.hash, registro: r.validas[0]!.registro, ocorrido_em: BASE.alterado_em };
    const lido = consumidorVendedorDoErp.evento.schema.parse(payload) as { registro: Record<string, unknown> };
    expect(lido.registro.filial_external_id).toBe('FIL-1');
  });
});
