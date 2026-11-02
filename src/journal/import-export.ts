import { validatePng } from './png';
import { JOURNAL_LIMITS, validateCapture, validateEntry, type JournalBundle, type JournalEntry } from './model';
import { imageAsset, type JournalRepository } from './repository';

interface Archive { format: 'iqterminal-journal'; version: 1; exportedAt: number; entries: unknown[]; captures: unknown[]; assets: { id: string; sha256: string; png: string }[] }
function bytesToBase64(bytes: Uint8Array) { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); }
export async function exportJournal(repository: JournalRepository, entries: readonly JournalEntry[]): Promise<Blob> {
  if (!entries.length || entries.length > JOURNAL_LIMITS.entriesPerImport) throw Error('Export between 1 and 1,000 entries at a time');
  const captures = new Map(), assets = new Map(); let bytes = 0;
  for (const entry of entries) {
    const capture = await repository.capture(entry.captureId); if (!capture) throw Error('Missing capture; export stopped'); captures.set(capture.id, capture);
    for (const id of [capture.image, capture.thumbnail]) if (id && !assets.has(id)) { const asset = await repository.asset(id); if (!asset) throw Error('Missing image; export stopped'); bytes += asset.bytes; if (bytes * 1.4 > JOURNAL_LIMITS.archiveBytes) throw Error('Export exceeds 100 MB; choose fewer entries'); assets.set(id, { id, sha256: asset.sha256, png: bytesToBase64(new Uint8Array(await asset.blob.arrayBuffer())) }); }
  }
  const archive: Archive = { format: 'iqterminal-journal', version: 1, exportedAt: Date.now(), entries: [...entries], captures: [...captures.values()], assets: [...assets.values()] };
  const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' }); if (blob.size > JOURNAL_LIMITS.archiveBytes) throw Error('Export exceeds 100 MB; choose fewer entries'); return blob;
}
export async function importJournal(repository: JournalRepository, file: Blob) {
  if (file.size > JOURNAL_LIMITS.archiveBytes) throw Error('Journal backups are limited to 100 MB');
  const archive = JSON.parse(await file.text()) as Archive;
  if (archive.format !== 'iqterminal-journal' || archive.version !== 1 || !Array.isArray(archive.entries) || !archive.entries.length || archive.entries.length > JOURNAL_LIMITS.entriesPerImport || !Array.isArray(archive.captures) || archive.captures.length > JOURNAL_LIMITS.entriesPerImport || !Array.isArray(archive.assets) || archive.assets.length > JOURNAL_LIMITS.entriesPerImport * 2) throw Error('Unsupported or oversized journal backup');
  const entries = archive.entries.map(validateEntry), captures = new Map(archive.captures.map(raw => { const c = validateCapture(raw); return [c.id, c]; }));
  if (new Set(entries.map(e => e.id)).size !== entries.length || captures.size !== archive.captures.length) throw Error('Duplicate records inside backup');
  const assets = new Map();
  for (const raw of archive.assets) {
    if (!raw || typeof raw.png !== 'string' || raw.png.length > JOURNAL_LIMITS.assetBytes * 1.4 || assets.has(raw.id)) throw Error('Invalid image in backup');
    const decoded = atob(raw.png), bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    validatePng(bytes);
    const asset = await imageAsset(raw.id, new Blob([bytes], { type: 'image/png' })); if (asset.sha256 !== raw.sha256) throw Error('Backup image checksum does not match'); assets.set(asset.id, asset);
  }
  const bundles: JournalBundle[] = entries.map(entry => { const capture = captures.get(entry.captureId); if (!capture) throw Error('Backup is missing a capture'); const images = [capture.image, capture.thumbnail].filter((id): id is string => Boolean(id)).map(id => { const asset = assets.get(id); if (!asset) throw Error('Backup is missing an image'); return asset; }); return { entry, capture, assets: images }; });
  return repository.save(bundles);
}
export function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
