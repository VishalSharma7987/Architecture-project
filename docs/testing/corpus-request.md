# Asking a practice for drawings

One page. Paste the block below into an email, fill the three brackets, send.

**The rule this request is built on:** it must be answerable by *forwarding
files that already exist*. If a reply needs someone to open CAD, re-export,
redact, rename, or tidy anything, the ask is wrong and the reply will not come.

---

## The email

> **Subject:** Can I borrow ~10 of your floor plans to test a drawing tool?
>
> Hi [name],
>
> I'm building [one line: what it is — e.g. "a browser tool that reads a floor
> plan image and rebuilds it as an editable 2D/3D model"], and I've hit the
> point where it needs to be tested against real drawings rather than ones I
> made up. Mine are too clean, and they're hiding problems.
>
> **Could you forward about ten floor plans you've already delivered?**
>
> Whatever you have, in whatever state:
>
> - PDFs, JPEGs, PNGs, scans, phone photos of a printed sheet — all useful
> - **the messy ones are the most useful.** A skewed scan, a photo with a shadow
>   across it, a fax-quality print, something with a watermark or a title block
>   over the corner — those are the ones that break tools, and clean exports
>   tell me nothing I don't already know
> - part-sets are fine; I don't need a complete package
>
> **If it's easy** (and please skip any of these if it isn't):
>
> - the scale, or just one real dimension you know — "the building is 12.4 m
>   across", "that wall is 9 feet". One number per drawing is plenty
> - the CAD or DWG original, if it happens to exist alongside
>
> **What I'd do with them:** run them through the tool, record where it fails,
> and use that to fix it. They stay on my machine, they aren't republished,
> redistributed, or shown to anyone outside this work, and they aren't used to
> train anything. If a client's name or address is on a sheet, that's fine —
> I'm reading walls, not text — but say the word and I'll leave that drawing
> out entirely.
>
> No rush, and no need to prepare anything — forwarding what you have is
> exactly right.
>
> Thanks,
> [you]

---

## Notes for whoever sends it

**Say the messy ones are valuable, and say it early.** The instinct is to send
the tidiest CAD exports. Those are the case that already works. A 72 dpi scan
with a coffee ring is worth five clean PDFs.

**Do not ask for ground truth.** Tracing a drawing accurately is an hour of an
architect's time per sheet. That work is ours, later, and only for the subset
that turns out to matter.

**One known dimension is worth a lot and costs nothing.** It moves a drawing
from "we can see whether detection finds walls" to "we can see whether the
walls are the right size", which is a different and harder question. But it is
genuinely optional — a drawing with no scale still exercises every gate except
the resolution one.

**Permission wording is deliberately narrow.** "Engineering validation, not
redistribution" is a claim we can actually keep: the corpus lives in a
gitignored directory and only a manifest of hashes and tags is committed. Do
not widen it to anything that sounds like a licence.

**What arrives is not the corpus yet.** It is intake. Sorting, tagging against
`corpus.md`'s six axes, and hashing into the manifest come after, and that work
is ours.

## Where the files go

```
corpus/                     gitignored — real drawings never enter the repo
  <hash>.<ext>              the image, as delivered
  <hash>.meta.json          optional: { "metresPerPixel", "calibrationSource", "note" }
docs/testing/corpus-manifest.md   committed: hash · tags · source · licence
```

`npm run corpus corpus/` reads that directory and writes one row per drawing.
It runs headless and needs nothing but the files.
