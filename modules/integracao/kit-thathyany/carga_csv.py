#!/usr/bin/env python3
"""Carga dos CSVs no banco local ERP_THATHYANY (kit da thathyany, T-0174).

Um CSV por entidade, todas de uma vez, na ordem de carga, com as colunas do contrato canônico (contrato.json, gerado do mesmo
dicionário que o Backoffice mostra). Valida antes de gravar (obrigatórios, tipos, dinheiro em centavos, datas UTC), grava por
MERGE em external_id (rodar duas vezes não duplica nem muda a hora de alteração do que não mudou) e fecha com um relatório por tabela.

Requisitos: Python 3.10 ou mais novo e `pip install pyodbc` (e o "ODBC Driver 18 for SQL Server"). Só validar não precisa de banco.

Exemplos:
    python carga_csv.py --pasta C:\\dados\\csv                 # valida e grava todas as entidades que tiverem arquivo
    python carga_csv.py --pasta C:\\dados\\csv --validar       # só valida (nada é gravado, não abre o banco)
    python carga_csv.py --pasta C:\\dados\\csv --entidade cliente --entidade produto

Sem dado pessoal na saída: as mensagens citam a linha, a coluna e o motivo, nunca o valor digitado.
"""
from __future__ import annotations

import argparse
import csv
import getpass
import hashlib
import io
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

if sys.version_info < (3, 10):  # pragma: no cover - aviso amigável antes de qualquer erro de sintaxe tardio
    raise SystemExit("Este script precisa de Python 3.10 ou mais novo (python.org/downloads).")

PASTA_KIT = Path(__file__).resolve().parent
SIM = {"sim", "s", "true", "1", "verdadeiro"}
NAO = {"não", "nao", "n", "false", "0", "falso"}
RE_INSTANTE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$")
RE_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RE_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
# "1.500" e "1,500": milhar ou decimal? O contrato recusa a ambiguidade (tipo_invalido) e pede 1500 ou 1,5.
RE_AMBIGUO = re.compile(r"^-?\d{1,3}[.,]\d{3}$")


class ErroArquivo(Exception):
    """O arquivo inteiro é recusado (cabeçalho errado, arquivo vazio...)."""


# ---------------------------------------------------------------------------------------------------------------- contrato


def carregar_contrato(caminho: Path | None = None) -> dict[str, Any]:
    return json.loads((caminho or PASTA_KIT / "contrato.json").read_text(encoding="utf-8"))


