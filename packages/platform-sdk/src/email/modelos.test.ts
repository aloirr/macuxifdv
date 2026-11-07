import { describe, expect, it } from 'vitest';
import {
  ASSUNTOS_EMAIL,
  escaparHtml,
  MARCADORES_EMAIL,
  PedidoEmailSchema,
  renderizarEmail,
  renderizarEmailParaLog,
  renderizarEmailSemSenha,
  renderizarPedidoEmail,
  validarPedidoEmail,
  valoresSensiveisEmail,
  VALIDADE_SENHA_PROVISORIA_HORAS,
  type DadosAcessoInicial,
  type DadosNovaSenha,
  type PedidoEmail,
} from './modelos';

const destinatario = { email: 'Joaquina.Teste@Exemplo.com.br', nome: 'Joaquina Teste' };
const acesso: DadosAcessoInicial = {
  empresa: 'Distribuidora Rio Branco',
  codigoEmpresa: 'RIOBRANCO',
  login: 'joaquina.teste@exemplo.com.br',
  senhaInicial: 'Prov1sor1a-Xq7',
  urlAcesso: 'https://bko.macuxifdv.com.br',
};
const novaSenha: DadosNovaSenha = {
  empresa: 'Distribuidora Rio Branco',
  codigoEmpresa: 'RIOBRANCO',
  login: 'joaquina.teste@exemplo.com.br',
  senhaProvisoria: 'N0va-Senh4-Kz',
  motivo: 'esqueci',
};

describe('RN-CORE-32 — "Seu acesso ao Macuxi"', () => {
  it('traz código da empresa, login, senha inicial, validade de 72 h e troca no 1º acesso', () => {
    const r = renderizarEmail('acesso_inicial', destinatario, acesso);
    expect(r.assunto).toBe('Seu acesso ao Macuxi');
    for (const parte of [r.texto, r.html]) {
      expect(parte).toContain('RIOBRANCO');
      expect(parte).toContain('joaquina.teste@exemplo.com.br');
      expect(parte).toContain('Prov1sor1a-Xq7');
      expect(parte).toContain('72 h');
      expect(parte).toContain('trocada no 1º acesso');
      expect(parte).toContain('Olá, Joaquina.');
      expect(parte).toContain('https://bko.macuxifdv.com.br');
    }
    expect(r.html).toContain('<strong>Prov1sor1a-Xq7</strong>');
    expect(VALIDADE_SENHA_PROVISORIA_HORAS).toBe(72);
  });

  it('sem urlAcesso não mostra a linha "Acesse"', () => {
    const { urlAcesso: _u, ...semUrl } = acesso;
    expect(renderizarEmail('acesso_inicial', destinatario, semUrl).texto).not.toContain('Acesse');
  });
});

describe('RN-CORE-33 — "Sua nova senha"', () => {
  it('esqueci a senha: senha provisória, mesmas regras de validade e troca', () => {
    const r = renderizarEmail('nova_senha', destinatario, novaSenha);
    expect(r.assunto).toBe(ASSUNTOS_EMAIL.nova_senha);
    expect(r.assunto).toBe('Sua nova senha');
    expect(r.texto).toContain('Recebemos o pedido de nova senha');
    expect(r.texto).toContain('Senha provisória: N0va-Senh4-Kz');
    expect(r.texto).toContain('Código da empresa: RIOBRANCO');
    expect(r.texto).toContain('72 h');
    expect(r.texto).toContain('trocada no 1º acesso');
    expect(r.texto).toContain('A senha anterior deixou de valer.');
  });

  it('redefinição pelo BKO cita o administrador da empresa', () => {
    const r = renderizarEmail('nova_senha', destinatario, { ...novaSenha, motivo: 'redefinicao_bko' });
    expect(r.texto).toContain('O administrador de Distribuidora Rio Branco redefiniu a senha');
  });
});

