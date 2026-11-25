import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';
import { createMeetingDocx, documentMarkdown } from './meetingDocument.js';
import { marked } from 'marked';
const readable = (markdown) => marked.parse(markdown).replace(/<[^>]*>/g, '');

test('native DOCX roundtrip preserves headings, tables, emphasis and meeting facts', async () => {
  const input = '# Notulen Stock Opname\n\n## Pembahasan\n\nPak Risa memeriksa **125 unit** pada 15 September 2026.\n\n- Selisih 7 unit perlu diperiksa.\n- Tenggat belum disebutkan.\n\n| Barang | Jumlah |\n| --- | --- |\n| Stok A | 125 unit |\n| Selisih | 7 unit |';
  const bytes = await createMeetingDocx(input, 'Rapat.m4a');
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const { markdown } = await exportMarkdown(bytes);
  for (const fact of ['Notulen Stock Opname', 'Pembahasan', '125 unit', '15 September 2026', '7 unit', 'Tenggat belum disebutkan', 'Stok A']) assert.ok(markdown.includes(fact), fact);
  assert.match(markdown, /\*\*125 unit\*\*/);
  assert.match(markdown, /\|.*Barang.*\|/);
  assert.match(markdown, /^# Notulen/m);
});

test('legacy HTML converts to DOCX without losing tables or numeric facts', async () => {
  const input = '<h1>Rapat</h1><p>Nilai <strong>Rp 2.500.000</strong>, selisih 3,5%.</p><table><tr><th>PIC</th><th>Status</th></tr><tr><td>Risa</td><td>Belum selesai</td></tr></table>';
  assert.match(documentMarkdown(input), /\*\*Rp 2\.500\.000\*\*/);
  const { markdown } = await exportMarkdown(await createMeetingDocx(input));
  for (const fact of ['Rp 2.500.000', '3,5%', 'Risa', 'Belum selesai']) assert.ok(readable(markdown).includes(fact), fact);
});

test('raw transcript wording is preserved when generating a document', async () => {
  const raw = 'eee pak kita hitung ulang ya, 17 barang bukan 70.\nTidak ada tenggat.';
  const { markdown } = await exportMarkdown(await createMeetingDocx(raw));
  assert.ok(readable(markdown).includes('eee pak kita hitung ulang ya, 17 barang bukan 70.'));
  assert.ok(readable(markdown).includes('Tidak ada tenggat.'));
});
