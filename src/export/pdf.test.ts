import { describe, expect, it } from 'vitest'
import {
  A4_LANDSCAPE,
  A4_PORTRAIT,
  addImagePage,
  addTextPage,
  buildPdfBytes,
  createPdf,
  prepareText,
  type PdfBlock,
} from './pdf'

/**
 * The hand-rolled PDF writer — 975 lines, and until now the largest module in
 * the codebase with no test at all.
 *
 * ADR 0002 deferred this on the grounds that *"asserting on bytes needs a PDF
 * parser, which is its own dependency decision"*. That premise is wrong for the
 * invariant that matters most. The cross-reference table's entire job is to say
 * "object N begins at byte X"; checking it means reading the offset and seeking
 * there. No parser, no dependency — just byte arithmetic against the file the
 * writer just produced.
 *
 * The module's own header names the stakes: *"Offsets are measured off the byte
 * chunks as they are appended, never predicted from string lengths — one wrong
 * offset gives a file that some viewers open and others reject outright, which
 * is the worst kind of bug to find later."* Nothing checked that until now.
 *
 * `buildPdfBytes` was flagged as a dead export by the audit. It is the seam
 * this suite needs, so it is dead no longer.
 */

/** The bytes as latin1 text. Every byte the writer emits is a latin1 code unit. */
const asText = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join('')

/** A minimal document with one text page. */
function onePageDoc(blocks: PdfBlock[] = [{ kind: 'text', text: 'Hello' }]) {
  const doc = createPdf('Test Document')
  addTextPage(doc, { title: 'Sheet', blocks })
  return buildPdfBytes(doc)
}

/**
 * A JPEG carrying nothing but a frame header — all `readJpeg` parses.
 *
 * SOI, then SOF0 with a 17-byte payload: precision, height, width, component
 * count, and three 3-byte component specs. Then EOI.
 */
function fakeJpeg(width: number, height: number, components = 3): Uint8Array {
  const body = [
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    components,
    ...Array.from({ length: components * 3 }, () => 0x00),
  ]
  const length = body.length + 2
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, (length >> 8) & 0xff, length & 0xff,
    ...body,
    0xff, 0xd9,
  ])
}

/** Reads the xref table back out of a finished file. */
function readXref(bytes: Uint8Array) {
  const text = asText(bytes)

  const startxref = text.lastIndexOf('startxref')
  expect(startxref, 'no startxref').toBeGreaterThan(-1)
  const offset = Number(text.slice(startxref + 'startxref'.length).trim().split(/\s/)[0])

  expect(text.startsWith('xref', offset), 'startxref does not point at the table').toBe(true)

  // `xref\n0 <size>\n` then `size` entries of exactly 20 bytes each.
  const header = /^xref\n0 (\d+)\n/.exec(text.slice(offset))!
  expect(header, 'malformed xref header').not.toBeNull()
  const size = Number(header[1])
  const first = offset + header[0].length

  const entries: { offset: number; type: string }[] = []
  for (let i = 0; i < size; i++) {
    const raw = text.slice(first + i * 20, first + (i + 1) * 20)
    expect(raw, `entry ${i} is not 20 bytes`).toHaveLength(20)
    entries.push({ offset: Number(raw.slice(0, 10)), type: raw[17] })
  }
  return { size, entries, text }
}

