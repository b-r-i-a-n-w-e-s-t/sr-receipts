// Generates the three NVDA rig fixtures. Run: node build-fixtures.mjs
// One generator so shape-05 and shape-G are byte-identical apart from the
// detail markup: any audio difference between them is semantic, not incidental.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const LIST = 'cl'
const TITLE = 'Historical Structures'

const columns = [
  { id: 'survey', label: 'Last Survey' },
  { id: 'description', label: 'Description', descriptive: true },
  { id: 'style', label: 'Style' },
  { id: 'condition', label: 'Condition' },
  { id: 'region', label: 'Region Code' }
]

const rows = [
  { id: 1, survey: '8/15/2024', description: 'Norman keep with distinctive crenellations', style: 'Norman', condition: 'Good', region: 'NOR-789', expandable: true },
  { id: 2, survey: '9/12/2024', description: 'Romanesque fortress with moat', style: 'Romanesque', condition: 'Ruins', region: 'WAL-123' },
  { id: 3, survey: '10/5/2024', description: 'Tudor gatehouse with spiral towers', style: 'Tudor', condition: 'Fair', region: 'SUR-345' },
  { id: 4, survey: '10/18/2024', description: 'Early English fortress with round towers', style: 'Early English', condition: 'Ruins', region: 'COR-890', expandable: true },
  { id: 5, survey: '9/25/2024', description: 'Victorian restoration of medieval castle', style: 'Neo-Gothic', condition: 'Excellent', region: 'DEV-234' },
  { id: 6, survey: '11/2/2024', description: 'Motte and bailey with wooden palisade', style: 'Anglo-Saxon', condition: 'Ruins', region: 'ESS-901' },
  { id: 7, survey: '10/30/2024', description: 'Shell keep on artificial mound', style: 'Norman', condition: 'Fair', region: 'BER-567', expandable: true },
  { id: 8, survey: '11/15/2024', description: 'Coastal fortress with gun emplacements', style: 'Military', condition: 'Good', region: 'DOR-123' },
  { id: 9, survey: '9/8/2024', description: 'Medieval hall house with timber framing', style: 'Medieval', condition: 'Fair', region: 'CHE-456' },
  { id: 10, survey: '10/12/2024', description: 'Triangular castle with corner towers', style: 'Geometric', condition: 'Ruins', region: 'NOR-012', expandable: true },
  { id: 11, survey: '11/8/2024', description: 'Square keep with machicolations', style: 'Norman', condition: 'Fair', region: 'DUR-678' },
  { id: 12, survey: '10/22/2024', description: 'Clifftop stronghold with sea defenses', style: 'Coastal', condition: 'Ruins', region: 'COR-234' },
  { id: 13, survey: '9/18/2024', description: 'Palladian villa with Roman influences', style: 'Palladian', condition: 'Good', region: 'GLO-567', expandable: true },
  { id: 14, survey: '11/20/2024', description: 'Fortified manor with moated gardens', style: 'Fortified Manor', condition: 'Excellent', region: 'SUF-123' },
  { id: 15, survey: '10/2/2024', description: 'Concentric castle with double curtain wall', style: 'Concentric', condition: 'Good', region: 'KEN-456' }
]

const describedBy = row => columns.filter(c => c.descriptive).map(c => `${LIST}-${c.id}-${row.id}`).join(' ')

// Detail content: an h4 (the element axe currently trips on), plus a link and a
// button so control reachability inside the panel can be judged.
const detailBody = row => `
              <h4>Additional Details</h4>
              <p><strong>Architectural Features:</strong> Features include pointed arches, rib vaults, and extensive use of flying buttresses.</p>
              <p><strong>Last Surveyor:</strong> Dr. Smith. <a href="#survey-${row.id}">View survey ${row.id}</a></p>
              <p><button type="button">Request re-survey</button></p>`

const styles = `
    :root { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    body { margin: 0; padding: 1.5rem clamp(1rem, 4vw, 3rem); color: #161616; background: #f4f4f4; line-height: 1.5; }
    h1 { font-size: 1.4rem; }
    .intro, .listen { background: #fff; border: 1px solid #e0e0e0; border-left: 4px solid #0f62fe; padding: .75rem 1rem; margin: 1rem 0; border-radius: 2px; }
    .listen { border-left-color: #8a3ffc; font-size: .9rem; }
    .listen strong { color: #8a3ffc; }
    code { background: #e8e8e8; padding: .1em .35em; border-radius: 3px; font-size: .9em; }
    .mode-check { margin: 2rem 0 4rem; background: #fff; border: 1px solid #e0e0e0; padding: .75rem 1rem; }

    /* Class names mirror ../carbon-svelte/src/lib/ColumnList.svelte so the
       fixture and the component can be diffed by eye. */
    .column-list { max-width: 72rem; }
    .column-list-table-wrapper { background: #fff; border: 1px solid #c6c6c6; }
    .column-list-head { display: flex; align-items: center; background: #e0e0e0; }
    .column-list-colhead { padding: 6px 8px; font-weight: 600; flex-grow: 1; flex-basis: 0; }
    .column-list-colhead.select-all, .column-list-colhead.expand { flex: 0 0 2.5rem; }
    .column-list-colhead.actions { flex: 0 0 11rem; text-align: end; }
    .column-list-colhead.overflow { flex: 0 0 2rem; }
    .column-list-row { border-bottom: 1px solid #e0e0e0; }
    .column-list-row:last-child { border-bottom: 0; }
    .column-list-cols { display: flex; align-items: flex-start; background: #f4f4f4; }
    .column-list-col { padding: 8px; flex-grow: 1; flex-basis: 0; }
    .column-list-col.checkbox, .column-list-col.expand { flex: 0 0 2.5rem; }
    .column-list-col.actions { flex: 0 0 11rem; display: flex; gap: 4px; justify-content: flex-end; }
    .column-list-col.overflow { flex: 0 0 2rem; }
    .column-list-expandable { padding: 8px 8px 8px 3rem; background: #fff; }
    .column-list-expandable h4 { margin: 0 0 .5rem; font-size: 1rem; }
    .column-list-expandable p { margin: .25rem 0; }
    table.native { border-collapse: collapse; width: 100%; max-width: 72rem; background: #fff; border: 1px solid #c6c6c6; }
    table.native th, table.native td { padding: .6rem .75rem; text-align: left; border-bottom: 1px solid #e0e0e0; }
    table.native th { background: #e0e0e0; }
    a { color: #0f62fe; }`

