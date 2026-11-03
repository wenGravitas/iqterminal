import { validatePng } from './png';
import { imageMimeFromBytes, validateImageBytes } from './image-format';
import {
  JOURNAL_LIMITS, utcMs, validateDraft, validateEntry,
  type JournalAsset, type JournalDraft, type JournalEntry,
} from './model';
import { imageAsset, type JournalRepository } from './repository';

interface ArchiveAsset { id: string; mime: JournalAsset['mime']; bytes: number; sha256: string; base64: string }
interface ArchivePayload { format: 'iqterminal-journal'; version: 2; exportedAt: number; entries: JournalEntry[]; drafts: JournalDraft[]; assets: ArchiveAsset[] }
interface Archive extends ArchivePayload { checksum: string }
const MAX_ARCHIVE_ASSETS = 4096;

function bytesToBase64(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
function stableJson(value: unknown): string {
  const normalize = (v: any): any => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(key => [key, normalize(v[key])])) : v;
  return JSON.stringify(normalize(value));
}
async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function referencedAssetIds(records: readonly (JournalEntry | JournalDraft)[]) {
  return [...new Set(records.flatMap(record => {
    const attachments = 'revisions' in record ? [...record.attachments, ...record.revisions.flatMap(revision => revision.attachments)] : record.attachments;
    return attachments.flatMap(attachment => [attachment.assetId, attachment.thumbnailAssetId].filter((value): value is string => Boolean(value)));
  }))];
}
function recordObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid journal backup structure');
  return value as Record<string, any>;
}
function exactKeys(record: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(record).sort(), sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) throw Error('Unexpected journal backup fields');
}
function decodeBase64(value: unknown, maximum: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(maximum / 3) * 4 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw Error('Invalid or oversized image in backup');
  const decoded = atob(value), bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
  if (bytes.byteLength > maximum) throw Error('Backup image exceeds the 20 MB asset limit');
  return bytes;
}

/** Export selected durable entries and optional drafts into the checksummed R2 archive. */
export async function exportJournal(repository: JournalRepository, selectedEntries: readonly JournalEntry[], selectedDrafts: readonly JournalDraft[] = []): Promise<Blob> {
  if (!selectedEntries.length && !selectedDrafts.length) throw Error('Select at least one journal entry or draft to export');
  if (selectedEntries.length + selectedDrafts.length > JOURNAL_LIMITS.entriesPerImport) throw Error('Export up to 1,000 entries and drafts at a time');
  const entries = selectedEntries.map(validateEntry), drafts = selectedDrafts.map(validateDraft);
  const records = [...entries, ...drafts], assetIds = referencedAssetIds(records);
  if (assetIds.length > MAX_ARCHIVE_ASSETS) throw Error('Export has too many individual attachments');
  const assets: ArchiveAsset[] = []; let assetBytes = 0;
  for (const id of assetIds) {
    const asset = await repository.asset(id);
    if (!asset) throw Error(`Missing attachment ${id}; export stopped`);
    assetBytes += asset.bytes;
    if (assetBytes > JOURNAL_LIMITS.archiveBytes) throw Error('Export exceeds 100 MB; choose fewer entries or drafts');
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    validateImageBytes(bytes, asset.mime);
    if (await sha256(bytes) !== asset.sha256) throw Error(`Attachment ${id} checksum does not match; export stopped`);
    if (asset.mime === 'image/png') validatePng(bytes);
    assets.push({ id, mime: asset.mime, bytes: asset.bytes, sha256: asset.sha256, base64: bytesToBase64(bytes) });
  }
  const payload: ArchivePayload = { format: 'iqterminal-journal', version: 2, exportedAt: Date.now(), entries, drafts, assets };
  const checksum = await sha256(new TextEncoder().encode(stableJson(payload)));
  const archive: Archive = { ...payload, checksum };
  const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' });
  if (blob.size > JOURNAL_LIMITS.archiveBytes) throw Error('Export exceeds 100 MB; choose fewer entries or drafts');
  return blob;
}