describe('★ the cross-reference table', () => {
  /**
   * Documents that exercise every branch of the serialiser: text only, an
   * image page (which reserves an extra XObject per page), several pages, no
   * title (which skips the /Info object), and enough content to force
   * pagination.
   */
  const DOCUMENTS: [name: string, build: () => Uint8Array][] = [
    ['one text page', () => onePageDoc()],
    [
      'no title — skips the /Info object',
      () => {
        const doc = createPdf()
        addTextPage(doc, { blocks: [{ kind: 'text', text: 'x' }] })
        return buildPdfBytes(doc)
      },
    ],
    [
      'an image page — reserves an extra XObject',
      () => {
        const doc = createPdf('With image')
        addImagePage(doc, fakeJpeg(800, 600), { size: A4_LANDSCAPE })
        return buildPdfBytes(doc)
      },
    ],
    [
      'mixed image and text pages',
      () => {
        const doc = createPdf('Drawing set')
        addImagePage(doc, fakeJpeg(1200, 900))
        addImagePage(doc, fakeJpeg(640, 480, 1))
        addTextPage(doc, { title: 'Area Statement', blocks: [{ kind: 'text', text: 'x' }] })
        return buildPdfBytes(doc)
      },
    ],
    [
      'content long enough to paginate',
      () =>
        onePageDoc(
          Array.from({ length: 200 }, (_, i) => ({
            kind: 'text' as const,
            text: `Paragraph ${i} — ${'lorem ipsum '.repeat(8)}`,
          })),
        ),
    ],
    ['an empty document', () => buildPdfBytes(createPdf('Empty'))],
  ]

  for (const [name, build] of DOCUMENTS) {
    describe(name, () => {
      const bytes = build()
      const { size, entries, text } = readXref(bytes)

      it('★ every offset lands exactly on the object it claims', () => {
        // THE test. Entry 0 is the free head; entries 1..n-1 are objects
        // 1..n-1 and each must begin with "<n> 0 obj" at its stated byte.
        //
        // Demonstrated red (SD5): replacing the measured `length` with an
        // offset predicted from string lengths — the exact mistake the
        // module's header warns against — failed all six documents plus the
        // stream and escaping cases, reporting
        //   `xref says object 1 is at byte 14, but that byte begins
        //    "\n1 0 obj\n<< /Type /Catal"`
        // i.e. adrift by the newline the prediction did not account for.
        for (let i = 1; i < size; i++) {
          const at = entries[i].offset
          const expected = `${i} 0 obj`
          expect(
            text.startsWith(expected, at),
            `xref says object ${i} is at byte ${at}, but that byte begins ` +
              `${JSON.stringify(text.slice(at, at + 24))}`,
          ).toBe(true)
        }
      })

      it('has a free head entry and no other free entries', () => {
        expect(entries[0].type).toBe('f')
        expect(entries[0].offset).toBe(0)
        for (let i = 1; i < size; i++) expect(entries[i].type).toBe('n')
      })

      it('offsets increase — objects are written in order, never overlapping', () => {
        for (let i = 2; i < size; i++) {
          expect(entries[i].offset).toBeGreaterThan(entries[i - 1].offset)
        }
      })

      it('trailer /Size matches the number of entries', () => {
        const declared = /\/Size (\d+)/.exec(text.slice(text.lastIndexOf('trailer')))!
        expect(Number(declared[1])).toBe(size)
      })

      it('is a structurally complete file', () => {
        expect(text.startsWith('%PDF-1.4\n')).toBe(true)
        // The high-byte comment that marks the file binary to transfer tools.
        expect(text.slice(9, 14)).toBe('%\xE2\xE3\xCF\xD3')
        expect(text.endsWith('%%EOF\n')).toBe(true)
        expect(text).toContain('/Type /Catalog')
        expect(text).toContain('/Type /Pages')
      })

      it('declares as many page objects as it lists in /Kids', () => {
        const pages = /\/Type \/Pages \/Count (\d+) \/Kids \[([^\]]*)\]/.exec(text)!
        expect(pages, 'no page tree').not.toBeNull()
        const kids = pages[2].trim().split(/\s+0 R\s*/).filter(Boolean)
        expect(kids).toHaveLength(Number(pages[1]))
        // Every /Page object in the file is reachable from the tree.
        expect((text.match(/\/Type \/Page[^s]/g) ?? []).length).toBe(Number(pages[1]))
      })
    })
  }

  it('★ a stream object still points at its own header, not at its payload', () => {
    // Binary stream bytes are pushed as their own chunk between the object
    // header and `endobj`. If the offset bookkeeping counted a stream's length
    // wrongly, every LATER object's offset would slide — which is precisely the
    // "some viewers open it, others reject it" failure.
    const doc = createPdf('Stream offsets')
    addImagePage(doc, fakeJpeg(320, 240))
    addImagePage(doc, fakeJpeg(64, 48))
    addTextPage(doc, { blocks: [{ kind: 'text', text: 'after the streams' }] })

    const bytes = buildPdfBytes(doc)
    const { size, entries, text } = readXref(bytes)

    // The last object is well past the two embedded JPEGs.
    expect(entries[size - 1].offset).toBeGreaterThan(200)
    for (let i = 1; i < size; i++) {
      expect(text.startsWith(`${i} 0 obj`, entries[i].offset)).toBe(true)
    }
  })

  it('★ a declared /Length matches the bytes actually written', () => {
    const doc = createPdf('Lengths')
    addImagePage(doc, fakeJpeg(320, 240))
    const text = asText(buildPdfBytes(doc))

    // Every stream in the file: `/Length N >>\nstream\n<N bytes>\nendstream`.
    const streams = [...text.matchAll(/\/Length (\d+)[^>]*>>\nstream\n/g)]
    expect(streams.length).toBeGreaterThan(0)
    for (const match of streams) {
      const declared = Number(match[1])
      const start = match.index! + match[0].length
      expect(
        text.startsWith('\nendstream', start + declared),
        `a stream declared ${declared} bytes but endstream is elsewhere`,
      ).toBe(true)
    }
  })
})

