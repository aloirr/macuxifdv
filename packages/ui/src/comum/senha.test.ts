import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAMPO_REPITA_A_SENHA,
  CAMPO_SENHA_NOVA,
  faltasEmOrdem,
  itemDaRepeticao,
  itensDasRegras,
  REGRAS_DA_SENHA,
  resumoComRepeticao,
  resumoDaTela,
  rotuloDaRegraSenha,
  SENHA_ATENDE_AS_REGRAS,
} from './senha';

/** O mínimo que as telas passam (`SENHA_MIN_CARACTERES` do Core); aqui só como dado de teste. */
const MIN = 8;

describe('RD-0021: a frase do que falta é a do Core (mensagemDaSenha), passada pela tela', () => {
  it('a frase da tela passa como está', () => {
    expect(resumoDaTela('Falta um número.')).toBe('Falta um número.');
    expect(resumoDaTela('A senha pode ter até 200 caracteres.')).toBe('A senha pode ter até 200 caracteres.');
  });

  it('null/undefined/vazio (o Core devolve null quando nada falta) = "A senha atende às regras."', () => {
    expect(SENHA_ATENDE_AS_REGRAS).toBe('A senha atende às regras.');
    expect(resumoDaTela(null)).toBe(SENHA_ATENDE_AS_REGRAS);
    expect(resumoDaTela(undefined)).toBe(SENHA_ATENDE_AS_REGRAS);
    expect(resumoDaTela('  ')).toBe(SENHA_ATENDE_AS_REGRAS);
  });

  it('repetição e valor desconhecido são ignorados na ordem das faltas', () => {
    expect(faltasEmOrdem(['numero', 'xyz', 'numero', 'letra'])).toEqual(['letra', 'numero']);
  });
});

describe('RN-CORE-32: itens da lista', () => {
  it('sempre as quatro regras, na ordem da tela', () => {
    expect(itensDasRegras([], MIN).map((i) => i.regra)).toEqual([...REGRAS_DA_SENHA]);
    expect(itensDasRegras([], MIN).map((i) => i.rotulo)).toEqual(['8 caracteres ou mais', 'Uma letra', 'Um número', 'Um caractere especial']);
  });

  it('cumprida = ok; faltando = falta (neutra) enquanto digita', () => {
    const itens = itensDasRegras(['numero', 'especial'], MIN);
    expect(itens.map((i) => i.estado)).toEqual(['ok', 'ok', 'falta', 'falta']);
    expect(itens.map((i) => i.rotuloAcessivel)).toEqual(['8 caracteres ou mais: ok', 'Uma letra: ok', 'Um número: falta', 'Um caractere especial: falta']);
  });

  it('destacar (depois de tentar salvar) pinta só as faltas como erro; o texto falado continua "falta"', () => {
    const itens = itensDasRegras(['numero'], MIN, true);
    expect(itens.map((i) => i.estado)).toEqual(['ok', 'ok', 'erro', 'ok']);
    expect(itens[2]?.rotuloAcessivel).toBe('Um número: falta');
  });

  it('o exemplo de símbolos fica só no caractere especial', () => {
    expect(itensDasRegras([], MIN).map((i) => i.exemplo)).toEqual([null, null, null, '! @ # $']);
  });
});

describe('RN-CORE-34: "Repita a senha" na "Crie sua senha" (T-0094)', () => {
  it('rótulos dos dois campos', () => {
    expect(CAMPO_SENHA_NOVA).toBe('Senha nova');
    expect(CAMPO_REPITA_A_SENHA).toBe('Repita a senha');
  });

  it('sem repetição (portal, formulário de usuário) ou campo vazio enquanto digita: a linha não aparece', () => {
    expect(itemDaRepeticao(undefined)).toBeNull();
    expect(itemDaRepeticao(undefined, true)).toBeNull();
    expect(itemDaRepeticao('vazia')).toBeNull();
  });

  it('igual = ok; diferente = neutra enquanto digita e erro depois de tentar salvar', () => {
    expect(itemDaRepeticao('igual')).toEqual({ estado: 'ok', texto: 'As senhas conferem.' });
    expect(itemDaRepeticao('igual', true)).toEqual({ estado: 'ok', texto: 'As senhas conferem.' });
    expect(itemDaRepeticao('diferente')).toEqual({ estado: 'falta', texto: 'As senhas não conferem.' });
    expect(itemDaRepeticao('diferente', true)).toEqual({ estado: 'erro', texto: 'As senhas não conferem.' });
  });

  it('vazia depois de tentar salvar = erro "Repita a senha nova."', () => {
    expect(itemDaRepeticao('vazia', true)).toEqual({ estado: 'erro', texto: 'Repita a senha nova.' });
  });

  it('a frase falada junta as regras e a conferência', () => {
    expect(resumoComRepeticao(resumoDaTela('Falta um número.'), 'diferente')).toBe('Falta um número. As senhas não conferem.');
    expect(resumoComRepeticao(resumoDaTela(null), 'igual')).toBe('A senha atende às regras. As senhas conferem.');
    expect(resumoComRepeticao(resumoDaTela(null), 'vazia')).toBe('A senha atende às regras.');
    expect(resumoComRepeticao(resumoDaTela(null), undefined)).toBe('A senha atende às regras.');
  });
});

describe('RD-0021: o mínimo de caracteres vem da tela (SENHA_MIN_CARACTERES do Core), sem número escrito à mão no kit', () => {
  it('rótulo e itens acompanham o mínimo recebido', () => {
    expect(rotuloDaRegraSenha('caracteres', 10)).toBe('10 caracteres ou mais');
    expect(rotuloDaRegraSenha('numero', 10)).toBe('Um número');
    expect(itensDasRegras(['caracteres'], 10, true)[0]).toMatchObject({ rotulo: '10 caracteres ou mais', estado: 'erro', rotuloAcessivel: '10 caracteres ou mais: falta' });
  });

  it('o kit não tem mínimo próprio nem monta a frase (a transição saiu)', () => {
    const fonte = readFileSync(new URL('./senha.ts', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\*\*|\/\/)/.test(l));
    expect(fonte.filter((l) => /\b8\b/.test(l))).toEqual([]);
    expect(fonte.join('\n')).not.toMatch(/MINIMO_DA_SENHA_SEM_TELA|resumoDaSenha|ROTULO_REGRA_SENHA|pelo menos \$\{/);
  });

  it('nos dois kits, minimo e resumo são obrigatórios e vão direto para a lista e para a frase', () => {
    for (const arq of ['../web/senha.tsx', '../mobile/senha.tsx']) {
      const src = readFileSync(new URL(arq, import.meta.url), 'utf8');
      expect(src).toContain('itensDasRegras(faltas, minimo, destacar)');
      expect(src).toContain('resumoComRepeticao(resumoDaTela(resumo), repeticao, destacar)');
      expect(src).toContain('  minimo: number;');
      expect(src).toContain('  resumo: string | null | undefined;');
      expect(src).not.toMatch(/MINIMO_DA_SENHA_SEM_TELA|resumoDaSenha|ROTULO_REGRA_SENHA/);
    }
  });
});