// Shape G only: the row wraps so the detail cell can span it, and the mirrored
// columnheader is present but zero-width.
const shapeGStyles = `
    /* SHAPE G ONLY */
    .column-list-cols { flex-wrap: wrap; }
    .column-list-col.detail { flex: 0 0 100%; padding: 0; }
    .column-list-colhead.detail { flex: 0 0 0; padding: 0; }`

const page = ({ file, h1, intro, listen, body, extraStyles = '' }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${h1}</title>
  <style>${styles}${extraStyles}
  </style>
</head>
<body>
  <h1>${h1}</h1>
  <div class="intro">
    <p><strong>Fixture:</strong> <code>${file}</code> (generated by <code>build-fixtures.mjs</code>; edit the generator, not this file).</p>
    ${intro}
  </div>
  <div class="listen"><strong>Listen for:</strong> ${listen}</div>
${body}
  <div class="mode-check">
    <label for="mode-check-input">Focus-mode check (put focus here, then try <code>T</code> again)</label><br>
    <input id="mode-check-input" type="text" size="40">
  </div>
</body>
</html>
`

// ---------------------------------------------------------------- control
const nativeRows = rows.map(r => `      <tr><td>${r.survey}</td><td>${r.description}</td><td>${r.style}</td><td>${r.condition}</td><td>${r.region}</td></tr>`).join('\n')
const controlBody = `  <h2>Table one: ${TITLE}</h2>
  <table class="native">
    <caption>${TITLE}</caption>
    <thead>
      <tr>${columns.map(c => `<th scope="col">${c.label}</th>`).join('')}</tr>
    </thead>
    <tbody>
${nativeRows}
    </tbody>
  </table>

  <h2>Table two: Survey Staff</h2>
  <table class="native">
    <caption>Survey Staff</caption>
    <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Region</th></tr></thead>
    <tbody>
      <tr><td>Dr. Smith</td><td>Lead surveyor</td><td>NOR</td></tr>
      <tr><td>Dr. Williams</td><td>Surveyor</td><td>WAL</td></tr>
      <tr><td>Dr. Davis</td><td>Conservator</td><td>SUR</td></tr>
    </tbody>
  </table>
`

writeFileSync(join(here, 'control.html'), page({
  file: 'control.html',
  h1: 'Control: native &lt;table&gt; (validates the rig, not the component)',
  intro: `<p>Two plain native tables. Nothing here is under test: the point is to prove the rig reports
    correctly on markup whose behavior is not in question. Until <code>T</code>, <code>Shift+T</code> and
    <code>Ctrl+Alt+arrows</code> all behave here, no result from the other two fixtures means anything
    (ticket 02).</p>`,
  listen: `<code>T</code> reaches table one and announces "table, 16 rows, 5 columns" or equivalent;
    <code>T</code> again moves to table two; <code>Shift+T</code> comes back. <code>Ctrl+Alt+arrows</code>
    moves cell to cell and announces the column header on entry. NVDA says "browse mode" on load, and
    <code>T</code> stops working once focus is in the text input at the bottom.`,
  body: controlBody
}))

// ------------------------------------------------------- ColumnList shapes
const head = shape => {
  const cells = [
    `        <div class="column-list-colhead select-all" role="columnheader" aria-label="Select"><input type="checkbox" id="${LIST}-select-all"><label for="${LIST}-select-all"><span class="sr-only" style="position:absolute;left:-9999px">select all</span></label></div>`,
    `        <div class="column-list-colhead expand" role="columnheader" aria-label="Expand">&nbsp;</div>`,
    ...columns.map(c => `        <div id="${LIST}-${c.id}" class="column-list-colhead" role="columnheader">${c.label}</div>`),
    `        <div class="column-list-colhead actions" role="columnheader">Actions</div>`,
    `        <div class="column-list-colhead overflow" role="columnheader" aria-label="Columns">&nbsp;</div>`
  ]
  if (shape === 'G') cells.push(`        <div class="column-list-colhead detail" role="columnheader" aria-label="Details"></div>`)
  return `      <div class="column-list-head" role="row">\n${cells.join('\n')}\n      </div>`
}

const dataCells = row => [
  `          <div class="column-list-col checkbox" role="cell"><input type="checkbox" id="${LIST}-select-${row.id}" aria-describedby="${describedBy(row)}"></div>`,
  `          <div class="column-list-col expand" role="cell">${row.expandable
    ? `<button type="button" aria-expanded="true" aria-controls="${LIST}-detail-${row.id}" aria-describedby="${describedBy(row)}" data-row="${row.id}">&#9650;<span style="position:absolute;left:-9999px">Collapse Row</span></button>`
    : '&nbsp;'}</div>`,
  ...columns.map(c => `          <div id="${LIST}-${c.id}-${row.id}" class="column-list-col regular ${c.id}" role="cell">${row[c.id]}</div>`),
  `          <div class="column-list-col actions" role="cell"><button type="button" aria-describedby="${describedBy(row)}">Edit</button><button type="button" aria-describedby="${describedBy(row)}">Delete</button></div>`,
  `          <div class="column-list-col overflow" role="cell">&nbsp;</div>`
]

// Shape 05 (shipped): detail is a role="group" sibling of the cell row, inside
// the per-row rowgroup. Rendered only while expanded.
const row05 = row => `        <div class="column-list-row" role="rowgroup">
        <div class="column-list-cols" role="row">
${dataCells(row).join('\n')}
        </div>${row.expandable ? `
        <div class="column-list-expandable" id="${LIST}-detail-${row.id}" role="group" aria-labelledby="${LIST}-detail-label-${row.id} ${describedBy(row)}">
          <span id="${LIST}-detail-label-${row.id}" hidden>Details</span>${detailBody(row)}
        </div>` : ''}
        </div>`

// Shape G (candidate): detail is the last role="cell" of the data row, mirrored
// by an aria-label="Details" columnheader. The cell is always present for cell
// parity; only its content is gated on expansion.
const rowG = row => `        <div class="column-list-row" role="rowgroup">
        <div class="column-list-cols" role="row">
${dataCells(row).join('\n')}
          <div class="column-list-col detail" role="cell">${row.expandable ? `<div class="column-list-expandable" id="${LIST}-detail-${row.id}">${detailBody(row)}
          </div>` : ''}</div>
        </div>
        </div>`

const toggleScript = shape => `  <script>
    // Mirrors the component: shape 05 removes the group entirely when collapsed;
    // shape G keeps the parity cell and empties its content.
    document.addEventListener('click', e => {
      const btn = e.target.closest('button[data-row]')
      if (!btn) return
      const expanded = btn.getAttribute('aria-expanded') === 'true'
      const rowgroup = btn.closest('.column-list-row')
      const panel = rowgroup.querySelector('.column-list-expandable')
      ${shape === 'G'
        ? `const holder = rowgroup.querySelector('.column-list-col.detail')
      if (expanded) { holder.dataset.saved = holder.innerHTML; holder.innerHTML = '' }
      else { holder.innerHTML = holder.dataset.saved ?? '' }`
        : `if (expanded) { rowgroup.dataset.saved = panel.outerHTML; panel.remove() }
      else { rowgroup.insertAdjacentHTML('beforeend', rowgroup.dataset.saved ?? '') }`}
      btn.setAttribute('aria-expanded', String(!expanded))
      btn.innerHTML = (!expanded ? '&#9650;' : '&#9660;') + '<span style="position:absolute;left:-9999px">' + (!expanded ? 'Collapse' : 'Expand') + ' Row</span>'
    })
  </script>`

const listBody = shape => `  <div class="column-list">
    <div hidden aria-hidden="true" id="${LIST}-list-title">${TITLE}</div>
    <div class="column-list-table-wrapper" role="table" aria-labelledby="${LIST}-list-title">
${head(shape)}
      <div class="column-list-rows" role="presentation">
${rows.map(shape === 'G' ? rowG : row05).join('\n')}
      </div>
    </div>
  </div>
${toggleScript(shape)}`

writeFileSync(join(here, 'shape-05-group.html'), page({
  file: 'shape-05-group.html',
  h1: 'Shape 05: detail as role="group" inside the rowgroup (what ships today)',
  intro: `<p>The shape specified by
    <code>.scratch/columnlist-table-roles/issues/05-expandable-detail-disclosure-mapping.md</code> and shipped in
    ColumnList. The detail is a <code>role="group"</code> sibling of the cell row inside the per-row
    <code>role="rowgroup"</code>, named by a hidden "Details" span plus the row's descriptive cell. axe reports
    this as <code>aria-required-children</code>: a <code>group</code> is not an allowed owned child of a
    <code>rowgroup</code>.</p>
    <p>Five of the fifteen rows are expandable and start expanded, so row-count announcements are immediately
    testable.</p>`,
  listen: `the announced row count with five details open (honest is 16: header plus 15 data);
    whether the detail is reachable by <code>Ctrl+Alt+arrows</code> at all; how the group announces on entry;
    and whether the link and button inside the panel are reachable.`,
  body: listBody('05')
}))

writeFileSync(join(here, 'shape-G-cell.html'), page({
  file: 'shape-G-cell.html',
  h1: 'Shape G: detail as a cell of its own row (the candidate)',
  intro: `<p>The shape proposed by
    <code>.scratch/columnlist-table-roles/issues/12-detail-as-a-cell-of-its-own-row.md</code>. The detail is the
    last <code>role="cell"</code> of the data row, mirrored by an <code>aria-label="Details"</code>
    columnheader. The cell is present in every row for cell parity; only its content is gated on expansion.
    axe reports no <code>aria-required-children</code> violation for this shape.</p>
    <p>Identical to <code>shape-05-group.html</code> in data, styling and every other role. Both files come from
    one generator, so any difference you hear is the detail shape.</p>`,
  listen: `the same four things as shape 05, plus two costs specific to this shape: the trailing
    "Details, blank" on the ten collapsed rows during cell navigation, and whether the long content-derived
    cell name is announced and then repeated while reading through.`,
  body: listBody('G'),
  extraStyles: shapeGStyles
}))

// ------------------------------------------- Q4: how utility columns are named
// Answers Q4 of the verification protocol: `aria-label` on a columnhead div is
// never spoken by NVDA, so Select / Expand / Columns / Details are all silent
// both in the header row and in the header-on-cell-entry announcement. The
// untested alternative is a visually hidden text node inside the header cell.
//
// Three tables in ONE document, identical but for the naming mechanism, so the
// A/B is one caret walk in one NVDA session and version drift cannot enter.
// Variant A reproduces the known failure and is the control: if A announces the
// names, the run is not measuring what it thinks it is.
//
// `.sr-only` is Tailwind's exact rule, which is the class ColumnList already
// uses (`ColumnList.svelte:591`), so variant B tests the mechanism we would
// actually ship rather than a fixture-only approximation. `.offscreen` is the
// `left:-9999px` technique the other fixtures use for their hidden labels, kept
// as a separate variant because NVDA appends "off screen" to some such nodes
// and that noise would land in every header announcement.

const q4Styles = `
    /* Q4 ONLY */
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0; }
    .offscreen { position: absolute; left: -9999px; }
    /* The exact rule from @txstate-mws/svelte-components ScreenReaderOnly, which
       is the hiding mechanism ColumnList actually has in hand. Not identical to
       Tailwind's sr-only: clip-path inset(50%) rather than clip rect(0,0,0,0),
       plus font-size and colour overrides. Tested separately so that adopting B
       cannot turn out to have measured a rule we do not ship. */
    .sro { border: 0 !important; clip: rect(1px, 1px, 1px, 1px) !important; -webkit-clip-path: inset(50%) !important; clip-path: inset(50%) !important; height: 1px !important; margin: -1px !important; overflow: hidden !important; padding: 0 !important; position: absolute !important; width: 1px !important; white-space: nowrap !important; font-size: 20px !important; background: white !important; color: black !important; }
    .column-list-colhead.detail, .column-list-col.detail { flex: 0 0 0; padding: 0; }`

const q4Columns = [
  { id: 'survey', label: 'Last Survey' },
  { id: 'style', label: 'Style' }
]
const q4Rows = rows.slice(0, 4)

// Each variant names the four text-less utility headers its own way. `attr` and
// `hidden` are the only things that vary; every other byte of the table is
// shared, which is what makes a difference in the transcript attributable.
const q4Variants = [
  {
    key: 'a',
    name: 'Variant A, aria-label',
    mechanism: 'aria-label="..." on the columnhead div',
    note: 'what 06 decision 2 specified and what ships in the spec today. Known to be silent on NVDA; present here as the control.',
    named: label => ({ attr: ` aria-label="${label}"`, hidden: '' })
  },
  {
    key: 'b',
    name: 'Variant B, hidden clip text',
    mechanism: 'a <span class="sr-only"> text node inside the columnhead div',
    note: 'Tailwind’s clip-rect technique, the same `sr-only` class ColumnList already uses. This is the candidate.',
    named: label => ({ attr: '', hidden: `<span class="sr-only">${label}</span>` })
  },
  {
    key: 'd',
    name: 'Variant D, ScreenReaderOnly text, checkbox named by aria-label',
    mechanism: 'the same hidden span as E, but the select-all checkbox is named by aria-label on the input instead of by a hidden text node inside its label',
    note: 'the one change that could remove the "Select select all" doubling, by leaving the header cell with no text content but its own name.',
    named: label => ({ attr: '', hidden: `<span class="sro">${label}</span>` }),
    checkboxLabel: 'aria-label'
  },
  {
    key: 'f',
    name: 'Variant F, populated overflow header, named',
    mechanism: 'hidden text in an overflow header that also holds the reveal-columns control',
    note: 'the shape the component actually has. Variants A to E gave the overflow header no content, but ColumnList puts the reveal-columns ActionSet in it, so its name is composed the same way the select-all header\u2019s is.',
    named: label => ({ attr: '', hidden: `<span class="sro">${label}</span>` }),
    overflowControl: true
  },
  {
    key: 'g',
    name: 'Variant G, populated overflow header, unnamed',
    mechanism: 'the same overflow header with no hidden name at all',
    note: 'what simply deleting the aria-label would leave. F against G is the overflow column\u2019s version of the select-all question: is the control\u2019s own name a good enough column name, or is a doubled name better than that?',
    named: label => ({ attr: '', hidden: `<span class="sro">${label}</span>` }),
    overflowControl: true,
    overflowUnnamed: true
  },
  {
    key: 'e',
    name: 'Variant E, ScreenReaderOnly text',
    mechanism: 'a <span class="sro"> text node, the exact rule from svelte-components ScreenReaderOnly',
    note: 'what ColumnList would actually use. Differs from B only in the hiding CSS, so B against E isolates the rule and E against D isolates the checkbox change.',
    named: label => ({ attr: '', hidden: `<span class="sro">${label}</span>` })
  },
  {
    key: 'c',
    name: 'Variant C, hidden off-screen text',
    mechanism: 'a <span class="offscreen"> text node (left:-9999px) inside the columnhead div',
    note: 'the technique the other fixtures use for hidden button labels. Separated from B because NVDA can append "off screen" to a node positioned this way.',
    named: label => ({ attr: '', hidden: `<span class="offscreen">${label}</span>` })
  }
]

const q4Head = v => {
  const select = v.named('Select')
  const expand = v.named('Expand')
  const overflow = v.named('Columns')
  const detail = v.named('Details')
  const cells = [
    // The select-all header is the one that made 06 reject hidden text: it holds
    // a checkbox whose own label could leak into a contents-derived name. Both
    // the hidden name and the checkbox are present here, so the leak either
    // happens or it does not.
    v.checkboxLabel === 'aria-label'
      ? `        <div class="column-list-colhead select-all" role="columnheader"${select.attr}>${select.hidden}<input type="checkbox" id="q4${v.key}-select-all" aria-label="select all"></div>`
      : `        <div class="column-list-colhead select-all" role="columnheader"${select.attr}>${select.hidden}<input type="checkbox" id="q4${v.key}-select-all"><label for="q4${v.key}-select-all"><span class="offscreen">select all</span></label></div>`,
    `        <div class="column-list-colhead expand" role="columnheader"${expand.attr}>${expand.hidden || '&nbsp;'}</div>`,
    ...q4Columns.map(c => `        <div id="q4${v.key}-${c.id}" class="column-list-colhead" role="columnheader">${c.label}</div>`),
    `        <div class="column-list-colhead actions" role="columnheader">Actions</div>`,
    // Mirrors ActionSet: a role="menu" wrapper whose trigger is a role="menuitem"
    // button named by hidden text (`ActionSet.svelte:200-210`). The point is that
    // the header cell has a control in it, so its contents-derived name is not
    // just the hidden label.
    v.overflowControl
      ? `        <div class="column-list-colhead overflow" role="columnheader">${v.overflowUnnamed ? '' : overflow.hidden}<div role="menu"><button type="button" role="menuitem" aria-expanded="false" aria-haspopup="menu"><span class="sro">Show Actions</span></button></div></div>`
      : `        <div class="column-list-colhead overflow" role="columnheader"${overflow.attr}>${overflow.hidden || '&nbsp;'}</div>`,
    `        <div class="column-list-colhead detail" role="columnheader"${detail.attr}>${detail.hidden}</div>`
  ]
  return `      <div class="column-list-head" role="row">\n${cells.join('\n')}\n      </div>`
}

const q4Row = (v, row) => {
  const cells = [
    `          <div class="column-list-col checkbox" role="cell"><input type="checkbox" id="q4${v.key}-select-${row.id}"></div>`,
    `          <div class="column-list-col expand" role="cell"><button type="button" aria-expanded="false" aria-controls="q4${v.key}-detail-${row.id}">&#9660;<span class="offscreen">Expand Row</span></button></div>`,
    ...q4Columns.map(c => `          <div id="q4${v.key}-${c.id}-${row.id}" class="column-list-col regular" role="cell">${row[c.id]}</div>`),
    `          <div class="column-list-col actions" role="cell"><button type="button">Edit</button></div>`,
    `          <div class="column-list-col overflow" role="cell">&nbsp;</div>`,
    `          <div class="column-list-col detail" role="cell" id="q4${v.key}-detail-${row.id}"></div>`
  ]
  return `        <div class="column-list-row" role="rowgroup">
        <div class="column-list-cols" role="row">
${cells.join('\n')}
        </div>
        </div>`
}

