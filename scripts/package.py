"""Deterministic source-only extension ZIP; no external dependencies."""
from pathlib import Path
import hashlib
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'extension'
dest = root / 'dist'
dest.mkdir(exist_ok=True)
archive = dest / 'swift-passkey-transfer-extension.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for path in sorted(source.rglob('*')):
        if path.is_symlink():
            raise ValueError('Symlinks are not allowed')
        if not path.is_file():
            continue
        if path.name.startswith('.') or '.local.' in path.name:
            raise ValueError('Local files must not be packaged')
        entry = zipfile.ZipInfo(path.relative_to(source).as_posix(), (2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        z.writestr(entry, path.read_bytes())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(dest / 'SHA256SUMS.txt').write_text(digest + '  ' + archive.name + '\n')
print('Created dist/' + archive.name)