def entidades_por_nome(contrato: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {e["entidade"]: e for e in contrato["entidades"]}


# ---------------------------------------------------------------------------------------------------------------- leitura


def ler_csv(texto: str) -> tuple[list[str], list[tuple[int, list[str]]]]:
    """Devolve (cabeçalho, [(número da linha física, células)]). Separador `;` ou `,` pelo cabeçalho (sem nenhum: `;`).
    Linhas em branco e só de separadores (sobra do Excel) são ignoradas, mas a numeração conta a linha física."""
    texto = texto.lstrip("﻿")
    if not texto.strip():
        raise ErroArquivo("O arquivo está vazio. Salve a planilha como CSV UTF-8 com o cabeçalho na primeira linha.")
    primeira = texto.splitlines()[0]
    sep = ";" if primeira.count(";") >= primeira.count(",") else ","
    leitor = csv.reader(io.StringIO(texto, newline=""), delimiter=sep, quotechar='"')
    linhas: list[tuple[int, list[str]]] = []
    try:
        for celulas in leitor:
            linhas.append((leitor.line_num, celulas))
    except csv.Error as e:
        raise ErroArquivo(f"CSV inválido (aspas abertas ou texto fora do padrão): {e}. Confira a planilha e salve de novo.") from e
    cabecalho = [c.strip().lower() for c in linhas[0][1]]
    dados = [(n, [c.strip() for c in cel]) for n, cel in linhas[1:] if any(c.strip() for c in cel)]
    return cabecalho, dados


# ---------------------------------------------------------------------------------------------------------------- validação de célula


def _numero(texto: str, campo: dict[str, Any]) -> int | Decimal:
    regra = campo["regra"]
    inteiro = bool(regra.get("inteiro")) or campo["tipo"] == "centavos"
    if campo["tipo"] == "centavos" and not re.fullmatch(r"-?\d+", texto):
        raise ValueError("deve ser em centavos inteiros, sem vírgula, ponto ou R$ (R$ 15,00 = 1500)")
    if inteiro:
        if not re.fullmatch(r"-?\d+", texto):
            raise ValueError("deve ser um número inteiro")
        valor: int | Decimal = int(texto)
    else:
        if RE_AMBIGUO.match(texto):
            raise ValueError("número ambíguo (milhar ou decimal?); escreva 1500 ou 1,5, sem separador de milhar")
        try:
            valor = Decimal(texto.replace(",", "."))
        except InvalidOperation as e:
            raise ValueError("deve ser um número (decimal com vírgula ou ponto)") from e
        if not valor.is_finite():
            raise ValueError("deve ser um número")
    minimo, maximo = regra.get("min"), regra.get("max")
    if minimo is not None and valor < minimo:
        raise ValueError(f"deve ser maior ou igual a {minimo}")
    if maximo is not None and valor > maximo:
        raise ValueError(f"deve ser menor ou igual a {maximo}")
    return valor


def _lista(texto: str, campo: dict[str, Any]) -> str:
    cfg = campo["regra"]["lista"]
    itens = [i.strip() for i in texto.split("/")]
    if any(i == "" for i in itens):
        raise ValueError("lista com item vazio; separe os itens com / (ex.: 30/60/90)")
    if len(itens) < cfg["min_itens"] or len(itens) > cfg["max_itens"]:
        raise ValueError(f"a lista deve ter de {cfg['min_itens']} a {cfg['max_itens']} itens")
    if cfg["item"] == "numero":
        numeros: list[int] = []
        for i in itens:
            if not re.fullmatch(r"\d+", i):
                raise ValueError("a lista deve ter só números inteiros separados por /")
            n = int(i)
            if n < cfg["min"] or n > cfg["max"]:
                raise ValueError(f"cada item deve ficar entre {cfg['min']} e {cfg['max']}")
            numeros.append(n)
        if cfg.get("nao_decrescente") and numeros != sorted(numeros):
            raise ValueError("os dias das parcelas não podem decrescer (ex.: 30/60/90)")
        return json.dumps(numeros)
    for i in itens:
        if len(i) > cfg["tamanho_item"]:
            raise ValueError(f"cada código deve ter até {cfg['tamanho_item']} caracteres")
    return json.dumps([i.upper() for i in itens], ensure_ascii=False)


def converter_celula(texto: str, campo: dict[str, Any]) -> Any:
    """Converte a célula (não vazia) para o valor do banco ou levanta ValueError com o motivo, sem citar o valor."""
    tipo, regra = campo["tipo"], campo["regra"]
    if tipo in ("número", "centavos"):
        return _numero(texto, campo)
    if tipo == "sim/não":
        t = texto.lower()
        if t in SIM:
            return 1
        if t in NAO:
            return 0
        raise ValueError("deve ser sim ou não")
    if tipo == "data":
        if not RE_DATA.match(texto):
            raise ValueError("data deve estar no formato AAAA-MM-DD")
        try:
            return date.fromisoformat(texto)
        except ValueError as e:
            raise ValueError("data inexistente") from e
    if tipo == "data-hora":
        m = RE_INSTANTE.match(texto)
        if not m:
            raise ValueError("horário deve ser UTC no formato AAAA-MM-DDTHH:MM:SSZ (terminando em Z)")
        try:
            partes = [int(g) for g in m.groups()[:6]]
            ms = int((m.group(7) or "0").ljust(3, "0"))
            return datetime(*partes, ms * 1000)  # UTC "ingênuo": a coluna do banco guarda UTC
        except ValueError as e:
            raise ValueError("data e hora inexistentes") from e
    if tipo == "enum":
        t = texto.lower()
        if t not in regra["opcoes"]:
            raise ValueError("deve ser uma destas opções: " + ", ".join(regra["opcoes"]))
        return t
    if tipo in ("lista de números", "lista de textos"):
        return _lista(texto, campo)
    # texto
    maximo = campo.get("tamanho_max")
    if maximo is not None and len(texto) > maximo:
        raise ValueError(f"texto com mais de {maximo} caracteres")
    if regra.get("uf"):
        if not re.fullmatch(r"[A-Za-z]{2}", texto):
            raise ValueError("UF deve ter 2 letras")
        return texto.upper()
    if regra.get("letras"):
        lo, hi = regra["letras"]
        if not re.fullmatch(rf"[A-Za-z]{{{lo},{hi}}}", texto):
            raise ValueError(f"deve ter de {lo} a {hi} letras")
        return texto.upper()
    if regra.get("digitos"):
        so_digitos = re.sub(r"\D", "", texto) if campo["campo"] != "ean" else texto
        if not so_digitos.isdigit() or len(so_digitos) not in regra["digitos"]:
            raise ValueError("deve ter " + " ou ".join(str(d) for d in regra["digitos"]) + " dígitos")
        return so_digitos
    if regra.get("uuid") and not RE_UUID.match(texto):
        raise ValueError("deve ser um UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)")
    return texto


# ---------------------------------------------------------------------------------------------------------------- validação do arquivo


@dataclass
class Recusa:
    linha: int
    campo: str
    motivo: str


@dataclass
class ResultadoValidacao:
    validas: list[tuple[int, dict[str, Any]]] = field(default_factory=list)
    recusadas: list[Recusa] = field(default_factory=list)
    lidas: int = 0


def validar_cabecalho(ent: dict[str, Any], cabecalho: list[str]) -> None:
    conhecidos = {c["campo"] for c in ent["campos"]}
    repetidas = sorted({c for c in cabecalho if cabecalho.count(c) > 1})
    if repetidas:
        raise ErroArquivo("Coluna repetida no cabeçalho: " + ", ".join(repetidas) + ".")
    desconhecidas = [c for c in cabecalho if c not in conhecidos]
    if desconhecidas:
        raise ErroArquivo("Coluna fora do contrato: " + ", ".join(desconhecidas) + ". Colunas aceitas: " + ", ".join(c["campo"] for c in ent["campos"]) + ".")
    ausentes = [c["campo"] for c in ent["campos"] if c["obrigatorio"] and c["campo"] not in cabecalho]
    if ausentes:
        raise ErroArquivo("Falta coluna obrigatória no cabeçalho: " + ", ".join(ausentes) + ".")


def validar_linhas(ent: dict[str, Any], cabecalho: list[str], linhas: list[tuple[int, list[str]]]) -> ResultadoValidacao:
    """Valida cada linha: obrigatórios, tipos, centavos, datas UTC e external_id repetido no arquivo. Uma linha ruim não impede as outras."""
    validar_cabecalho(ent, cabecalho)
    por_campo = {c["campo"]: c for c in ent["campos"]}
    res = ResultadoValidacao(lidas=len(linhas))
    vistos: set[str] = set()
    for numero, celulas in linhas:
        if len(celulas) > len(cabecalho):
            res.recusadas.append(Recusa(numero, "(linha)", "tem mais colunas que o cabeçalho; confira separadores e aspas"))
            continue
        valores: dict[str, Any] = {}
        erros: list[Recusa] = []
        for i, nome in enumerate(cabecalho):
            campo = por_campo[nome]
            texto = celulas[i] if i < len(celulas) else ""
            if texto == "":
                if campo["obrigatorio"]:
                    erros.append(Recusa(numero, nome, "é obrigatório e está vazio"))
                continue
            try:
                valores[campo["coluna"]] = converter_celula(texto, campo)
            except ValueError as e:
                erros.append(Recusa(numero, nome, str(e)))
        if not erros:
            ident = valores["external_id"]
            if ident in vistos:
                erros.append(Recusa(numero, "external_id", "repetido no arquivo (já apareceu em linha anterior)"))
            else:
                vistos.add(ident)
        if erros:
            res.recusadas.extend(erros)
        else:
            res.validas.append((numero, valores))
    return res


def checar_referencias(ent: dict[str, Any], res: ResultadoValidacao, conhecidos: dict[str, set[str]]) -> ResultadoValidacao:
    """Move para as recusadas a linha que cita (vendedor, produto, cliente...) um external_id que não existe.
    `conhecidos[entidade]` = ids já gravados ou carregados nesta execução; entidade fora do mapa não é conferida."""
    refs = [(c["coluna"], c["referencia"]) for c in ent["campos"] if c.get("referencia") and c["referencia"] in conhecidos]
    if not refs:
        return res
    boas: list[tuple[int, dict[str, Any]]] = []
    for numero, valores in res.validas:
        faltou = [(col, alvo) for col, alvo in refs if valores.get(col) is not None and valores[col] not in conhecidos[alvo]]
        if faltou:
            for col, alvo in faltou:
                res.recusadas.append(Recusa(numero, col, f"não existe em {alvo}; carregue {alvo} antes (ou corrija o código)"))
        else:
            boas.append((numero, valores))
    res.validas = boas
    return res


# ---------------------------------------------------------------------------------------------------------------- gravação (MERGE)


def colunas_da_entidade(ent: dict[str, Any]) -> list[str]:
    return [c["coluna"] for c in ent["campos"]]


def calcular_hash(ent: dict[str, Any], valores: dict[str, Any]) -> str:
    """Hash do conteúdo da linha (sem alterado_em): mesmo conteúdo = mesmo hash = o MERGE não toca a linha."""
    corpo = {c: valores.get(c) for c in colunas_da_entidade(ent) if c != "alterado_em"}
    return hashlib.sha256(json.dumps(corpo, sort_keys=True, default=str, ensure_ascii=False).encode("utf-8")).hexdigest()


def tipo_base(tipo_sql: str) -> str:
    """`NVARCHAR(120) NOT NULL` -> `NVARCHAR(120)` (o CAST dá tipo ao parâmetro, inclusive quando ele é nulo)."""
    m = re.match(r"^[A-Z0-9]+(?:\([^)]*\))?", tipo_sql)
    return m.group(0) if m else tipo_sql


def montar_upsert(ent: dict[str, Any]) -> tuple[str, list[str]]:
    """Devolve (SQL do MERGE com `?`, ordem dos parâmetros). Um MERGE por linha, por external_id.
    Inserção: alterado_em = o do arquivo ou agora (UTC). Atualização só quando o hash mudou, e alterado_em sobe sempre (o delta do Conector vê)."""
    colunas = colunas_da_entidade(ent)
    dados = [c for c in colunas if c not in ("external_id", "alterado_em")]
    ordem = ["external_id", "alterado_em", *dados, "linha_hash"]
    tipos = {c["coluna"]: tipo_base(c["tipo_sql"]) for c in ent["campos"]}
    tipos["linha_hash"] = "CHAR(64)"
    fonte = ", ".join(f"CAST(? AS {tipos[c]}) AS {c}" for c in ordem)
    cols_insert = ", ".join(ordem)
    vals_insert = ", ".join("COALESCE(s.alterado_em, SYSUTCDATETIME())" if c == "alterado_em" else f"s.{c}" for c in ordem)
    sets = ", ".join(f"t.{c} = s.{c}" for c in [*dados, "linha_hash"])
    sets += ", t.alterado_em = CASE WHEN s.alterado_em IS NOT NULL AND s.alterado_em > t.alterado_em THEN s.alterado_em ELSE SYSUTCDATETIME() END"
    sql = (
        f"SET NOCOUNT ON; MERGE dbo.{ent['tabela']} WITH (HOLDLOCK) AS t USING (SELECT {fonte}) AS s ON t.external_id = s.external_id "
        f"WHEN MATCHED AND ISNULL(t.linha_hash, '') <> s.linha_hash THEN UPDATE SET {sets} "
        f"WHEN NOT MATCHED THEN INSERT ({cols_insert}) VALUES ({vals_insert}) "
        "OUTPUT $action;"
    )
    return sql, ordem


def parametros_da_linha(ent: dict[str, Any], ordem: list[str], valores: dict[str, Any]) -> list[Any]:
    completo = {**valores}
    # Colunas do contrato que o arquivo não trouxe (ou trouxe vazias): ativo vira 1; o resto fica nulo (= o Macuxi não altera).
    completo.setdefault("ativo", 1)
    completo["linha_hash"] = calcular_hash(ent, completo)
    return [completo.get(c) for c in ordem]


@dataclass
class Contagem:
    lidas: int = 0
    inseridas: int = 0
    atualizadas: int = 0
    sem_mudanca: int = 0
    recusadas: int = 0


def gravar_entidade(conn: Any, ent: dict[str, Any], res: ResultadoValidacao) -> Contagem:
    """Grava as linhas válidas numa transação só da entidade. Se o banco falhar, nada da entidade fica pela metade."""
    sql, ordem = montar_upsert(ent)
    cont = Contagem(lidas=res.lidas, recusadas=len({r.linha for r in res.recusadas}))
    cur = conn.cursor()
    try:
        for _numero, valores in res.validas:
            cur.execute(sql, parametros_da_linha(ent, ordem, valores))
            acao = cur.fetchone()
            if acao is None:
                cont.sem_mudanca += 1
            elif str(acao[0]).upper() == "INSERT":
                cont.inseridas += 1
            else:
                cont.atualizadas += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return cont


# ---------------------------------------------------------------------------------------------------------------- orquestração e relatório


@dataclass
class Linha:
    entidade: str
    arquivo: str | None
    contagem: Contagem = field(default_factory=Contagem)
    recusas: list[Recusa] = field(default_factory=list)
    erro_arquivo: str | None = None
    gravada: bool = False


def ids_no_banco(conn: Any, tabela: str) -> set[str]:
    cur = conn.cursor()
    cur.execute(f"SELECT external_id FROM dbo.{tabela}")
    return {str(r[0]) for r in cur.fetchall()}


def processar(contrato: dict[str, Any], pasta: Path, conn: Any | None, so_validar: bool = False, filtro: list[str] | None = None) -> list[Linha]:
    """Percorre as entidades na ordem de carga. Sem `conn` (ou com so_validar) nada é gravado e as referências só valem dentro dos arquivos."""
    ents = sorted(contrato["entidades"], key=lambda e: e["ordem"])
    conhecidos: dict[str, set[str]] = {}
    arquivos = {e["entidade"]: pasta / f"{e['entidade']}.csv" for e in ents}
    # referência vale pelo que já está no banco (uma carga só de delta cita cadastros de cargas anteriores) e pelo que vem nos arquivos
    if conn is not None and not so_validar:
        for e in ents:
            conhecidos[e["entidade"]] = ids_no_banco(conn, e["tabela"])
    relatorio: list[Linha] = []
    for ent in ents:
        nome = ent["entidade"]
        if filtro and nome not in filtro:
            continue
        caminho = arquivos[nome]
        linha = Linha(entidade=nome, arquivo=caminho.name if caminho.exists() else None)
        relatorio.append(linha)
        if not caminho.exists():
            continue
        try:
            cabecalho, dados = ler_csv(caminho.read_text(encoding="utf-8-sig"))
            res = validar_linhas(ent, cabecalho, dados)
        except ErroArquivo as e:
            linha.erro_arquivo = str(e)
            conhecidos.setdefault(nome, set())
            continue
        except UnicodeDecodeError:
            linha.erro_arquivo = "O arquivo não está em UTF-8. No Excel: Salvar como, CSV UTF-8 (delimitado por vírgulas)."
            continue
        conhecidos.setdefault(nome, set())
        conhecidos[nome] |= {str(v["external_id"]) for _n, v in res.validas}  # o próprio arquivo vale (ex.: pai do catálogo na mesma planilha)
        checar_referencias(ent, res, conhecidos)
        linha.recusas = res.recusadas
        linha.contagem = Contagem(lidas=res.lidas, recusadas=len({r.linha for r in res.recusadas}))
        if conn is not None and not so_validar:
            try:
                linha.contagem = gravar_entidade(conn, ent, res)
                linha.gravada = True
            except Exception as e:  # erro do banco: relatório sem valores de linha
                linha.erro_arquivo = f"Falha ao gravar no banco ({type(e).__name__}); nada desta entidade foi gravado. Detalhe: {_resumo_erro(e)}"
    return relatorio


def _resumo_erro(e: Exception) -> str:
    texto = str(e).splitlines()[0] if str(e) else type(e).__name__
    return texto[:300]


def formatar_relatorio(linhas: list[Linha], so_validar: bool) -> str:
    cab = f"{'tabela':<22}{'lidas':>7}{'recusadas':>11}" if so_validar else f"{'tabela':<22}{'lidas':>7}{'inseridas':>11}{'atualizadas':>13}{'sem mudança':>13}{'recusadas':>11}"
    out = [("Relatório da validação (nada foi gravado)" if so_validar else "Relatório da carga"), cab, "-" * len(cab)]
    for l in linhas:
        if l.arquivo is None:
            out.append(f"{l.entidade:<22}{'sem arquivo':>7}")
            continue
        c = l.contagem
        if so_validar:
            out.append(f"{l.entidade:<22}{c.lidas:>7}{c.recusadas:>11}")
        else:
            out.append(f"{l.entidade:<22}{c.lidas:>7}{c.inseridas:>11}{c.atualizadas:>13}{c.sem_mudanca:>13}{c.recusadas:>11}")
    detalhes: list[str] = []
    for l in linhas:
        if l.erro_arquivo:
            detalhes.append(f"[{l.entidade}] arquivo recusado: {l.erro_arquivo}")
        for r in l.recusas:
            detalhes.append(f"[{l.entidade}] linha {r.linha}, {r.campo}: {r.motivo}")
    if detalhes:
        out += ["", "Recusadas (corrija o CSV e rode de novo; o que já entrou não duplica):", *detalhes]
    return "\n".join(out)


def houve_problema(linhas: list[Linha]) -> bool:
    return any(l.erro_arquivo or l.recusas for l in linhas)


# ---------------------------------------------------------------------------------------------------------------- banco


def abrir_conexao(servidor: str, banco: str, usuario: str | None, senha: str | None) -> Any:
    try:
        import pyodbc  # noqa: PLC0415 - só quando for gravar: validar e testar não precisam do driver
    except ImportError as e:
        raise SystemExit("Falta o pyodbc. Rode: pip install pyodbc") from e
    drivers = [d for d in pyodbc.drivers() if "SQL Server" in d]
    preferidos = [d for d in drivers if "18" in d] or [d for d in drivers if "17" in d] or drivers
    if not preferidos:
        raise SystemExit('Nenhum driver ODBC do SQL Server instalado. Instale o "ODBC Driver 18 for SQL Server" (aka.ms/odbc18) e rode de novo.')
    base = f"DRIVER={{{preferidos[0]}}};SERVER={servidor};DATABASE={banco};Encrypt=yes;TrustServerCertificate=yes;"
    auth = f"UID={usuario};PWD={senha};" if usuario else "Trusted_Connection=yes;"
    return pyodbc.connect(base + auth, autocommit=False)


def principal(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Carrega os CSVs do contrato no banco local ERP_THATHYANY (idempotente por external_id).")
    p.add_argument("--pasta", required=True, type=Path, help="pasta com um CSV por entidade (vendedor.csv, cliente.csv...)")
    p.add_argument("--servidor", default=r".\SQLEXPRESS", help=r"padrão .\SQLEXPRESS")
    p.add_argument("--banco", default=None, help="padrão: o do contrato.json (ERP_THATHYANY)")
    p.add_argument("--usuario", default=None, help="login SQL; sem ele usa a autenticação do Windows")
    p.add_argument("--validar", action="store_true", help="só valida; não abre o banco nem grava")
    p.add_argument("--entidade", action="append", help="limita a entidades (repita a opção)")
    args = p.parse_args(argv)

    contrato = carregar_contrato()
    nomes = {e["entidade"] for e in contrato["entidades"]}
    if args.entidade and not set(args.entidade) <= nomes:
        print("Entidade desconhecida. Válidas: " + ", ".join(sorted(nomes)), file=sys.stderr)
        return 2
    if not args.pasta.is_dir():
        print(f"A pasta {args.pasta} não existe.", file=sys.stderr)
        return 2
    conn = None
    if not args.validar:
        senha = getpass.getpass("Senha do login SQL (o texto fica oculto): ") if args.usuario else None
        conn = abrir_conexao(args.servidor, args.banco or contrato["banco"], args.usuario, senha)
    try:
        relatorio = processar(contrato, args.pasta, conn, so_validar=args.validar, filtro=args.entidade)
    finally:
        if conn is not None:
            conn.close()
    print(formatar_relatorio(relatorio, args.validar))
    return 1 if houve_problema(relatorio) else 0


if __name__ == "__main__":
    sys.exit(principal())