const q4Table = v => `  <h2 id="q4${v.key}-title">${v.name}</h2>
  <p>Utility columns named by <code>${v.mechanism}</code> — ${v.note}</p>
  <div class="column-list">
    <div class="column-list-table-wrapper" role="table" aria-labelledby="q4${v.key}-title">
${q4Head(v)}
      <div class="column-list-rows" role="presentation">
${q4Rows.map(row => q4Row(v, row)).join('\n')}
      </div>
    </div>
  </div>`

writeFileSync(join(here, 'q4-utility-naming.html'), page({
  file: 'q4-utility-naming.html',
  h1: 'Q4: does visually hidden text name a utility column where aria-label does not?',
  intro: `<p>Answers Q4 of
    <code>.scratch/columnlist-table-roles/assets/09-verification-protocol.md</code> §8. The M1 pass found that
    <code>aria-label</code> on a columnhead div is never spoken by NVDA, in the header row or in the
    header-on-cell-entry announcement, leaving <code>Select</code>, <code>Expand</code>, <code>Columns</code>
    and shape G’s mirrored <code>Details</code> silent.</p>
    <p>Three tables, seven columns each, identical in every byte except how the four text-less utility headers
    are named. <strong>Variant A is the control:</strong> it reproduces the known failure, so if A announces
    the names then something about this run differs from M1 and no conclusion can be drawn from B or C.
    <code>Last Survey</code>, <code>Style</code> and <code>Actions</code> are named by rendered text in all
    three and should announce everywhere.</p>`,
  listen: `in each table, two channels for the same four columns. <strong>Header row:</strong> walk it with
    <code>Ctrl+Alt+Right</code> and hear whether column 2 says "Expand" or a bare "column 2".
    <strong>Cell entry:</strong> walk a data row and hear whether the header prefixes the cell.
    Then three specifics: whether the select-all header leaks the checkbox’s own "select all" label into a
    doubled name (the concern that made 06 choose <code>aria-label</code> in the first place), whether variant C
    appends "off screen" to every utility header it names, and whether the zero-width
    <code>Details</code> column behaves like the others.`,
  body: q4Variants.map(q4Table).join('\n\n'),
  extraStyles: q4Styles
}))

