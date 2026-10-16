"""Second independent check of the generated EDIFACT samples (D47), with pydifact instead of our own code.

pydifact tokenises each interchange (separators, release character, segment terminator) and splits it into
messages. On top of that, this script checks the envelope rules every EDIFACT receiver applies: UNT counts the
segments from UNH to UNT and repeats the UNH reference, UNZ counts the messages and repeats the UNB reference,
UNB declares UNOC syntax version 3 and every character fits that character set (ISO 8859-1).

The message structure against the UN/EDIFACT D.01B tables is checked separately by ts-edifact
(frontend/lib/domain/edifact-independent.test.ts), which also writes the samples this script reads.

Usage (from the repository root): backend/.venv/bin/python scripts/edi_syntax_check.py [fixtures/edi-samples]
"""

import sys
import warnings
from pathlib import Path

from pydifact.parser import Parser
from pydifact.segmentcollection import Interchange

warnings.filterwarnings("ignore")  # pydifact warns that it has no D.01B segment XML; structure is ts-edifact's job


def check(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    problems: list[str] = []
    try:
        text.encode("iso-8859-1")
    except UnicodeEncodeError as exc:
        problems.append(f"character outside UNOC (ISO 8859-1): {exc.object[exc.start:exc.end]!r}")
    try:
        interchange = Interchange.from_str(text.replace("\n", ""))
    except Exception as exc:  # pydifact raises several types for malformed input
        return problems + [f"pydifact could not parse it: {exc}"]
    if tuple(interchange.syntax_identifier) != ("UNOC", 3):
        problems.append(f"UNB syntax identifier is {interchange.syntax_identifier}, expected UNOC version 3")
    messages = list(interchange.get_messages())
    # The raw segments as pydifact's parser reads them (Interchange rebuilds UNZ itself, so read the real one).
    raw = list(Parser().parse(text.replace("\n", "")))
    tags = [s.tag for s in raw]
    unz = raw[-1] if tags and tags[-1] == "UNZ" else None
    if unz is None or str(unz.elements[0]) != str(len(messages)):
        problems.append(f"UNZ message count {unz.elements[0] if unz else None} != {len(messages)} messages")
    if unz is not None and unz.elements[1] != interchange.control_reference:
        problems.append("UNZ does not repeat the UNB interchange reference")
    for m in messages:
        start = tags.index("UNH")
        end = tags.index("UNT", start)
        unh, unt = raw[start], raw[end]
        if str(unt.elements[0]) != str(end - start + 1):
            problems.append(f"{m.type}: UNT says {unt.elements[0]} segments, pydifact counts {end - start + 1}")
        if unt.elements[1] != unh.elements[0]:
            problems.append(f"{m.type}: UNT reference {unt.elements[1]} != UNH reference {unh.elements[0]}")
        if m.version != "D.01B":
            problems.append(f"{m.type}: directory {m.version}, expected D.01B")
    return problems


def main() -> int:
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures/edi-samples")
    files = sorted(folder.glob("*.edi"))
    if not files:
        print(f"No .edi samples in {folder}")
        return 1
    failed = 0
    for f in files:
        problems = check(f)
        print(f"{'FAIL' if problems else 'ok  '} {f.name}" + "".join(f"\n     - {p}" for p in problems))
        failed += bool(problems)
    print(f"pydifact syntax check: {len(files) - failed} of {len(files)} samples passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
