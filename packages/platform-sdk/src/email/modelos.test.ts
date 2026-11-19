import { describe, expect, it } from 'vitest';
import { PILHA_MONO_EMAIL, PILHA_SISTEMA_EMAIL } from '@macuxi/comum/fonte';
import {
  ASSUNTOS_EMAIL,
  CargaEmailSchema,
  escaparHtml,
  MARCADORES_EMAIL,
  ondeEntrar,
  renderizarEmail,
  renderizarEmailParaLog,
  renderizarEmailSemSenha,
  RODAPE_EMAIL,
  TEXTO_ALTERNATIVO_LOGO,
  validarCargaEmail,
  valoresSensiveisEmail,
  VALIDADE_SENHA_PROVISORIA_HORAS,
  type CargaEmail,
  type DadosMensagemEmail,
  type OpcoesApresentacaoEmail,
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
const redefinida = { ...novaSenha, dados: { ...novaSenha.dados, motivo: 'redefinida' as const } };
const LOGO = 'https://bko.exemplo.com.br/email/macuxi-logo-positivo-email.png';
const LOGO_ESCURO = 'https://bko.exemplo.com.br/email/macuxi-logo-negativo-email.png';
const BKO = 'https://bko.exemplo.com.br/';
const comTudo: OpcoesApresentacaoEmail = { urlLogo: LOGO, urlLogoEscuro: LOGO_ESCURO, urlBackoffice: BKO };

/** Frases que saíram do e-mail (docs/design/emails/redefinir-senha.md §1): não voltam em nenhum modelo. */
const FRASES_QUE_SAIRAM = [
  'Olá',
  'Joaquina Teste',
  'A senha anterior não vale mais.',
  'Se ela vencer',
  'a sua senha atual continua valendo',
  'e-mail automático, não responda',
  'Sua nova senha',
  'pelo navegador',
  'definiu uma senha nova',
];

describe('RN-CORE-34 — assunto, título e contexto (docs/design/emails/redefinir-senha.md §3)', () => {
  it('assuntos: "Seu acesso ao Macuxi" e "Sua senha temporária do Macuxi"', () => {
    expect(ASSUNTOS_EMAIL).toEqual({ acesso_inicial: 'Seu acesso ao Macuxi', nova_senha: 'Sua senha temporária do Macuxi' });
    expect(renderizarEmail('nova_senha', novaSenha).assunto).toBe('Sua senha temporária do Macuxi');
    expect(renderizarEmail('acesso_inicial', carga).html).toContain('<title>Seu acesso ao Macuxi</title>');
  });

  it('nova_senha · redefinida (BKO): contexto do administrador da empresa', () => {
    const r = renderizarEmail('nova_senha', { ...redefinida, dados: { ...redefinida.dados, apps: ['campo'] } });
    expect(r.texto.split('\n').slice(0, 3)).toEqual([
      'Crie a sua senha no app Macuxi Campo',
      '',
      'O administrador da Distribuidora Rio Branco redefiniu a sua senha.',
    ]);
  });

  it('nova_senha · redefinida pelo suporte da Macuxi (portal): não cita o administrador', () => {
    const r = renderizarEmail('nova_senha', { ...redefinida, dados: { ...redefinida.dados, redefinida_por: 'macuxi' } });
    expect(r.texto).toContain('O suporte da Macuxi redefiniu a sua senha na Distribuidora Rio Branco.');
    expect(r.texto).not.toContain('O administrador da');
  });

  it('redefinida_por = empresa é o mesmo e-mail de sem o campo', () => {
    const com = renderizarEmail('nova_senha', { ...redefinida, dados: { ...redefinida.dados, redefinida_por: 'empresa' } });
    expect(com).toEqual(renderizarEmail('nova_senha', redefinida));
  });

  it('nova_senha · esqueci: o "ignore" sobe para o contexto, sem o texto de garantia', () => {
    const r = renderizarEmail('nova_senha', novaSenha);
    expect(r.texto).toContain('Foi pedida uma senha nova para o seu acesso na Distribuidora Rio Branco. Se não foi você, ignore este e-mail.');
  });

  it('acesso_inicial: "criou o seu acesso" e, só com app no destino, "Ainda não tem o app?"', () => {
    expect(renderizarEmail('acesso_inicial', carga).texto).toContain(
      'A Distribuidora Rio Branco criou o seu acesso. Ainda não tem o app? Peça ao administrador da sua empresa.',
    );
    const soWeb = renderizarEmail('acesso_inicial', { ...carga, dados: { ...dados, apps: ['web'] } });
    expect(soWeb.texto).toContain('A Distribuidora Rio Branco criou o seu acesso.\n');
    expect(soWeb.texto).not.toContain('Ainda não tem o app?');
  });

  it.each([
    ['acesso_inicial', carga],
    ['nova_senha esqueci', novaSenha],
    ['nova_senha redefinida', redefinida],
  ] as const)('%s: nenhuma das frases que saíram (nem o nome no corpo)', (_n, c) => {
    const modelo = 'motivo' in c.dados ? 'nova_senha' : 'acesso_inicial';
    const r = renderizarEmail(modelo, c, comTudo);
    for (const frase of FRASES_QUE_SAIRAM) {
      expect(r.texto, frase).not.toContain(frase);
      expect(r.html, frase).not.toContain(frase);
    }
  });
});

describe('RN-CORE-34 — destino conforme o perfil (spec §4)', () => {
  it.each([
    [['campo'], 'Crie a sua senha no app Macuxi Campo'],
    [['gestao'], 'Crie a sua senha no app Macuxi Gestão'],
    [['gestao', 'web'], 'Crie a sua senha no app Macuxi Gestão ou no backoffice'],
    [['web'], 'Crie a sua senha no backoffice'],
    [['web', 'campo'], 'Crie a sua senha no app Macuxi Campo ou no backoffice'],
    [[], 'Crie a sua senha no Macuxi'],
  ] as const)('apps %j → "%s" (título no texto e no HTML)', (apps, titulo) => {
    for (const [modelo, c] of [
      ['acesso_inicial', carga],
      ['nova_senha', redefinida],
    ] as const) {
      const r = renderizarEmail(modelo, { ...c, dados: { ...c.dados, apps: [...apps] } });
      expect(r.texto.startsWith(`${titulo}\n\n`)).toBe(true);
      expect(r.html).toContain(`class="mx-titulo"`);
      expect(r.html).toContain(`>${titulo}</td>`);
    }
  });

  it('ondeEntrar: ordem campo, gestão, web; sem destino = "no Macuxi"', () => {
    expect(ondeEntrar(['web', 'gestao'])).toBe('no app Macuxi Gestão ou no backoffice');
    expect(ondeEntrar([])).toBe('no Macuxi');
  });

  it('botão "Abrir o backoffice" só com web no destino E o endereço configurado', () => {
    const web = { ...redefinida, dados: { ...redefinida.dados, apps: ['web' as const] } };
    const com = renderizarEmail('nova_senha', web, { urlBackoffice: BKO });
    expect(com.html).toContain(`<a class="mx-botao-txt" href="${BKO}"`);
    expect(com.html).toContain('>Abrir o backoffice</a>');
    expect(com.texto).toContain(`\nAbrir o backoffice: ${BKO}\n`);
    for (const r of [
      renderizarEmail('nova_senha', web),
      renderizarEmail('nova_senha', { ...web, dados: { ...web.dados, apps: ['campo'] } }, { urlBackoffice: BKO }),
    ]) {
      expect(r.html).not.toContain('Abrir o backoffice');
      expect(r.html).not.toContain('<a ');
      expect(r.texto).not.toContain('Abrir o backoffice');
    }
  });
});

describe('RN-CORE-34 — bloco de dados, validade e rodapé (spec §2 e §3)', () => {
  it('cada valor numa linha só dele, selecionável; a senha é a maior coisa do bloco, em ênfase 600', () => {
    const r = renderizarEmail('nova_senha', redefinida);
    expect(r.texto).toContain('\nCódigo da empresa\nRIOBRANCO\n\nE-mail\njoaquina.teste@exemplo.com.br\n\nSenha temporária\nN0va-Senh4-Kz\nVale por 72 horas.\n');
    expect(r.html).toContain('user-select:all;word-break:break-all">RIOBRANCO</td>');
    expect(r.html).toContain('user-select:all;word-break:break-all">joaquina.teste@exemplo.com.br</td>');
    expect(r.html).toMatch(/font-size:22px;line-height:30px;font-weight:600;[^"]*user-select:all;word-break:break-all">N0va-Senh4-Kz<\/td>/);
    expect(r.html).toContain('>Vale por 72 horas.</td>');
    expect(VALIDADE_SENHA_PROVISORIA_HORAS).toBe(72);
  });

  it('validade nula (admin inicial, P5): sem "Vale por"', () => {
    const r = renderizarEmail('acesso_inicial', { ...carga, dados: { ...dados, validade_horas: null } });
    expect(r.texto).not.toContain('Vale por');
    expect(r.html).not.toContain('Vale por');
  });

  it('rodapé: filete e a assinatura do manual §7, no texto e no HTML', () => {
    expect(RODAPE_EMAIL).toBe('Equipe Macuxi FDV · Boa Vista, RR · macuxifdv.com.br');
    const r = renderizarEmail('acesso_inicial', carga);
    expect(r.texto.endsWith(`\n--\n${RODAPE_EMAIL}\n`)).toBe(true);
    expect(r.html).toContain(`border-top:2px solid #1E3350;`);
    expect(r.html).toContain(`>${RODAPE_EMAIL}</td>`);
  });

  it('versão só texto: cada linha está no HTML (mesmo conteúdo, mesma ordem)', () => {
    for (const [modelo, c] of [
      ['acesso_inicial', carga],
      ['nova_senha', novaSenha],
      ['nova_senha', redefinida],
    ] as const) {
      const r = renderizarEmail(modelo, c, comTudo);
      let desde = 0;
      for (const linha of r.texto.split('\n').filter((l) => l !== '' && l !== '--')) {
        const alvo = linha.startsWith('Abrir o backoffice: ') ? 'Abrir o backoffice' : escaparHtml(linha);
        const pos = r.html.indexOf(alvo, desde);
        expect(pos, linha).toBeGreaterThan(-1);
        desde = pos + alvo.length;
      }
    }
  });
});

describe('fonte do sistema, pesos e tamanhos (manual da marca §5, R-20261115-110600)', () => {
  const { html } = renderizarEmail('nova_senha', { ...redefinida, dados: { ...redefinida.dados, apps: ['web'] } }, comTudo);
  const estiloDo = (valor: string) => html.match(new RegExp(`style="([^"]*)">${valor}</td>`))?.[1] ?? '';

  it('texto e título na pilha do sistema do e-mail; mono com tabular-nums só no código da empresa e na senha', () => {
    expect(html).not.toMatch(/Archivo|IBM Plex/);
    expect(html).toContain(`>Crie a sua senha no backoffice</td>`);
    expect(estiloDo('Crie a sua senha no backoffice')).toContain(`font-family:${PILHA_SISTEMA_EMAIL};`);
    expect(estiloDo('joaquina.teste@exemplo.com.br')).toContain(`font-family:${PILHA_SISTEMA_EMAIL};`);
    for (const codigo of ['RIOBRANCO', 'N0va-Senh4-Kz']) {
      expect(estiloDo(codigo), codigo).toContain(`font-family:${PILHA_MONO_EMAIL};font-variant-numeric:tabular-nums;`);
    }
  });

  it('só os quatro pesos; 700 só no título e no texto alternativo do logo; nada abaixo de 12 px', () => {
    const semLogo = renderizarEmail('nova_senha', redefinida).html;
    const pesos = [...semLogo.matchAll(/font-weight:(\w+)/g)].map((m) => m[1]);
    expect(new Set(pesos)).toEqual(new Set(['700', '500', '600']));
    const com700 = [...semLogo.matchAll(/class="([\w-]+)" style="[^"]*font-weight:700/g)].map((m) => m[1]);
    expect(com700.sort()).toEqual(['mx-marca', 'mx-titulo']);
    expect(semLogo).not.toContain('<strong>');
    const tamanhos = [...html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1])).filter((t) => t > 0);
    expect(Math.min(...tamanhos)).toBeGreaterThanOrEqual(12);
  });
});