console.log('wrote control.html, shape-05-group.html, shape-G-cell.html, q4-utility-naming.html')

// ------------------------------------------------- 29: detail placement A/B
// Five variants, one per file, differing only in where the expandable detail
// lives. Everything else — data, styling, every other role, the naming
// mechanism for text-less columnheads — is shared, so any audible difference
// between two transcripts is the placement and nothing else.
//
// Two corrections from ticket 29 are carried in, and neither is in the
// 2026-09-10 fixtures above:
//
//  1. Text-less columnheads are named by a visually hidden text node using the
//     `ScreenReaderOnly` rule, not by `aria-label`. Ticket 17 measured that NVDA
//     computes a correct name from `aria-label` on a columnhead div and then
//     never speaks it. The select-all head is the one exception and it matches
//     the component: it carries no name of its own, because the checkbox inside
//     it is already named "select all" and a header cell's name is composed from
//     its contents ("Select select all").
//  2. V2 has no per-row `rowgroup`. Once the detail is a cell, the wrapper's
//     only remaining job is a border, which is CSS. V4 and V5 drop it too, for
//     the same reason: their detail is a `row`, and a roleless wrapper is
//     transparent to the accessibility tree (ARIA 5.2.6, Example 6).
//
// Unlike the 2026-09-10 fixtures, every row starts COLLAPSED. The question is a
// delta between two `T` framings — collapsed, then with five details open — so
// the collapsed state has to be the starting state. An "Expand all details"
// button sits before the table because it is the one way to open five details
// from a scenario that can only send keys, and it is variant-independent: the
// caret buttons stay wired and behave the same way.