/** Validate the complete archive before making one atomic repository import. */
export async function importJournal(repository: JournalRepository, file: Blob) {
  if (!(file instanceof Blob) || file.size <= 0 || file.size > JOURNAL_LIMITS.archiveBytes) throw Error('Journal backups are limited to 100 MB');
  let archive: Record<string, any>;
  try { archive = recordObject(JSON.parse(await file.text())); } catch (error) { throw Error(`Could not read journal backup: ${error instanceof Error ? error.message : String(error)}`); }
  exactKeys(archive, ['format', 'version', 'exportedAt', 'entries', 'drafts', 'assets', 'checksum']);
  if (archive.format !== 'iqterminal-journal' || archive.version !== 2) throw Error('Unsupported journal backup version; original records were not changed');
  utcMs(archive.exportedAt);
  if (!Array.isArray(archive.entries) || !Array.isArray(archive.drafts) || !Array.isArray(archive.assets)
    || archive.entries.length + archive.drafts.length === 0 || archive.entries.length + archive.drafts.length > JOURNAL_LIMITS.entriesPerImport
    || archive.assets.length > MAX_ARCHIVE_ASSETS || typeof archive.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(archive.checksum)) throw Error('Unsupported or oversized journal backup');
  const { checksum, ...payload } = archive;
  const actualChecksum = await sha256(new TextEncoder().encode(stableJson(payload)));
  if (actualChecksum !== checksum.toLowerCase()) throw Error('Journal backup checksum does not match');

  const entries = archive.entries.map(validateEntry), drafts = archive.drafts.map(validateDraft), assets = new Map<string, JournalAsset>();
  if (new Set(entries.map((entry: JournalEntry) => entry.id)).size !== entries.length || new Set(drafts.map((draft: JournalDraft) => draft.id)).size !== drafts.length
    || entries.some((entry: JournalEntry) => drafts.some((draft: JournalDraft) => draft.id === entry.id))) throw Error('Duplicate records inside backup');
  let totalAssetBytes = 0;
  for (const rawValue of archive.assets) {
    const raw = recordObject(rawValue); exactKeys(raw, ['id', 'mime', 'bytes', 'sha256', 'base64']);
    if (typeof raw.id !== 'string' || typeof raw.mime !== 'string' || !['image/png', 'image/jpeg', 'image/webp'].includes(raw.mime)
      || !Number.isInteger(raw.bytes) || raw.bytes <= 0 || raw.bytes > JOURNAL_LIMITS.assetBytes || typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.sha256)
      || assets.has(raw.id)) throw Error('Invalid or duplicate image in backup');
    const bytes = decodeBase64(raw.base64, JOURNAL_LIMITS.assetBytes);
    if (bytes.byteLength !== raw.bytes) throw Error('Backup image size does not match its metadata');
    const mime = imageMimeFromBytes(bytes); if (mime !== raw.mime) throw Error('Backup image type does not match its content');
    validateImageBytes(bytes, mime); if (mime === 'image/png') validatePng(bytes);
    totalAssetBytes += bytes.byteLength; if (totalAssetBytes > JOURNAL_LIMITS.archiveBytes) throw Error('Backup attachment bytes exceed the 100 MB limit');
    const asset = await imageAsset(raw.id, new Blob([bytes], { type: mime }));
    if (asset.sha256 !== raw.sha256.toLowerCase()) throw Error('Backup image checksum does not match');
    assets.set(asset.id, asset);
  }
  const references = new Set(referencedAssetIds([...entries, ...drafts]));
  if (assets.size !== references.size || [...assets.keys()].some(id => !references.has(id))) throw Error('Backup contains missing or unreferenced attachment assets');
  for (const id of references) if (!assets.has(id)) throw Error(`Backup is missing attachment ${id}`);
  return repository.importRecords(entries, drafts, [...assets.values()]);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