describe('prepareText — WinAnsi, and the rupee', () => {
  it('★ transliterates ₹ before a figure, taking the space a symbol would', () => {
    // The trap the module names twice: ₹ (U+20B9) has no WinAnsi byte, and
    // every money figure in this app wants one.
    expect(prepareText('₹24,50,000')).toBe('Rs. 24,50,000')
    expect(prepareText('₹ 1800')).toBe('Rs. 1800')
  })

  it('transliterates a bare ₹ with no space', () => {
    expect(prepareText('cost in ₹')).toBe('cost in Rs.')
  })

  it('maps the typographic characters that do have a WinAnsi byte', () => {
    expect(prepareText('a — b')).toBe('a \x97 b') // em dash
    expect(prepareText('a – b')).toBe('a \x96 b') // en dash
    expect(prepareText('•')).toBe('\x95')
    expect(prepareText('“x”')).toBe('\x93x\x94')
  })

  it('★ replaces what it cannot map with ?, never dropping it silently', () => {
    // A mangled string must be visible rather than invisible. This is also the
    // known product gap: Indic room names print as question marks.
    // One `?` per code point — `prepareText` iterates with `for...of`, so a
    // surrogate pair counts once. शयनकक्ष is 7 code points; शयन is 3.
    expect(prepareText('शयनकक्ष')).toBe('???????')
    expect(prepareText('Bedroom शयन')).toBe('Bedroom ???')
  })

  it('keeps Latin-1 accents, which do have bytes', () => {
    expect(prepareText('café')).toBe('caf\xe9')
  })

  it('flattens newlines and tabs rather than emitting a raw control byte', () => {
    expect(prepareText('a\nb')).toBe('a b')
    expect(prepareText('a\r\nb')).toBe('a  b')
    expect(prepareText('a\tb')).toBe('a    b')
  })

  it('normalises the characters a unit string carries', () => {
    expect(prepareText('12′6″')).toBe(`12'6"`)
    expect(prepareText('−5')).toBe('-5')
    expect(prepareText('a\u00a0b')).toBe('a b')
  })
})