const detailStyles = `
    /* 29 ONLY */
    .sro { border: 0 !important; clip: rect(1px, 1px, 1px, 1px) !important; -webkit-clip-path: inset(50%) !important; clip-path: inset(50%) !important; height: 1px !important; margin: -1px !important; overflow: hidden !important; padding: 0 !important; position: absolute !important; width: 1px !important; white-space: nowrap !important; font-size: 20px !important; background: white !important; color: black !important; }
    /* A collapsed detail leaves an empty wrapper in V1; padding would give it height. */
    .column-list-expandable:empty { padding: 0; }
    .expand-all { margin: 1rem 0; font-size: 1rem; padding: .4rem .8rem; }`

// V2 and V3 wrap the cell row so a full-width detail can sit on its own line
// inside it. V4 and V5 do not: their detail is a sibling row.
const v2Styles = `
    /* V2 ONLY */
    .column-list-cols { flex-wrap: wrap; }
    .column-list-col.detail { flex: 0 0 100%; padding: 0; }
    .column-list-colhead.detail { flex: 0 0 0; padding: 0; overflow: hidden; }`

// V2b lays out exactly as V1 does: the detail is a block sibling below the flex
// container, so there is no wrap and nothing new paints behind the panel.
const v2bStyles = `
    /* V2b ONLY */
    .column-list-col.detail { padding: 0; }
    .column-list-colhead.detail { flex: 0 0 0; padding: 0; overflow: hidden; }`

