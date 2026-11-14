"""Parsers for common reference-manager export formats."""

from __future__ import annotations

import re
from typing import Any


def _year(value: str) -> int | None:
    match = re.search(r"\b(?:1[0-9]{3}|2[0-9]{3}|3000)\b", value)
    return int(match.group()) if match else None


def _author(value: str) -> dict[str, str]:
    name = value.strip()
    if "," in name:
        last, first = name.split(",", 1)
        return {"firstName": first.strip()[:100], "lastName": last.strip()[:100]}
    parts = name.split()
    if len(parts) < 2:
        return {"firstName": "", "lastName": name[:100]}
    return {"firstName": " ".join(parts[:-1])[:100], "lastName": parts[-1][:100]}


def _ris_records(text: str) -> list[dict[str, Any]]:
    entries: list[dict[str, list[str]]] = []
    current: dict[str, list[str]] = {}
    last_tag = ""

    def finish() -> None:
        nonlocal current, last_tag
        if current:
            entries.append(current)
        current = {}
        last_tag = ""

    for line in text.splitlines():
        match = re.match(r"^([A-Z0-9]{2})\s{2}-\s?(.*)$", line)
        if match:
            tag, value = match.groups()
            if tag == "TY":
                finish()
            elif tag in {"ER", "EF"}:
                finish()
                continue
            current.setdefault(tag, []).append(value.strip())
            last_tag = tag
        elif line[:1].isspace() and last_tag and current.get(last_tag):
            current[last_tag][-1] += " " + line.strip()
    finish()

    parsed = []
    for entry in entries:
        title = next(iter(entry.get("TI", entry.get("T1", []))), "").strip()
        if not title:
            raise ValueError("Every RIS record must include a title (TI or T1).")
        parsed.append({
            "title": title,
            "authors": [_author(name) for name in entry.get("AU", []) if name.strip()],
            "publication_year": _year(" ".join(entry.get("PY", entry.get("Y1", [])))),
            "journal": next(iter(entry.get("JO", entry.get("JF", entry.get("T2", [])))), ""),
            "abstract": " ".join(entry.get("AB", [])),
            "doi": next(iter(entry.get("DO", [])), ""),
            "source_url": next(iter(entry.get("UR", [])), ""),
            "publication_type": next(iter(entry.get("TY", [])), ""),
            "publisher": next(iter(entry.get("PB", [])), ""),
        })
    return parsed


def _container_end(text: str, position: int, opening: str) -> int:
    closing = "}" if opening == "{" else ")"
    braces = 0
    quoted = False
    while position < len(text):
        char = text[position]
        escaped = position > 0 and text[position - 1] == "\\"
        if char == '"' and not escaped:
            quoted = not quoted
        elif not quoted and char == "{" and not escaped:
            braces += 1
        elif not quoted and char == "}" and not escaped:
            if opening == "{" and braces == 0:
                return position
            braces -= 1
        elif not quoted and braces == 0 and char == closing:
            return position
        position += 1
    raise ValueError("The BibTeX file contains an unclosed entry.")


def _value(text: str, position: int) -> tuple[str, int]:
    while position < len(text) and text[position].isspace():
        position += 1
    if position < len(text) and text[position] == "{":
        end = _container_end(text, position + 1, "{")
        return text[position + 1:end].strip(), end + 1
    if position < len(text) and text[position] == '"':
        start = position + 1
        position += 1
        while position < len(text):
            if text[position] == '"' and text[position - 1] != "\\":
                return text[start:position].strip(), position + 1
            position += 1
        raise ValueError("The BibTeX file contains an unclosed quoted value.")
    start = position
    while position < len(text) and text[position] not in ",#":
        position += 1
    return text[start:position].strip(), position


def _fields(text: str) -> dict[str, str]:
    fields = {}
    position = 0
    while position < len(text):
        while position < len(text) and text[position] in " \t\r\n,":
            position += 1
        if position >= len(text):
            break
        match = re.match(r"[A-Za-z][A-Za-z0-9_-]*", text[position:])
        if not match:
            raise ValueError("The BibTeX file contains an invalid field name.")
        name = match.group().lower()
        position += len(match.group())
        while position < len(text) and text[position].isspace():
            position += 1
        if position >= len(text) or text[position] != "=":
            raise ValueError(f"The BibTeX field {name!r} is missing '='.")
        value, position = _value(text, position + 1)
        while position < len(text) and text[position] == "#":
            extra, position = _value(text, position + 1)
            value += extra
        fields[name] = value
        while position < len(text) and text[position].isspace():
            position += 1
        if position < len(text) and text[position] != ",":
            raise ValueError(f"The BibTeX field {name!r} is not comma-terminated.")
    return fields


def _bibtex_records(text: str) -> list[dict[str, Any]]:
    parsed = []
    position = 0
    while match := re.search(r"@([A-Za-z]+)\s*([({])", text[position:]):
        kind = match.group(1).lower()
        opening = match.group(2)
        start = position + match.end()
        end = _container_end(text, start, opening)
        body = text[start:end]
        position = end + 1
        if kind in {"comment", "preamble", "string"}:
            continue
        key_separator = body.find(",")
        if key_separator < 0:
            raise ValueError("A BibTeX entry is missing its citation key separator.")
        fields = _fields(body[key_separator + 1:])
        title = fields.get("title", "").strip()
        if not title:
            raise ValueError("Every BibTeX record must include a title.")
        authors = [
            _author(name)
            for name in re.split(r"\s+and\s+", fields.get("author", ""), flags=re.IGNORECASE)
            if name.strip()
        ]
        parsed.append({
            "title": title,
            "authors": authors,
            "publication_year": _year(fields.get("year", "")),
            "journal": fields.get("journal") or fields.get("booktitle", ""),
            "abstract": fields.get("abstract", ""),
            "doi": fields.get("doi", ""),
            "source_url": fields.get("url", ""),
            "publication_type": kind,
            "publisher": fields.get("publisher", ""),
        })
    return parsed


def parse_reference_import(content: bytes, extension: str) -> list[dict[str, Any]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("Citation files must use UTF-8 text encoding.") from error
    records = _ris_records(text) if extension == "ris" else _bibtex_records(text)
    if not records:
        raise ValueError("No reference records were found in the uploaded file.")
    if len(records) > 500:
        raise ValueError("Import no more than 500 references at a time.")
    return records