describe('HTML escapado', () => {
  it('escaparHtml troca & < > " \'', () => {
    expect(escaparHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('nome, empresa e senha com marcação saem escapados no HTML (e crus no texto)', () => {
    const r = renderizarEmail('acesso_inicial', { email: 'a@b.com', nome: '<b>Zé</b> & Cia' }, {
      ...acesso,
      empresa: 'Loja "<script>alert(1)</script>"',
      senhaInicial: 'x<y>&"z\'123',
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<b>Zé');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('<strong>x&lt;y&gt;&amp;&quot;z&#39;123</strong>');
    expect(r.texto).toContain('Senha inicial: x<y>&"z\'123');
  });
});

describe('validação (Zod)', () => {
  const casos: [string, () => unknown][] = [
    ['e-mail inválido', () => renderizarEmail('acesso_inicial', { ...destinatario, email: 'sem-arroba' }, acesso)],
    ['nome vazio', () => renderizarEmail('acesso_inicial', { ...destinatario, nome: '  ' }, acesso)],
    ['CRLF no nome (injeção de cabeçalho)', () => renderizarEmail('acesso_inicial', { ...destinatario, nome: 'Ana\r\nBcc: x@y.z' }, acesso)],
    ['senha curta', () => renderizarEmail('acesso_inicial', destinatario, { ...acesso, senhaInicial: 'curta1' })],
    ['senha com espaço nas pontas', () => renderizarEmail('acesso_inicial', destinatario, { ...acesso, senhaInicial: ' Senha12345' })],
    ['url javascript:', () => renderizarEmail('acesso_inicial', destinatario, { ...acesso, urlAcesso: 'javascript:alert(1)' })],
    ['campo a mais (strict)', () => renderizarEmail('acesso_inicial', destinatario, { ...acesso, extra: 1 } as DadosAcessoInicial)],
    ['motivo desconhecido', () => renderizarEmail('nova_senha', destinatario, { ...novaSenha, motivo: 'outro' as 'esqueci' })],
    ['dados do modelo errado', () => renderizarEmail('nova_senha', destinatario, acesso as unknown as DadosNovaSenha)],
    ['modelo desconhecido', () => validarPedidoEmail('boas_vindas' as 'acesso_inicial', destinatario, acesso)],
  ];
  it.each(casos)('recusa: %s', (_nome, chamar) => {
    expect(chamar).toThrowError();
  });

  it('normaliza e-mail em minúsculas e preenche a validade padrão', () => {
    const p = validarPedidoEmail('acesso_inicial', destinatario, acesso);
    expect(p.destinatario.email).toBe('joaquina.teste@exemplo.com.br');
    expect(p.dados.validadeHoras).toBe(72);
  });

  it('renderizarPedidoEmail revalida o que sai da fila', () => {
    const p = validarPedidoEmail('nova_senha', destinatario, novaSenha);
    expect(renderizarPedidoEmail(p).assunto).toBe('Sua nova senha');
    expect(() => renderizarPedidoEmail({ ...p, destinatario: { ...p.destinatario, email: 'x' } })).toThrowError();
  });
});

describe('RN-CORE-34 — versão de log sem dado pessoal', () => {
  const pedidos: PedidoEmail[] = [
    PedidoEmailSchema.parse({ modelo: 'acesso_inicial', destinatario, dados: acesso }),
    PedidoEmailSchema.parse({ modelo: 'nova_senha', destinatario, dados: novaSenha }),
    PedidoEmailSchema.parse({ modelo: 'nova_senha', destinatario, dados: { ...novaSenha, motivo: 'redefinicao_bko' } }),
  ];

  it.each(pedidos.map((p) => [p.modelo, p] as const))('%s: nenhum valor sensível aparece; marcadores no lugar', (_m, pedido) => {
    const sensiveis = valoresSensiveisEmail(pedido);
    expect(sensiveis).toContain('Joaquina');
    expect(sensiveis).toContain('joaquina.teste@exemplo.com.br');
    const log = JSON.stringify(renderizarEmailParaLog(pedido));
    for (const v of sensiveis) expect(log).not.toContain(v);
    expect(log).toContain(MARCADORES_EMAIL.senha);
    expect(log).toContain(MARCADORES_EMAIL.email);
    expect(log).toContain(MARCADORES_EMAIL.nome);
    // o que não é pessoal continua: código da empresa e validade
    expect(log).toContain('RIOBRANCO');
    expect(log).toContain('72 h');
  });

  it('versão sem senha: mantém nome e login, mascara só a senha', () => {
    const p = pedidos[0]!;
    const r = renderizarEmailSemSenha(p);
    expect(r.texto).toContain('Olá, Joaquina.');
    expect(r.texto).toContain('Login: joaquina.teste@exemplo.com.br');
    expect(r.texto).toContain('Senha inicial: ********');
    expect(JSON.stringify(r)).not.toContain('Prov1sor1a-Xq7');
  });
});