// V3's panel is inside the Region Code cell, so it is bounded by that cell's
// box. That is a property of shape F rather than of this fixture: a panel
// nested in a data cell cannot paint the full width of the row without leaving
// flow. The pre-flight records the geometry rather than pretending otherwise.
const v3Styles = `
    /* V3 ONLY */
    .column-list-cols { flex-wrap: wrap; }
    .column-list-col.region { min-width: 0; }`

const rowStyles = `
    /* V4 AND V5 ONLY */
    .column-list-detail-row > [role="cell"] { display: block; }
    /* Carbon's hiding: the row stays rendered, and stays in the accessibility
       tree, which is the whole point of V4. */
    .column-list-detail-row.collapsed { height: 0; overflow: hidden; }`

const dDescribedBy = row => `${LIST}-description-${row.id}`

const dHead = (withDetail, namelessSelectAll = false) => {
  const cells = [
    // No name of its own, matching ColumnList: the checkbox inside is already
    // named, and a header cell's name is composed from its contents.
    //
    // `namelessSelectAll` moves the checkbox's name onto the input as an
    // `aria-label`, which leaves this header cell with *zero* text descendants.
    // Ticket 17's variant D did the same but kept a hidden "Select" beside it,
    // and NVDA still composed the control's name into the column name. This is
    // the one case 17 did not run: nothing at all for NVDA to compose from
    // except the checkbox's own `aria-label`.
    namelessSelectAll
      ? `        <div class="column-list-colhead select-all" role="columnheader"><input type="checkbox" id="${LIST}-select-all" aria-label="select all"></div>`
      : `        <div class="column-list-colhead select-all" role="columnheader"><input type="checkbox" id="${LIST}-select-all"><label for="${LIST}-select-all"><span class="sro">select all</span></label></div>`,
    `        <div class="column-list-colhead expand" role="columnheader"><span class="sro">Expand</span></div>`,
    ...columns.map(c => `        <div id="${LIST}-${c.id}" class="column-list-colhead" role="columnheader">${c.label}</div>`),
    `        <div class="column-list-colhead actions" role="columnheader">Actions</div>`,
    `        <div class="column-list-colhead overflow" role="columnheader"><span class="sro">Columns</span></div>`
  ]
  if (withDetail) cells.push(`        <div class="column-list-colhead detail" role="columnheader"><span class="sro">Details</span></div>`)
  return `      <div class="column-list-head" role="row">\n${cells.join('\n')}\n      </div>`
}

// The panel itself, identical in every variant so the painted result is too.
const dPanel = row => `<div class="column-list-expandable">${detailBody(row)}
          </div>`

const dCells = (row, extra = '') => [
  `          <div class="column-list-col checkbox" role="cell"><input type="checkbox" id="${LIST}-select-${row.id}" aria-describedby="${dDescribedBy(row)}"><label for="${LIST}-select-${row.id}"><span class="sro">select row</span></label></div>`,
  `          <div class="column-list-col expand" role="cell">${row.expandable
    ? `<button type="button" aria-expanded="false" aria-controls="${LIST}-detail-${row.id}" aria-describedby="${dDescribedBy(row)}" data-row="${row.id}">&#9660;<span class="sro">Expand Row</span></button>`
    : '&nbsp;'}</div>`,
  ...columns.map(c => `          <div id="${LIST}-${c.id}-${row.id}" class="column-list-col regular ${c.id}" role="cell">${row[c.id]}${c.id === 'region' ? extra : ''}</div>`),
  `          <div class="column-list-col actions" role="cell"><button type="button" aria-describedby="${dDescribedBy(row)}">Edit</button><button type="button" aria-describedby="${dDescribedBy(row)}">Delete</button></div>`,
  `          <div class="column-list-col overflow" role="cell">&nbsp;</div>`
]

/**
 * A row, per variant. `tpl` is the markup JS inserts on expand; it lives in an
 * inert <template> inside the row so that expanding is a DOM insertion rather
 * than a string built in the page, and so that nothing of the collapsed state
 * is in the accessibility tree unless the variant means it to be.
 */
const dRow = (key, row) => {
  const cells = dCells(row)
  const template = inner => row.expandable
    ? `\n        <template class="detail-template">${inner}</template>`
    : ''

  if (key === 'v1') {
    // Today's shipped shape. The wrapper renders whenever the row has a caret,
    // so the caret's aria-controls always resolves; only the role, the name and
    // the content wait for expansion.
    return `        <div class="column-list-row" role="rowgroup">
        <div class="column-list-cols" role="row">
${cells.join('\n')}
        </div>${row.expandable ? `
        <div class="column-list-expandable" id="${LIST}-detail-${row.id}"></div>` : ''}${template(`<span id="${LIST}-detail-label-${row.id}" hidden>Details</span>${detailBody(row)}`)}
        </div>`
  }

  if (key === 'v2') {
    // No per-row rowgroup: table > generic > row, which 5.2.6 blesses.
    return `        <div class="column-list-row">
        <div class="column-list-cols" role="row">
${cells.join('\n')}
          <div class="column-list-col detail" role="cell" id="${LIST}-detail-${row.id}"></div>
        </div>${template(dPanel(row))}
        </div>`
  }

  if (key === 'v2b') {
    // V2's semantics on V1's DOM. The outer wrapper is the row, the flex
    // container that lays the cells out is presentational, and the detail is a
    // cell below it: row > presentation > cell, the same arrangement
    // .column-list-rows already uses between the table and its rows.
    return `        <div class="column-list-row" role="row">
        <div class="column-list-cols" role="presentation">
${cells.join('\n')}
        </div>
        <div class="column-list-col detail" role="cell" id="${LIST}-detail-${row.id}"></div>${template(dPanel(row))}
        </div>`
  }

  if (key === 'v3') {
    // Nested in the last real data cell. No extra column, no mirrored header,
    // and the detail inherits Region Code's header association.
    return `        <div class="column-list-row">
        <div class="column-list-cols" role="row">