describe('layout-base: tabelas, 600 px, modo escuro e logo (spec §5)', () => {
  it('HTML em tabelas de apresentação, estilos inline, 600 px, sem div nem fonte remota', () => {
    const { html } = renderizarEmail('nova_senha', redefinida, comTudo);
    expect(html.startsWith('<!doctype html>\n<html lang="pt-BR"')).toBe(true);
    expect(html).toContain('<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">');
    expect(html).not.toMatch(/<div|<link|@import|<script|display:flex|display:grid/);
    for (const td of html.match(/<td[^>]*>/g) ?? []) expect(td === '<td>' || td.includes('style="'), td).toBe(true);
  });

  it('modo escuro: color-scheme, @media escuro com Azul noite, bloco #3A4D68 e troca do logo', () => {
    const { html } = renderizarEmail('nova_senha', redefinida, comTudo);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('.mx-fundo, .mx-folha, body { background:#1E3350 !important; }');
    expect(html).toContain('.mx-dados { background:#3A4D68 !important; border-color:#3A4D68 !important; }');
    expect(html).toContain(`<img class="mx-claro" src="${LOGO}" width="139" height="30" alt="${TEXTO_ALTERNATIVO_LOGO}"`);
    expect(html).toContain(`<!--[if !mso]><!--><img class="mx-escuro" src="${LOGO_ESCURO}"`);
    expect(html).toContain('.mx-claro { display:none !important; }');
  });

  it('sem urlLogo: o texto alternativo entra como texto, no mesmo lugar, e nenhuma imagem', () => {
    const { html } = renderizarEmail('nova_senha', redefinida);
    expect(TEXTO_ALTERNATIVO_LOGO).toBe('Macuxi Força de Vendas');
    expect(html).not.toContain('<img');
    expect(html).toContain(`class="mx-marca"`);
    expect(html).toContain(`>${TEXTO_ALTERNATIVO_LOGO}</td>`);
    expect(html).not.toContain('.mx-claro { display:none !important; }');
  });

  it('só urlLogo (sem a versão escura): uma imagem só, que não some no modo escuro', () => {
    const { html } = renderizarEmail('nova_senha', redefinida, { urlLogo: LOGO });
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).not.toContain('mx-escuro"');
    expect(html).not.toContain('.mx-claro { display:none !important; }');
  });

  it('endereços das opções saem escapados no atributo', () => {
    const { html } = renderizarEmail('nova_senha', { ...redefinida, dados: { ...redefinida.dados, apps: ['web'] } }, {
      urlLogo: 'https://x.test/a.png?a=1&b="2"',
      urlBackoffice: 'https://x.test/?a=1&b=<2>',
    });
    expect(html).toContain('src="https://x.test/a.png?a=1&amp;b=&quot;2&quot;"');
    expect(html).toContain('href="https://x.test/?a=1&amp;b=&lt;2&gt;"');
  });
});

