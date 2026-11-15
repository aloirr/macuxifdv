import { describe, expect, it } from 'vitest';
import {
  ASSUNTOS_EMAIL,
  CargaEmailSchema,
  escaparHtml,
  MARCADORES_EMAIL,
  ondeEntrar,
  renderizarEmail,
  renderizarEmailParaLog,
  renderizarEmailSemSenha,
  validarCargaEmail,
  valoresSensiveisEmail,
  VALIDADE_SENHA_PROVISORIA_HORAS,
  type CargaEmail,
  type DadosMensagemEmail,
} from './modelos';

const dados: DadosMensagemEmail = {
  nome: 'Joaquina Teste',
  empresa_nome: 'Distribuidora Rio Branco',
  codigo_empresa: 'RIOBRANCO',
  login: 'joaquina.teste@exemplo.com.br',
  senha: 'Prov1sor1a-Xq7',
  validade_horas: 72,
  apps: ['campo', 'web'],
};
const carga = { para: 'Joaquina.Teste@Exemplo.com.br', dados };
const novaSenha = { para: carga.para, dados: { ...dados, senha: 'N0va-Senh4-Kz', motivo: 'esqueci' as const } };

describe('RN-CORE-34 — "Seu acesso ao Macuxi" (design ciclo-de-senha §8.1)', () => {
  it('traz código da empresa, e-mail, senha temporária, onde entrar, troca e validade', () => {
    const r = renderizarEmail('acesso_inicial', carga);
    expect(r.assunto).toBe('Seu acesso ao Macuxi');
    for (const parte of [r.texto, r.html]) {
      expect(parte).toContain('Olá, Joaquina Teste.');
      expect(parte).toContain('Seu acesso ao Macuxi na Distribuidora Rio Branco está pronto.');
      expect(parte).toContain('RIOBRANCO');
      expect(parte).toContain('joaquina.teste@exemplo.com.br');
      expect(parte).toContain('Prov1sor1a-Xq7');
      expect(parte).toContain('vale por 72 horas');
      expect(parte).toContain('Ainda não tem o app?');
    }
    expect(r.texto).toContain('Entre no app Macuxi Campo ou no backoffice do Macuxi, pelo navegador.');
    expect(r.texto).toContain('Senha temporária: Prov1sor1a-Xq7');
    expect(r.html).toContain('monospace;font-variant-numeric:tabular-nums;font-size:18px">Prov1sor1a-Xq7</span>');
    expect(VALIDADE_SENHA_PROVISORIA_HORAS).toBe(72);
  });

  it('HTML usa a fonte do sistema e nenhum texto abaixo de 12px (R-20261115-110600)', () => {
    const r = renderizarEmail('acesso_inicial', carga);
    expect(r.html).toContain("font-family:system-ui,'Segoe UI',Roboto,-apple-system,Arial,Helvetica,sans-serif");
    expect(r.html).toContain("font-family:ui-monospace,'Cascadia Mono','Roboto Mono'");
    const tamanhos = [...r.html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
    expect(tamanhos.length).toBeGreaterThan(0);
    expect(Math.min(...tamanhos)).toBeGreaterThanOrEqual(12);
  });

  it('validade nula (admin inicial, P5): sem a frase da validade nem a do "Se ela vencer"', () => {
    const r = renderizarEmail('acesso_inicial', { ...carga, dados: { ...dados, validade_horas: null, apps: ['web'] } });
    expect(r.texto).toContain('No primeiro acesso, você cria a sua senha.');
    expect(r.texto).not.toContain('vale por');
    expect(r.texto).not.toContain('Se ela vencer');
    expect(r.texto).not.toContain('Ainda não tem o app?');
  });

  it('sem nome: "Olá."', () => {
    expect(renderizarEmail('acesso_inicial', { ...carga, dados: { ...dados, nome: '' } }).texto.startsWith('Olá.\n')).toBe(true);
  });

  it('onde entrar na ordem campo, gestão, web', () => {
    expect(ondeEntrar(['web', 'gestao'])).toBe('no app Macuxi Gestão ou no backoffice do Macuxi, pelo navegador');
  });
});

describe('RN-CORE-34 — "Sua nova senha do Macuxi" (design §8.2)', () => {
  it('esqueci: abertura do pedido e fecho "a sua senha atual continua valendo"', () => {
    const r = renderizarEmail('nova_senha', novaSenha);
    expect(r.assunto).toBe(ASSUNTOS_EMAIL.nova_senha);
    expect(r.assunto).toBe('Sua nova senha do Macuxi');
    expect(r.texto).toContain('Recebemos um pedido de senha nova para o seu acesso na Distribuidora Rio Branco.');
    expect(r.texto).toContain('Senha temporária: N0va-Senh4-Kz');
    expect(r.texto).toContain('e crie a sua senha. A senha temporária vale por 72 horas.');
    expect(r.texto).toContain('Se não foi você, ignore este e-mail: a sua senha atual continua valendo.');
  });

  it('redefinida: cita o administrador da empresa e "A senha anterior não vale mais."', () => {
    const r = renderizarEmail('nova_senha', { ...novaSenha, dados: { ...novaSenha.dados, motivo: 'redefinida' } });
    expect(r.texto).toContain('O administrador da Distribuidora Rio Branco definiu uma senha nova para você.');
    expect(r.texto).toContain('A senha anterior não vale mais.');
  });

  it('redefinida pelo suporte da Macuxi (portal): não cita o administrador da empresa', () => {
    const r = renderizarEmail('nova_senha', { ...novaSenha, dados: { ...novaSenha.dados, motivo: 'redefinida', redefinida_por: 'macuxi' } });
    expect(r.texto).toContain('O suporte da Macuxi definiu uma senha nova para o seu acesso na Distribuidora Rio Branco.');
    expect(r.texto).not.toContain('O administrador da');
    expect(r.texto).toContain('A senha anterior não vale mais.');
  });

  it('redefinida_por = empresa é o mesmo texto de sem o campo', () => {
    const sem = renderizarEmail('nova_senha', { ...novaSenha, dados: { ...novaSenha.dados, motivo: 'redefinida' } });
    const com = renderizarEmail('nova_senha', { ...novaSenha, dados: { ...novaSenha.dados, motivo: 'redefinida', redefinida_por: 'empresa' } });
    expect(com).toEqual(sem);
  });
});

describe('HTML escapado', () => {
  it('escaparHtml troca & < > " \'', () => {
    expect(escaparHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('nome, empresa e senha com marcação saem escapados no HTML (e crus no texto)', () => {
    const r = renderizarEmail('acesso_inicial', {
      ...carga,
      dados: { ...dados, nome: '<b>Zé</b> & Cia', empresa_nome: 'Loja "<script>alert(1)</script>"', senha: 'x<y>&"z\'123' },
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<b>Zé');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('x&lt;y&gt;&amp;&quot;z&#39;123</span>');
    expect(r.texto).toContain('Senha temporária: x<y>&"z\'123');
  });
});

describe('validação (Zod)', () => {
  const casos: [string, () => unknown][] = [
    ['e-mail inválido', () => renderizarEmail('acesso_inicial', { ...carga, para: 'sem-arroba' })],
    ['CRLF no nome (injeção de cabeçalho)', () => renderizarEmail('acesso_inicial', { ...carga, dados: { ...dados, nome: 'Ana\r\nBcc: x@y.z' } })],
    ['senha curta', () => renderizarEmail('acesso_inicial', { ...carga, dados: { ...dados, senha: 'curta1' } })],
    ['senha com espaço nas pontas', () => renderizarEmail('acesso_inicial', { ...carga, dados: { ...dados, senha: ' Senha12345' } })],
    ['campo a mais (strict)', () => renderizarEmail('acesso_inicial', { ...carga, dados: { ...dados, extra: 1 } })],
    ['motivo desconhecido', () => renderizarEmail('nova_senha', { ...novaSenha, dados: { ...novaSenha.dados, motivo: 'outro' } })],
    ['nova_senha sem motivo', () => renderizarEmail('nova_senha', carga)],
    ['acesso_inicial com motivo', () => renderizarEmail('acesso_inicial', novaSenha)],
    ['redefinida_por com motivo esqueci', () => renderizarEmail('nova_senha', { ...novaSenha, dados: { ...novaSenha.dados, redefinida_por: 'macuxi' } })],
    ['redefinida_por desconhecido', () => renderizarEmail('nova_senha', { ...novaSenha, dados: { ...novaSenha.dados, motivo: 'redefinida', redefinida_por: 'outro' } })],
    ['redefinida_por no acesso_inicial', () => renderizarEmail('acesso_inicial', { ...carga, dados: { ...dados, redefinida_por: 'macuxi' } })],
    ['modelo desconhecido', () => renderizarEmail('boas_vindas' as 'acesso_inicial', carga)],
    ['app desconhecido', () => renderizarEmail('acesso_inicial', { ...carga, dados: { ...dados, apps: ['portal'] } })],
  ];
  it.each(casos)('recusa: %s', (_nome, chamar) => {
    expect(chamar).toThrowError();
  });

  it('normaliza e-mail em minúsculas', () => {
    expect(validarCargaEmail('acesso_inicial', carga).para).toBe('joaquina.teste@exemplo.com.br');
  });
});

describe('RN-CORE-34 — versão de log sem dado pessoal', () => {
  const cargas: [string, 'acesso_inicial' | 'nova_senha', CargaEmail][] = [
    ['acesso_inicial', 'acesso_inicial', CargaEmailSchema.parse(carga)],
    ['nova_senha esqueci', 'nova_senha', CargaEmailSchema.parse(novaSenha)],
    ['nova_senha redefinida', 'nova_senha', CargaEmailSchema.parse({ ...novaSenha, dados: { ...novaSenha.dados, motivo: 'redefinida' } })],
    ['nova_senha redefinida pela Macuxi', 'nova_senha', CargaEmailSchema.parse({ ...novaSenha, dados: { ...novaSenha.dados, motivo: 'redefinida', redefinida_por: 'macuxi' } })],
  ];

  it.each(cargas)('%s: nenhum valor sensível aparece; marcadores no lugar', (_n, modelo, c) => {
    const sensiveis = valoresSensiveisEmail(c);
    expect(sensiveis).toContain('Joaquina Teste');
    expect(sensiveis).toContain('joaquina.teste@exemplo.com.br');
    const log = JSON.stringify(renderizarEmailParaLog(modelo, c));
    for (const v of sensiveis) expect(log).not.toContain(v);
    expect(log).toContain(MARCADORES_EMAIL.senha);
    expect(log).toContain(MARCADORES_EMAIL.email);
    expect(log).toContain(MARCADORES_EMAIL.nome);
    // o que não é pessoal continua: código da empresa e validade
    expect(log).toContain('RIOBRANCO');
    expect(log).toContain('72 horas');
  });

  it('versão sem senha: mantém nome e login, mascara só a senha', () => {
    const c = cargas[0]![2];
    const r = renderizarEmailSemSenha('acesso_inicial', c);
    expect(r.texto).toContain('Olá, Joaquina Teste.');
    expect(r.texto).toContain('E-mail: joaquina.teste@exemplo.com.br');
    expect(r.texto).toContain('Senha temporária: ********');
    expect(JSON.stringify(r)).not.toContain('Prov1sor1a-Xq7');
  });
});
