#!/usr/bin/env python3
"""Extract the small, reproducible subset needed by the TCMBank ECFP index.

Uses only Python's standard library so the 60+ MB official XLSX does not need to
be committed or loaded by the production service.
"""

from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REQUIRED = {"TCMBank_ID", "name", "Smiles"}
HERB_COLUMNS = ("TCM_name", "TCM_name_en", "TCM_name2")


def shared_strings(book: zipfile.ZipFile) -> list[str]:
    values: list[str] = []
    with book.open("xl/sharedStrings.xml") as source:
        for _, element in ET.iterparse(source, events=("end",)):
            if element.tag == NS + "si":
                values.append("".join(node.text or "" for node in element.iter(NS + "t")))
                element.clear()
    return values


def column_name(reference: str) -> str:
    match = re.match(r"[A-Z]+", reference)
    return match.group(0) if match else ""


def row_values(element: ET.Element, strings: list[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    for cell in element.findall(NS + "c"):
        column = column_name(cell.attrib.get("r", ""))
        value = cell.find(NS + "v")
        text = "" if value is None else value.text or ""
        if cell.attrib.get("t") == "s" and text:
            text = strings[int(text)]
        values[column] = text.strip()
    return values


def split_herbs(*values: str) -> list[str]:
    herbs: list[str] = []
    seen: set[str] = set()
    for value in values:
        for item in re.split(r"\s*[;|]\s*", value or ""):
            item = item.strip()
            key = item.casefold()
            if item and key not in seen:
                seen.add(key)
                herbs.append(item)
    return herbs


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract-tcmbank-structure-source.py ingredient_all.xlsx output.ndjson")
    source, output = map(Path, sys.argv[1:])
    if not source.is_file():
        raise SystemExit(f"Source not found: {source}")

    emitted = 0
    missing_structure = 0
    missing_herb_relation = 0
    with zipfile.ZipFile(source) as book, output.open("w", encoding="utf-8", newline="\n") as target:
        strings = shared_strings(book)
        headers: dict[str, str] | None = None
        with book.open("xl/worksheets/sheet1.xml") as sheet:
            for _, element in ET.iterparse(sheet, events=("end",)):
                if element.tag != NS + "row":
                    continue
                row = row_values(element, strings)
                element.clear()
                if headers is None:
                    headers = {value: column for column, value in row.items()}
                    missing = REQUIRED.difference(headers)
                    if missing:
                        raise SystemExit(f"Missing required columns: {', '.join(sorted(missing))}")
                    continue
                tcmbank_id = row.get(headers["TCMBank_ID"], "")
                name = row.get(headers["name"], "")
                smiles = row.get(headers["Smiles"], "")
                herbs = split_herbs(*(row.get(headers.get(column, ""), "") for column in HERB_COLUMNS))
                if not smiles:
                    missing_structure += 1
                    continue
                if not herbs:
                    missing_herb_relation += 1
                    continue
                record = {
                    "id": tcmbank_id,
                    "name": name,
                    "smiles": smiles,
                    "pubchemId": row.get(headers.get("PubChem_id", ""), ""),
                    "herbs": herbs,
                }
                target.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
                emitted += 1
    print(json.dumps({
        "source": str(source),
        "output": str(output),
        "records": emitted,
        "missingStructure": missing_structure,
        "missingHerbRelation": missing_herb_relation,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
