// A recording spec: every step's speech beside the DOM state after it, written
// to one file per test. Copy into the consumer's receipts directory and edit the
// marked lines.
/// <reference lib="dom" />
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'
import { withReader, type ReaderSession } from '@sr-receipts/playwright'

const test = withReader(base)

const FIXTURE = readFileSync('/absolute/path/to/fixture.html', 'utf8') // edit
const RUNS = '/absolute/path/to/records' // edit: beside the question's write-up

// What to read from the page after each step. Edit for the question.
const domState = () => {
  const input = document.querySelector<HTMLInputElement>('[role=combobox]')!
  return { active: input.getAttribute('aria-activedescendant') ?? '(absent)', value: input.value }
}

type Step = { did: string, spoken: string } & ReturnType<typeof domState>

class Recording {
  steps: Step[] = []
  private readonly page: Page
  private readonly reader: ReaderSession
  constructor (page: Page, reader: ReaderSession) {
    this.page = page
    this.reader = reader
  }

  private async note (did: string, spoken: string) {
    this.steps.push({ did, spoken, ...(await this.page.evaluate(domState)) })
  }

  async press (key: string) { await this.note(`press ${key}`, await this.reader.press(key)) }
  async type (text: string, delay: number) { await this.note(`type "${text}", ${delay} ms between keys`, await this.reader.type(text, { delay })) }
  async perform (command: string) { await this.note(command, await this.reader.perform(command)) }
  async pageAction (did: string, action: () => Promise<unknown>) {
    await this.note(did, (await this.reader.capture(action)).spoken)
  }

  async write (name: string, path: string) {
    const cell = (text: string, empty = '(empty)') => text.replaceAll('|', '\\|') || empty
    const pageLog = await this.page.evaluate(() => (window as any).__log as string[] | undefined)
    // RUN_TAG keeps repeated runs of one test apart.
    name += process.env.RUN_TAG ?? ''
    mkdirSync(RUNS, { recursive: true })
    writeFileSync(`${RUNS}/${name}.md`, [
      `# ${name}`,
      '',
      `Page: \`${path}\``,
      `Run: ${new Date().toISOString()}`,
      `Environment: ${(await this.reader.environment()).join('; ')}`,
      '',
      '| Step | Reader said | Active descendant after | Value after |', // edit with domState
      '| --- | --- | --- | --- |',
      ...this.steps.map(s => `| ${s.did} | ${cell(s.spoken, '(silence)')} | ${cell(s.active)} | ${cell(s.value)} |`),
      '',
      '## Page log (ms since load)',
      '',
      '```',
      ...(pageLog ?? ['(no page log on this page)']),
      '```',
      '',
      '## Reader transcript',
      '',
      '```',
      ...this.reader.transcript,
      '```',
      ''
    ].join('\n'))
  }
}

async function open (page: Page, reader: ReaderSession, path: string) {
  await page.route('**/__fixture/page.html*', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }))
  // A missing route would pass the entry guard and then wait out the whole timeout.
  expect((await page.goto(path, { waitUntil: 'load' }))?.ok()).toBe(true)
  await reader.enter(page)
  const record = new Recording(page, reader)
  await record.pageAction('page focuses the input', () => page.getByRole('combobox').first().focus())
  await record.press('Enter') // NVDA: focus mode
  return record
}

const variants: Array<[name: string, query: string]> = [
  ['control', 'variant=control'], // edit: a variant whose answer is already known
  ['candidate', 'variant=candidate']
]

for (const [name, query] of variants) {
  const path = `/__fixture/page.html?${query}`
  test(`question: ${name}, typing ban`, async ({ page, reader }) => {
    const record = await open(page, reader, path)
    for (const key of ['b', 'a', 'n']) await record.press(key)
    await record.perform('reportCurrentFocus')
    await record.write(`${name}--typing`, path)
  })
}
