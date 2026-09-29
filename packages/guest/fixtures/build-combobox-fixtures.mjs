// Generates the combobox echo fixtures. Run: node build-combobox-fixtures.mjs
// One generator so the two are byte-identical apart from whether typing points
// aria-activedescendant at the first match: any difference in what NVDA says
// while typing is that attribute, not incidental markup.
//
// The question, from carbon-svelte#382: Carbon's ComboBox with
// autoHighlight="first-match" sets aria-activedescendant on every keystroke,
// and NVDA stops echoing typed characters after the first. The APG's editable
// comboboxes never set it while typing, and NVDA echoes every character. Is
// the attribute alone enough to silence the echo?
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// Carbon's demo items, so "b" matches exactly one option, as on /demo/382.
const items = ['Apple', 'Orange', 'Banana']

const variants = [
  {
    file: 'combobox-activedescendant.html',
    title: 'Combobox: typing points aria-activedescendant at the first match',
    activeWhileTyping: true
  },
  {
    file: 'combobox-no-activedescendant.html',
    title: 'Combobox: typing highlights the first match visually only',
    activeWhileTyping: false
  }
]

const page = ({ title, activeWhileTyping }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    body { margin: 0; padding: 1.5rem clamp(1rem, 4vw, 3rem); color: #161616; background: #f4f4f4; line-height: 1.5; }
    h1 { font-size: 1.4rem; }
    .intro { background: #fff; border: 1px solid #e0e0e0; border-left: 4px solid #0f62fe; padding: .75rem 1rem; margin: 1rem 0; border-radius: 2px; }
    code { background: #e8e8e8; padding: .1em .35em; border-radius: 3px; font-size: .9em; }
    .combobox { max-width: 20rem; position: relative; }
    .combobox label { display: block; font-size: .875rem; margin-bottom: .25rem; }
    .combobox input { width: 100%; box-sizing: border-box; padding: .5rem; font: inherit; border: 0; border-bottom: 1px solid #8d8d8d; background: #fff; }
    .combobox ul { list-style: none; margin: 0; padding: 0; background: #fff; border: 1px solid #c6c6c6; }
    .combobox ul[hidden] { display: none; }
    .combobox li { padding: .5rem; cursor: pointer; }
    .combobox li.highlighted { background: #e8e8e8; outline: 2px solid #0f62fe; outline-offset: -2px; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p class="intro">Type into the combo box. Typing filters the list by substring and
      highlights the first match. ${activeWhileTyping
        ? 'The input&#39;s <code>aria-activedescendant</code> points at the highlighted option.'
        : 'The input&#39;s <code>aria-activedescendant</code> stays empty until an arrow key moves into the list.'}
      Arrow keys and <code>Enter</code> behave the same in both variants.</p>

    <div class="combobox">
      <label id="fruit-label" for="fruit">Fruit</label>
      <input id="fruit" type="text" role="combobox" autocomplete="off"
        aria-autocomplete="list" aria-expanded="false" aria-controls="fruit-listbox" aria-activedescendant="">
      <ul id="fruit-listbox" role="listbox" aria-labelledby="fruit-label" hidden>
${items.map(item => `        <li id="fruit-${item.toLowerCase()}" role="option" aria-selected="false">${item}</li>`).join('\n')}
      </ul>
    </div>
  </main>

  <script>
    const ACTIVE_WHILE_TYPING = ${activeWhileTyping}
    const input = document.getElementById('fruit')
    const listbox = document.getElementById('fruit-listbox')
    const options = Array.from(listbox.querySelectorAll('[role=option]'))
    let highlighted = null

    const visible = () => options.filter(o => !o.hidden)

    function open (isOpen) {
      listbox.hidden = !isOpen
      input.setAttribute('aria-expanded', String(isOpen))
      if (!isOpen) highlight(null, false)
    }

    // \`announce\` is the whole question: whether a highlight is also exposed
    // through aria-activedescendant, or shown only by the class.
    function highlight (option, announce) {
      if (highlighted) highlighted.classList.remove('highlighted')
      highlighted = option
      if (option) option.classList.add('highlighted')
      input.setAttribute('aria-activedescendant', option && announce ? option.id : '')
    }

    input.addEventListener('input', () => {
      const typed = input.value.toLowerCase()
      for (const o of options) o.hidden = !o.textContent.toLowerCase().includes(typed)
      const matches = visible()
      open(matches.length > 0)
      highlight(typed && matches.length ? matches[0] : null, ACTIVE_WHILE_TYPING)
    })

    input.addEventListener('keydown', event => {
      const matches = visible()
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (listbox.hidden) open(true)
        const step = event.key === 'ArrowDown' ? 1 : -1
        const at = matches.indexOf(highlighted)
        highlight(matches[(at + step + matches.length) % matches.length], true)
      } else if (event.key === 'Enter' && highlighted && !listbox.hidden) {
        event.preventDefault()
        input.value = highlighted.textContent
        open(false)
      } else if (event.key === 'Escape') {
        open(false)
      }
    })

    for (const o of options) {
      o.addEventListener('click', () => { input.value = o.textContent; open(false); input.focus() })
    }
  </script>
</body>
</html>
`

for (const variant of variants) {
  writeFileSync(join(here, variant.file), page(variant))
  console.log('wrote', variant.file)
}
