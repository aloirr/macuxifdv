/**
 * Menu do usuário (v1.0.34; R-20261124-083005, 083110 e 083356), renderizado com `react-dom/server`: o botão acessível com o nome,
 * o perfil e o cargo (no portal, o nome da sessão, ADR 0075); as gavetas "Dados cadastrais" (só leitura) e "Trocar a senha". A abertura,
 * as setas, o Esc e o Sair estão no e2e (apps/web/e2e/portal-menu-usuario.spec.ts e bko-menu-usuario.spec.ts).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { identidadeDoBko, identidadeDoPortal } from '@/lib/menu-usuario';

import { GavetaDadosCadastrais, GavetaTrocarSenha, MenuUsuario } from './menu-usuario';

const bko = identidadeDoBko({ name: 'Ana Souza', email: 'ana@uma.com.br', perfil: 'admin' }, 'Distribuidora Uma');
const nada = () => undefined;

describe('MenuUsuario', () => {
  it('botão fechado: aria-haspopup="menu", aria-expanded=false, nome e "perfil · cargo"; sem a lista', () => {
    const html = renderToStaticMarkup(<MenuUsuario identidade={bko} onSair={nada} tom="claro" />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Menu do usuário: Ana Souza, Admin · Administrativo"');
    expect(html).toContain('>Ana Souza<');
    expect(html).toContain('>Admin · Administrativo<');
    expect(html).not.toContain('menu-usuario.lista');
    // a empresa não vai no botão (o BKO já a mostra na marca do menu)
    expect(html).not.toContain('Distribuidora Uma');
  });

  it('portal, time Macuxi: o nome e, embaixo, "Time Macuxi" (ADR 0075); sem o nome (API anterior), só "Time Macuxi"', () => {
    const html = renderToStaticMarkup(<MenuUsuario identidade={identidadeDoPortal({ tipo: 'super_admin', empresa: null, usuario: { nome: 'Carla Menezes', perfil: null, cargo: null } })} onSair={nada} tom="escuro" />);
    expect(html).toContain('>Carla Menezes<');
    expect(html).toContain('>Time Macuxi<');
    expect(html).toContain('aria-label="Menu do usuário: Carla Menezes, Time Macuxi"');
    const antigo = renderToStaticMarkup(<MenuUsuario identidade={identidadeDoPortal({ tipo: 'super_admin', empresa: null })} onSair={nada} tom="escuro" />);
    expect(antigo).toContain('>Time Macuxi<');
    expect(antigo).not.toContain('menu-usuario.detalhe');
  });
});

describe('gavetas', () => {
  it('Dados cadastrais: nome, e-mail, perfil, cargo e empresa, só leitura', () => {
    const html = renderToStaticMarkup(<GavetaDadosCadastrais aberta identidade={bko} onFechar={nada} />);
    expect(html).toContain('Dados cadastrais');
    for (const v of ['Ana Souza', 'ana@uma.com.br', 'Admin', 'Administrativo', 'Distribuidora Uma']) expect(html).toContain(v);
    expect(html).not.toContain('<input');
  });

  it('Trocar a senha do BKO: senha atual, nova e repetição, a lista de regras, Cancelar e Salvar senha; sem e-mail nem código', () => {
    const html = renderToStaticMarkup(<GavetaTrocarSenha aberta troca={{ enviar: async () => true }} onFechar={nada} onTrocada={nada} />);
    for (const t of ['trocar-senha.atual', 'trocar-senha.nova', 'trocar-senha.repita', 'trocar-senha.regras', 'trocar-senha.cancelar', 'trocar-senha.salvar']) expect(html).toContain(`data-testid="${t}"`);
    expect(html).toContain('Senha atual');
    expect(html).toContain('Salvar senha');
    expect(html).not.toContain('trocar-senha.email');
    expect(html).not.toContain('trocar-senha.codigo');
  });

  it('sessão antiga do BKO: pede o código da empresa (sem o e-mail); admin do cliente no portal: pede o e-mail (sem o código)', () => {
    const bko = renderToStaticMarkup(<GavetaTrocarSenha aberta troca={{ pedirCodigo: true, enviar: async () => true }} onFechar={nada} onTrocada={nada} />);
    expect(bko).toContain('trocar-senha.codigo');
    expect(bko).not.toContain('trocar-senha.email');
    const portal = renderToStaticMarkup(<GavetaTrocarSenha aberta troca={{ pedirEmail: true, enviar: async () => true }} onFechar={nada} onTrocada={nada} />);
    expect(portal).toContain('trocar-senha.email');
    expect(portal).not.toContain('trocar-senha.codigo');
  });
});
