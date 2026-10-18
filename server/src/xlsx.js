import { strToU8, zipSync } from 'fflate';

// A small, dependency-free .xlsx (Excel) writer.
// Why not a library: the Excel libraries pull in dozens of nested packages, and the Electron packager mixed up two versions of one of them,
// which broke the installed app. This file only needs `fflate` (zero dependencies).
//
// sheet = { name, columns: [{ header, key, type, width, total }], rows: [{ [key]: value }], note?: string }
//   type: 'text' (default) | 'money' | 'qty' | 'int' | 'date'  ('date' takes a Date, or 'YYYY-MM-DD')
//   total: true  -> adds a TOTAL row with a live SUM formula under that column
// info sheet = { name, lines: [[label, value], ...] }

const ST = { default: 0, header: 1, money: 2, qty: 3, int: 4, date: 5, totalLabel: 6, totalMoney: 7, totalQty: 8, totalInt: 9, note: 10, bold: 11 };
const CELL_STYLE = { text: ST.default, money: ST.money, qty: ST.qty, int: ST.int, date: ST.date };
const TOTAL_STYLE = { money: ST.totalMoney, qty: ST.totalQty, int: ST.totalInt };

const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const col = (i) => { let n = i + 1, s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const serial = (v) => {
  const d = v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 86400000) + 25569; // days since 1899-12-30
};

const str = (ref, text, s = 0) => `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
const num = (ref, n, s = 0) => `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${n}</v></c>`;

function cell(ref, value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'date') { const n = serial(value); return n === null ? str(ref, value) : num(ref, n, ST.date); }
  if (type === 'money' || type === 'qty' || type === 'int') { const n = Number(value); return Number.isFinite(n) ? num(ref, n, CELL_STYLE[type]) : str(ref, value); }
  return str(ref, value);
}

function sheetXml({ columns, rows, note }) {
  const out = [];
  const widths = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`).join('');
  out.push(`<row r="1" ht="22" customHeight="1">${columns.map((c, i) => str(`${col(i)}1`, c.header, ST.header)).join('')}</row>`);
  let r = 1;
  for (const row of rows) {
    r++;
    out.push(`<row r="${r}">${columns.map((c, i) => cell(`${col(i)}${r}`, row[c.key], c.type)).join('')}</row>`);
  }
  const last = r;
  if (rows.length && columns.some((c) => c.total)) {
    r++;
    const cells = columns.map((c, i) => {
      const ref = `${col(i)}${r}`;
      if (i === 0) return str(ref, 'TOTAL', ST.totalLabel);
      if (!c.total) return `<c r="${ref}" s="${ST.totalLabel}"/>`;
      const sum = rows.reduce((a, x) => a + (Number(x[c.key]) || 0), 0);
      return `<c r="${ref}" s="${TOTAL_STYLE[c.type] ?? ST.totalMoney}"><f>SUM(${col(i)}2:${col(i)}${last})</f><v>${Math.round(sum * 1e6) / 1e6}</v></c>`;
    });
    out.push(`<row r="${r}">${cells.join('')}</row>`);
  }
  if (note) { r++; out.push(`<row r="${r}">${str(`A${r}`, note, ST.note)}</row>`); }
  const filter = rows.length ? `<autoFilter ref="A1:${col(columns.length - 1)}${last}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths}</cols><sheetData>${out.join('')}</sheetData>${filter}</worksheet>`;
}

function infoXml(lines) {
  const rows = lines.map(([k, v], i) => `<row r="${i + 1}">${str(`A${i + 1}`, k, ST.bold)}${typeof v === 'number' ? num(`B${i + 1}`, v) : str(`B${i + 1}`, v ?? '')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="60" customWidth="1"/></cols><sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.##"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="165" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="1" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** sheets: array of table sheets ({ name, columns, rows, note }) and info sheets ({ name, lines }). Returns the .xlsx bytes. */
export function buildXlsx(sheets, { creator = 'Imprimerie ERP' } = {}) {
  const NS = 'http://schemas.openxmlformats.org/';
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS}package/2006/relationships"><Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="${NS}package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="${NS}package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${esc(creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}spreadsheetml/2006/main" xmlns:r="${NS}officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS}package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${NS}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.lines ? infoXml(s.lines) : sheetXml(s)); });
  return zipSync(files, { level: 6 });
}