describe('HTML escapado', () => {
  it('escaparHtml troca & < > " \'', () => {
    expect(escaparHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('empresa e senha com marcação saem escapadas no HTML (e cruas no texto)', () => {
    const r = renderizarEmail('acesso_inicial', {
      ...carga,
      dados: { ...dados, nome: '<b>Zé</b> & Cia', empresa_nome: 'Loja "<script>alert(1)</script>"', senha: 'x<y>&"z\'123' },
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<b>Zé');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('word-break:break-all">x&lt;y&gt;&amp;&quot;z&#39;123</td>');
    expect(r.texto).toContain('\nSenha temporária\nx<y>&"z\'123\n');
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
    ['nova_senha redefinida', 'nova_senha', CargaEmailSchema.parse(redefinida)],
    ['nova_senha redefinida pela Macuxi', 'nova_senha', CargaEmailSchema.parse({ ...redefinida, dados: { ...redefinida.dados, redefinida_por: 'macuxi' } })],
  ];

  it.each(cargas)('%s: nenhum valor sensível aparece; marcadores no lugar; mesmas opções de apresentação', (_n, modelo, c) => {
    const sensiveis = valoresSensiveisEmail(c);
    expect(sensiveis).toContain('Joaquina Teste');
    expect(sensiveis).toContain('joaquina.teste@exemplo.com.br');
    const r = renderizarEmailParaLog(modelo, c, comTudo);
    const log = JSON.stringify(r);
    for (const v of sensiveis) expect(log).not.toContain(v);
    expect(log).toContain(MARCADORES_EMAIL.senha);
    expect(log).toContain(MARCADORES_EMAIL.email);
    // o que não é pessoal continua: código da empresa, validade e o logo
    expect(log).toContain('RIOBRANCO');
    expect(log).toContain('72 horas');
    expect(r.html).toContain(LOGO);
  });

  it('versão sem senha: mantém o login, mascara só a senha', () => {
    const c = cargas[0]![2];
    const r = renderizarEmailSemSenha('acesso_inicial', c, comTudo);
    expect(r.texto).toContain('\nE-mail\njoaquina.teste@exemplo.com.br\n');
    expect(r.texto).toContain('\nSenha temporária\n********\n');
    expect(r.html).toContain(`href="${BKO}"`);
    expect(JSON.stringify(r)).not.toContain('Prov1sor1a-Xq7');
  });
});
