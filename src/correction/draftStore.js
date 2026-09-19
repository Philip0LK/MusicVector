import {reconcileCropDraft} from '../cropGeometry.js';
import {readResource,writeResource} from '../localApi.js';
export function compactDocument(document){const copy=structuredClone(document);for(const row of copy.rows||[])delete row.src;return copy}
export async function readDraft(songId,incoming){const saved=await readResource('/api/drafts/'+encodeURIComponent(songId));return reconcileCropDraft(saved.value,compactDocument(incoming))}
export async function writeDraft(songId,initial,document,cursor){return writeResource('/api/drafts/'+encodeURIComponent(songId),{base:JSON.stringify(compactDocument(initial)),document:compactDocument(document),cursor})}