describe('★ PDF string escaping', () => {
  it('escapes parentheses in a project name', () => {
    // "Verma (Phase 2)" would otherwise close the string early and the file
    // would be garbage from that byte on — the module says so explicitly.
    const doc = createPdf('Verma (Phase 2)')
    addTextPage(doc, { title: 'Verma (Phase 2)', blocks: [{ kind: 'text', text: 'a (b) c' }] })
    const text = asText(buildPdfBytes(doc))

    expect(text).toContain('\\(Phase 2\\)')
    expect(text).not.toContain('(Verma (Phase 2))')
  })

  it('escapes a backslash', () => {
    const doc = createPdf('x')
    addTextPage(doc, { blocks: [{ kind: 'text', text: 'C:\\plans' }] })
    expect(asText(buildPdfBytes(doc))).toContain('C:\\\\plans')
  })

  it('octal-escapes a high byte so it cannot break the literal', () => {
    const doc = createPdf('x')
    addTextPage(doc, { blocks: [{ kind: 'text', text: 'a — b' }] })
    // 0x97 is the em dash's WinAnsi byte: \227 octal.
    expect(asText(buildPdfBytes(doc))).toContain('\\227')
  })

  it('the escaped file still has valid offsets', () => {
    const doc = createPdf('Verma (Phase 2) \\ ₹')
    addTextPage(doc, { title: 'A (b) \\ c', blocks: [{ kind: 'text', text: '(((' }] })
    const bytes = buildPdfBytes(doc)
    const { size, entries, text } = readXref(bytes)
    for (let i = 1; i < size; i++) {
      expect(text.startsWith(`${i} 0 obj`, entries[i].offset)).toBe(true)
    }
  })
})

