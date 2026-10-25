import { Button, Group, Menu } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconDownload, IconFileSpreadsheet, IconFileText, IconShare } from '@tabler/icons-react';

export interface ListExport {
  /** Shown as the share title and the first line of the text. */
  title: string;
  /** File name without extension, e.g. "savepoint-wishlist". */
  filename: string;
  /** One line per item for sharing ("Hades II (Switch), up to €20"). */
  lines: string[];
  /** Spreadsheet columns and rows for the CSV. */
  columns: string[];
  rows: (string | number | undefined)[][];
}

function asText(list: ListExport): string {
  return [`${list.title} (${list.lines.length})`, '', ...list.lines.map((l) => `• ${l}`)].join('\n');
}

function asCsv(list: ListExport): string {
  const cell = (v: string | number | undefined) => {
    const s = v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // The byte-order mark makes Excel read accents (é, ć) correctly.
  return '﻿' + [list.columns, ...list.rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    notifications.show({ message, autoClose: 2200 });
  } catch {
    notifications.show({ message: "Couldn't copy. Use Export instead.", color: 'red' });
  }
}

/**
 * Share (the phone's share sheet, or copied text on a computer) and Export
 * (a spreadsheet or a text file) for a list like the wishlist.
 */
export function ShareExport({ list }: { list: ListExport }) {
  const disabled = !list.lines.length;

  const share = async () => {
    const text = asText(list);
    if (navigator.share) {
      try {
        await navigator.share({ title: list.title, text });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return; // Closed the share sheet.
      }
    }
    await copy(text, 'List copied. Paste it anywhere to share it.');
  };

  return (
    <Group gap="xs" wrap="nowrap">
      <Button variant="default" size="xs" leftSection={<IconShare size={15} />} onClick={share} disabled={disabled}>
        Share
      </Button>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button variant="default" size="xs" leftSection={<IconDownload size={15} />} disabled={disabled}>
            Export
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconFileSpreadsheet size={16} />}
            onClick={() => download(`${list.filename}.csv`, asCsv(list), 'text/csv;charset=utf-8')}
          >
            Spreadsheet (.csv)
          </Menu.Item>
          <Menu.Item
            leftSection={<IconFileText size={16} />}
            onClick={() => download(`${list.filename}.txt`, asText(list), 'text/plain;charset=utf-8')}
          >
            Text file (.txt)
          </Menu.Item>
          <Menu.Item leftSection={<IconCopy size={16} />} onClick={() => copy(asText(list), 'List copied.')}>
            Copy as text
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