${dCells(row, row.expandable ? `<span id="${LIST}-detail-${row.id}"></span>` : '').join('\n')}
        </div>${template(dPanel(row))}
        </div>`
  }

  // V4 and V5 share a shape and differ only in whether the collapsed detail row
  // is in the DOM at all.
  const detailRow = `        <div class="column-list-detail-row collapsed" role="row" id="${LIST}-detail-${row.id}">
          <div role="cell" aria-colspan="${columns.length + 4}"><span class="sro">Details, ${row.description}</span>${dPanel(row)}</div>
        </div>`

  if (key === 'v4') {
    return `        <div class="column-list-row">
        <div class="column-list-cols" role="row">
${cells.join('\n')}
        </div>${row.expandable ? `\n${detailRow}` : ''}
        </div>`
  }

  // v5: rendered only while expanded.
  return `        <div class="column-list-row">
        <div class="column-list-cols" role="row">
${cells.join('\n')}
        </div>${template(`\n${detailRow.replace(' collapsed', '')}\n        `)}
        </div>`
}

const dScript = key => `  <script>
    // One toggle for every variant; only the DOM edit differs, and it is the
    // thing under test. Each expandable row carries a <template> with its
    // expanded markup (V4 excepted: its detail row is always rendered).
    function setExpanded (btn, open) {
      const wrapper = btn.closest('.column-list-row')
      const tpl = wrapper.querySelector('template.detail-template')
      ${key === 'v1'
        ? `const box = wrapper.querySelector('.column-list-expandable')
      if (open) {
        box.setAttribute('role', 'group')
        box.setAttribute('aria-labelledby', box.id + '-label ' + btn.getAttribute('aria-describedby'))
        box.appendChild(tpl.content.cloneNode(true))
        box.querySelector('span[hidden]').id = box.id + '-label'
      } else {
        box.removeAttribute('role'); box.removeAttribute('aria-labelledby'); box.textContent = ''
      }`
        : (key === 'v2' || key === 'v2b')
          ? `const cell = wrapper.querySelector('.column-list-col.detail')
      if (open) cell.appendChild(tpl.content.cloneNode(true))
      else cell.textContent = ''`
          : key === 'v3'
            ? `const cell = wrapper.querySelector('.column-list-col.region')
      if (open) cell.appendChild(tpl.content.cloneNode(true))
      else cell.querySelector('.column-list-expandable')?.remove()`
            : key === 'v4'
              ? `wrapper.querySelector('.column-list-detail-row').classList.toggle('collapsed', !open)`
              : `if (open) wrapper.querySelector('.column-list-cols').after(tpl.content.cloneNode(true))
      else wrapper.querySelector('.column-list-detail-row')?.remove()`}
      btn.setAttribute('aria-expanded', String(open))
      btn.innerHTML = (open ? '&#9650;' : '&#9660;') + '<span class="sro">' + (open ? 'Collapse' : 'Expand') + ' Row</span>'
    }
    document.addEventListener('click', e => {
      const btn = e.target.closest('button[data-row]')
      if (btn) return setExpanded(btn, btn.getAttribute('aria-expanded') !== 'true')
      if (!e.target.closest('#expand-all')) return
      const carets = [...document.querySelectorAll('button[data-row]')]
      const open = carets.some(b => b.getAttribute('aria-expanded') !== 'true')
      carets.forEach(b => setExpanded(b, open))
      document.getElementById('expand-all').textContent = open ? 'Collapse all details' : 'Expand all details'
    })
  </script>`

const dBody = (key, withDetail, namelessSelectAll) => `  <p><button type="button" id="expand-all" class="expand-all">Expand all details</button></p>
  <div class="column-list">
    <div hidden aria-hidden="true" id="${LIST}-list-title">${TITLE}</div>
    <div class="column-list-table-wrapper" role="table" aria-labelledby="${LIST}-list-title">
${dHead(withDetail, namelessSelectAll)}
      <div class="column-list-rows" role="presentation">
${rows.map(row => dRow(key, row)).join('\n')}
      </div>
    </div>
  </div>