describe('readJpeg, via addImagePage', () => {
  it('reads the frame header for size and colour space', () => {
    const doc = createPdf('x')
    addImagePage(doc, fakeJpeg(1234, 567))
    const text = asText(buildPdfBytes(doc))

    expect(text).toContain('/Width 1234 /Height 567')
    expect(text).toContain('/ColorSpace /DeviceRGB')
    expect(text).toContain('/Filter /DCTDecode')
  })

  it('uses DeviceGray for a single-component JPEG', () => {
    const doc = createPdf('x')
    addImagePage(doc, fakeJpeg(10, 10, 1))
    expect(asText(buildPdfBytes(doc))).toContain('/ColorSpace /DeviceGray')
  })

  it('embeds the bytes untouched — no re-encoding', () => {
    const jpeg = fakeJpeg(64, 64)
    const doc = createPdf('x')
    addImagePage(doc, jpeg)
    const text = asText(buildPdfBytes(doc))
    expect(text).toContain(asText(jpeg))
  })

  it('rejects bytes that are not a JPEG', () => {
    const doc = createPdf('x')
    expect(() => addImagePage(doc, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(/not a JPEG/)
    expect(() => addImagePage(doc, new Uint8Array([]))).toThrow(/not a JPEG/)
  })

  it('★ rejects a CMYK JPEG rather than mis-rendering it', () => {
    const doc = createPdf('x')
    expect(() => addImagePage(doc, fakeJpeg(10, 10, 4))).toThrow(/colour components/)
  })

  it('rejects a zero-sized frame', () => {
    const doc = createPdf('x')
    expect(() => addImagePage(doc, fakeJpeg(0, 10))).toThrow(/zero-sized/)
  })

  it('rejects a JPEG with no frame header at all', () => {
    const doc = createPdf('x')
    // SOI then straight to EOI: nothing to read a size from.
    expect(() => addImagePage(doc, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow(
      /no frame header/,
    )
  })
})

describe('layout', () => {
  it('★ an empty document still gets a page — a pageless PDF is invalid', () => {
    const text = asText(buildPdfBytes(createPdf('Nothing')))
    expect(text).toContain('/Type /Pages /Count 1')
  })

  it('overflows long content onto continuation pages', () => {
    const long = Array.from({ length: 200 }, (_, i) => ({
      kind: 'text' as const,
      text: `Paragraph ${i} — ${'lorem ipsum dolor sit amet '.repeat(6)}`,
    }))
    const text = asText(onePageDoc(long))
    const count = Number(/\/Type \/Pages \/Count (\d+)/.exec(text)![1])

    expect(count).toBeGreaterThan(1)
    // Continuation pages are labelled, so a reader knows where they are.
    expect(text).toContain('\\(continued\\)')
  })

  it('numbers every page "n of m" with the same m', () => {
    const text = asText(
      onePageDoc(
        Array.from({ length: 120 }, (_, i) => ({
          kind: 'text' as const,
          text: `Line ${i} ${'x '.repeat(30)}`,
        })),
      ),
    )
    const stamps = [...text.matchAll(/\(Page (\d+) of (\d+)\)/g)]
    expect(stamps.length).toBeGreaterThan(1)

    const totals = new Set(stamps.map((s) => s[2]))
    expect(totals.size, 'the page total disagrees between pages').toBe(1)
    expect(Number([...totals][0])).toBe(stamps.length)
    expect(stamps.map((s) => Number(s[1]))).toEqual(
      stamps.map((_, i) => i + 1),
    )
  })

  it('gives an empty table a "None" row so it reads as answered', () => {
    const text = asText(
      onePageDoc([
        { kind: 'table', columns: [{ header: 'Room', width: 1 }], rows: [] },
      ]),
    )
    expect(text).toContain('(None)')
    expect(text).toContain('(Room)')
  })

  it('drops a table with no columns rather than inventing a shape', () => {
    const text = asText(onePageDoc([{ kind: 'table', columns: [], rows: [['x']] }]))
    expect(text).not.toContain('(x)')
  })

  it('★ repeats a table header across a page break', () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`Room ${i}`, `${i}`])
    const text = asText(
      onePageDoc([
        {
          kind: 'table',
          columns: [
            { header: 'RoomHeader', width: 3 },
            { header: 'AreaHeader', width: 1, align: 'right' },
          ],
          rows,
        },
      ]),
    )

    const count = Number(/\/Type \/Pages \/Count (\d+)/.exec(text)![1])
    expect(count).toBeGreaterThan(1)
    // One header per page, not one for the whole table.
    expect((text.match(/\(RoomHeader\)/g) ?? []).length).toBe(count)
  })

  it('right-aligns a numeric column at a larger x than the left column', () => {
    const text = asText(
      onePageDoc([
        {
          kind: 'table',
          columns: [
            { header: 'Room', width: 3 },
            { header: 'Area', width: 1, align: 'right' },
          ],
          rows: [['Kitchen', '120']],
        },
      ]),
    )
    const xOf = (label: string) => {
      const at = text.indexOf(`(${label}) Tj`)
      const tm = text.lastIndexOf('1 0 0 1 ', at)
      return Number(text.slice(tm + 8, at).trim().split(/\s+/)[0])
    }
    expect(xOf('120')).toBeGreaterThan(xOf('Kitchen'))
  })

  it('honours the page size it is given', () => {
    const doc = createPdf('x')
    addImagePage(doc, fakeJpeg(100, 100), { size: A4_LANDSCAPE })
    addTextPage(doc, { size: A4_PORTRAIT, blocks: [{ kind: 'text', text: 'x' }] })
    const text = asText(buildPdfBytes(doc))

    expect(text).toContain('/MediaBox [0 0 841.89 595.28]')
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]')
  })

  it('renders every block kind without losing the page', () => {
    const text = asText(
      onePageDoc([
        { kind: 'heading', text: 'Built-up area' },
        { kind: 'text', text: 'Measured to wall centrelines.' },
        { kind: 'bullets', items: ['First point', 'Second point'] },
        { kind: 'rule' },
        { kind: 'gap', height: 20 },
        {
          kind: 'table',
          columns: [{ header: 'Floor', width: 1 }],
          rows: [[{ text: 'Total', bold: true }]],
        },
      ]),
    )
    expect(text).toContain('(Built-up area)')
    expect(text).toContain('(Measured to wall centrelines.)')
    expect(text).toContain('(First point)')
    expect(text).toContain('(Total)')
    // The bullet glyph, and a bold run using F2.
    expect(text).toContain('\\225')
    expect(text).toContain('/F2 ')
  })

  it('puts the document title in /Info as ASCII', () => {
    // A title is a PDF *text string*, not a content stream, and the two
    // disagree over every byte from 0x80 to 0x9F. The separator is a plain
    // hyphen for exactly that reason.
    const doc = createPdf('Verma Residence - floor plans')
    addTextPage(doc, { blocks: [{ kind: 'text', text: 'x' }] })
    const text = asText(buildPdfBytes(doc))

    expect(text).toContain('/Title (Verma Residence - floor plans)')
    expect(text).toContain('/Producer (Space Designer)')
  })
})
