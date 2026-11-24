import { describe, expect, it } from 'vitest';
import { trocarMinhaSenha } from './trocar-senha';

const sessao = {
  access_token: 'a',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'r'.repeat(20),
  usuario: {
    id: '0b000000-0000-4000-8000-000000000001',
    nome: 'Vera',
    nome_curto: null,
    email: 'v@x.com',
    perfil: 'vendedor',
  },
  tenant: {
    id: '0a000000-0000-4000-8000-0000000000aa',
    codigo: 'AM4821',
    nome: 'Alfa',
    fuso: 'America/Manaus',
  },
};

describe('RN-CORE-34: trocarMinhaSenha monta o corpo e devolve a sessão nova', () => {
  it('RN-CORE-34: envia codigo, e-mail, atual, nova, app e aparelho; nada de confirmação; devolve a sessão', async () => {
    let enviado: { caminho: string; corpo: Record<string, unknown> } | null = null;
    const r = await trocarMinhaSenha(
      async (caminho, corpo) => {
        enviado = { caminho, corpo: corpo as Record<string, unknown> };
        return sessao;
      },
      { codigoEmpresa: ' am4821 ', email: ' v@x.com ' },
      { senha_atual: 'Atual#123', senha_nova: 'Boa#Senha1' },
      'campo',
      { id: '0c000000-0000-4000-8000-000000000001' },
    );
    expect(r.usuario.email).toBe('v@x.com');
    expect(enviado!.caminho).toBe('/auth/senha/trocar');
    expect(enviado!.corpo).toMatchObject({
      codigo_empresa: 'AM4821',
      email: 'v@x.com',
      senha_atual: 'Atual#123',
      senha_nova: 'Boa#Senha1',
      app: 'campo',
      dispositivo_id: '0c000000-0000-4000-8000-000000000001',
    });
    expect(Object.keys(enviado!.corpo)).not.toContain('repita');
  });
});