${dScript(key)}`

const detailVariants = [
  {
    key: 'v1',
    file: 'detail-v1-group-in-rowgroup.html',
    h1: 'V1: detail as role="group" inside the per-row rowgroup (what ships today)',
    shape: `The detail is a <code>role="group"</code> sibling of the cell row inside the per-row
      <code>role="rowgroup"</code>, named by a hidden "Details" span plus the row's descriptive cell.
      axe reports <code>aria-required-children</code>: a <code>group</code> is not an allowed owned
      child of a <code>rowgroup</code>.`,
    why: `<strong>The control.</strong> This run's first and last targets are both this file. If the two
      transcripts differ, something drifted across the session and the five variants are not comparable.`,
    listen: `the row count at both framings (expect no change), whether the detail is reachable by
      <code>Ctrl+Alt+arrows</code> at all, and whether the group's name "Details" is ever spoken
      (ledger check D).`
  },
  {
    key: 'v2',
    file: 'detail-v2-cell-own-column.html',
    h1: 'V2: detail as a cell of its own column (shape G, corrected)',
    shape: `The detail is its own <code>role="cell"</code>, last in the row, mirrored by a
      <code>Details</code> <code>columnheader</code> named by hidden text. <strong>No per-row
      rowgroup:</strong> the wrapper keeps its CSS and carries no role.`,
    why: `The leading candidate. Two corrections since the 2026-09-10 A/B: the mirrored header is named
      by hidden text rather than <code>aria-label</code>, and the rowgroup is gone.`,
    listen: `whether the mirrored <code>Details</code> header is announced on arriving at the cell (it
      was not when named by <code>aria-label</code>), whether the panel is re-read on every arrival,
      and whether dropping the rowgroup changed anything at all.`,
    extraStyles: v2Styles,
    detailColumn: true
  },
  {
    key: 'v3',
    file: 'detail-v3-cell-nested.html',
    h1: 'V3: detail nested inside the last data cell (shape F)',
    shape: `The detail is nested inside the <code>Region Code</code> cell. No extra column, no mirrored
      header, no per-row rowgroup.`,
    why: `Ticket 12 rejected this on reasoning — "header association claims the detail belongs to Region
      Code" — that has never been heard. If NVDA does not say the data column's name on arrival, the
      objection is theoretical and F costs no column.`,
    listen: `whether arriving at the detail announces <code>Region Code</code>, and how the re-read cost
      compares with V2's.`,
    extraStyles: v3Styles
  },
  {
    key: 'v4',
    file: 'detail-v4-row-rendered-collapsed.html',
    h1: 'V4: detail as its own row, rendered while collapsed (Carbon’s mechanism)',
    shape: `The detail is its own <code>role="row"</code> holding one <code>role="cell"</code> with
      <code>aria-colspan</code>. The collapsed row is <strong>always rendered</strong> and hidden by
      zero height plus <code>overflow: hidden</code>, so it stays in the accessibility tree.`,
    why: `<strong>The count probe.</strong> V4 against V5 isolates the hiding mechanism. Ticket 04
      rejected the whole row-based family on a recollection that a collapsed detail row inflates the
      announced count; that is true of this hiding and not of hiding as such. Expected to fail count
      honesty, and it is here to show why.`,
    listen: `the first framing, before anything is expanded. Five expandable rows are rendered
      collapsed, so an honest 16 becomes 21 with nothing open.`,
    extraStyles: rowStyles
  },
  {
    key: 'v5',
    file: 'detail-v5-row-own-row.html',
    h1: 'V5: detail as its own row, rendered only while expanded',
    shape: `The same shape as V4, but the detail row is in the DOM only while expanded. One
      <code>role="cell"</code> with <code>aria-colspan</code>, named by hidden text
      ("Details, " plus the row's description). No mirrored header, no extra column.`,
    why: `<strong>A candidate, not a probe.</strong> It meets count honesty as restated — the announced
      count equals the data-row count when nothing is expanded — and its subordination rests entirely
      on the cell's accessible name, because the spec forbids <code>aria-level</code> outside a
      treegrid. If the name is not spoken, V5 has no subordination at all.`,
    listen: `whether arriving at the detail row says "Details, ..." or just a bare coordinate; what
      <code>aria-colspan</code> does to the framing and the column position; and whether walking down
      a column passes through the detail row.`,
    extraStyles: rowStyles
  }
]

// V5a exists because V5's one audible wart is a borrowed header. Jumping to the
// panel's heading announces `row 3, select all, column 1, Additional Details`:
// the detail row's colspanned cell sits in column 1 and inherits the select-all
// column's name, which is ticket 12's objection to shape F relocated. The
// hypothesis under test is that the borrow is repairable by leaving the
// select-all header with nothing to compose a name from. 17 predicts it is not.
detailVariants.push({
  key: 'v5',
  file: 'detail-v5a-nameless-select-all.html',
  h1: 'V5a: V5 with a select-all header that has no text descendants at all',
  shape: `Identical to V5 in every byte except one: the select-all checkbox is named by
    <code>aria-label</code> on the input rather than by hidden text inside a
    <code>&lt;label&gt;</code>, so its <code>columnheader</code> contains no text node.`,
  why: `V5's detail row holds one colspanned cell, which NVDA places in column 1 and names with
    column 1's header. If that header can be made genuinely nameless, the borrow goes away.
    <strong>Ticket 17 predicts it cannot:</strong> its variant D left the header with no text
    content besides a hidden name and NVDA still composed the checkbox's own name into the
    column name. D kept that hidden name, so this exact case — nothing to compose from but the
    control — has never been run.`,
  listen: `the jump-to-heading announcement. V5 says <code>row 3, select all, column 1,
    Additional Details</code>. The question is whether this says <code>row 3, column 1, ...</code>
    instead, and whether the cell's own hidden name surfaces in that channel once the header's
    does not.`,
  extraStyles: rowStyles,
  namelessSelectAll: true
})

// V2b exists because building V2 on the live component ran into paint: moving
// the detail inside the flex row puts the row's background behind the panel,
// which today sits on whatever is behind the list. V2b gets V2's accessibility
// tree by moving roles instead of elements, so it costs no CSS at all. What it
// has not had is a hearing: V2 was measured as row > cell, this is
// row > presentation > cell.
detailVariants.push({
  key: 'v2b',
  file: 'detail-v2b-cell-presentational-cols.html',
  h1: 'V2b: V2, with the row on the outer wrapper and a presentational cell container',
  shape: `The outer per-row wrapper is the <code>role="row"</code>. The flex container holding the
    data cells is <code>role="presentation"</code>. The detail is a <code>role="cell"</code> sibling
    below that container, mirrored by a <code>Details</code> <code>columnheader</code> named by hidden
    text. No per-row rowgroup.`,
  why: `This is the shape built into <code>ColumnList.svelte</code>. Its accessibility tree should be
    V2's, and the run is here to find out whether NVDA agrees.`,
  listen: `anything that differs from V2's transcript. There should be nothing.`,
  extraStyles: v2bStyles,
  detailColumn: true
})

for (const v of detailVariants) {
  writeFileSync(join(here, v.file), page({
    file: v.file,
    h1: v.h1,
    intro: `<p><strong>Shape:</strong> ${v.shape}</p>
    <p><strong>Why it is in the run:</strong> ${v.why}</p>
    <p>Five variants, one per file, from one generator. Same data, same styling, same every other role,
    same naming mechanism for text-less columnheads. Every row starts collapsed; the button above the
    table opens all five expandable rows at once, which is how the scenario gets from the first
    <code>T</code> framing to the second.</p>`,
    listen: v.listen,
    body: dBody(v.key, Boolean(v.detailColumn), Boolean(v.namelessSelectAll)),
    extraStyles: detailStyles + (v.extraStyles ?? '')
  }))
}

console.log(`wrote ${detailVariants.map(v => v.file).join(', ')}`)
