#!/usr/bin/env python3
"""
filter-dump.py — Extrae de un volcado `pg_dumpall` de Supabase Cloud solo lo
que hace falta para restaurarlo en un Supabase self-hosted:

  * Todos los objetos y datos del esquema `public` (tablas, RLS, funciones,
    triggers, índices, secuencias y datos).
  * Los datos de `auth.users` y `auth.identities` (conserva usuarios y sus
    contraseñas, que ya vienen cifradas con bcrypt).
  * El trigger `on_auth_user_created` que crea el perfil al dar de alta un
    usuario.

Se descartan los roles, esquemas y extensiones porque la imagen
`supabase/postgres` ya los crea al inicializarse.

Uso:
    python3 filter-dump.py volcado.sql restauracion.sql
"""

import re
import sys


def is_header(line: str) -> bool:
    """Cabecera de un objeto (`-- Name:`) o de un bloque de datos (`-- Data for Name:`)."""
    return line.startswith("-- Name: ") or line.startswith("-- Data for Name: ")


def split_blocks(text: str):
    """Divide el volcado en bloques delimitados por sus cabeceras."""
    blocks = []
    current = []
    for line in text.split("\n"):
        if is_header(line):
            if current:
                blocks.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        blocks.append(current)
    return blocks


def header_of(block):
    for line in block[:3]:
        if is_header(line):
            return line
    return ""


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2

    src, dst = sys.argv[1], sys.argv[2]

    with open(src, encoding="utf-8", errors="replace") as fh:
        text = fh.read()

    keep = []
    for block in split_blocks(text):
        head = header_of(block)
        body = "\n".join(block)
        if "Schema: public;" in head:
            keep.append(block)
            continue
        # Datos de autenticación (conserva usuarios y contraseñas)
        if re.search(r"^COPY auth\.(users|identities) ", body, re.M):
            keep.append(block)
            continue
        # Trigger que crea el perfil al registrar un usuario
        if "Type: TRIGGER;" in head and "ON auth.users" in body:
            keep.append(block)
            continue

    out = [
        "-- Restauración selectiva generada por deploy/filter-dump.py",
        "SET client_encoding = 'UTF8';",
        "SET standard_conforming_strings = on;",
        "SET check_function_bodies = false;",
        "SET client_min_messages = warning;",
        "SET row_security = off;",
        "",
        "-- Usuarios de Auth (se conservan las contraseñas existentes)",
        "DELETE FROM auth.identities;",
        "DELETE FROM auth.users;",
        "",
    ]

    for block in keep:
        out.append("\n".join(block).rstrip("\n"))
        out.append("")

    with open(dst, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out))

    print(f"OK -> {dst} ({len(keep)} bloques)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
