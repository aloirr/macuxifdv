import { criarPermissoes } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CODIGOS_ERRO_PERFIL_V2, CriarPerfilRequestV2Schema, EditarPerfilRequestV2Schema } from '../contracts';
import { manifest } from '../manifest';
import { rotasDePerfisV2 } from './perfis-v2';

describe('E4b: rotas de perfis pelo cargo (RN-CORE-35)', () => {
  it('RN-CORE-35: toda rota de gestão exige perfil.gerir (só as opções do cadastro seguem usuario.ver) e todas são do BKO', () => {
    for (const r of rotasDePerfisV2) {
      expect(r.acao, `${r.metodo} ${r.caminho}`).toBe(r.caminho === 'perfis/opcoes' ? 'usuario.ver' : 'perfil.gerir');
      expect(r.superficie).toBe('bko');
    }
  });
  it('RN-CORE-35: as rotas do contrato existem, com os status do ADR 0073 §4.2', () => {
    const lista = rotasDePerfisV2.map((r) => `${r.metodo} ${r.caminho} ${r.status ?? 200}`).sort();
    expect(lista).toEqual(['DELETE perfis/:codigo 204', 'GET perfis 200', 'GET perfis/:codigo 200', 'GET perfis/opcoes 200', 'GET permissoes/catalogo 200', 'POST perfis 201', 'PUT perfis/:codigo 200']);
  });
  it('RN-CORE-35: a ação das rotas existe no motor de permissões do manifesto', () => {
    const p = criarPermissoes([manifest]);
    expect(p.conhece('perfil.gerir')).toBe(true);
    expect(p.conhece('usuario.ver')).toBe(true);
  });
  it('RN-CORE-35: o PUT aceita o instante com offset e o POST exige o id do aparelho', () => {
    const base = { permissoes: [] };
    expect(EditarPerfilRequestV2Schema.safeParse({ ...base, atualizado_em: '2026-11-25T10:00:00.000-04:00' }).success).toBe(true);
    expect(EditarPerfilRequestV2Schema.safeParse({ ...base, atualizado_em: '2026-11-25T10:00:00Z' }).success).toBe(true);
    expect(EditarPerfilRequestV2Schema.safeParse({ ...base, atualizado_em: 'ontem' }).success).toBe(false);
    expect(CriarPerfilRequestV2Schema.safeParse({ nome: 'X', cargo: 'vendedor' }).success).toBe(false);
    expect(CODIGOS_ERRO_PERFIL_V2.alterado).toBe('PERFIL_ALTERADO');
  });
});
