# Asking a practice for drawings

One page. Paste the block below into an email, fill the three brackets, send.

**The rule this request is built on:** it must be answerable by *forwarding
files that already exist*. If a reply needs someone to open CAD, re-export,
redact, rename, or tidy anything, the ask is wrong and the reply will not come.

> **This is version 2.** Version 1 asked for "about ten floor plans you've
> already delivered, whatever you have, in whatever state", and led with *"the
> messy ones are the most useful"*. It produced seven marketing sheets:
> coloured, furnished, laid out for a property listing, two of them 3D isometric
> renders that are not plans at all. **Zero working drawings.**
>
> The request was not wrong about *quality* — a bad scan really is more useful
> than a clean export. It was wrong about **artefact class**, and it never said
> which class it meant, so "floor plan" was read as "a picture of a floor plan",
> which is a much larger and much more colourful set. See
> [corpus-manifest.md](corpus-manifest.md) for what arrived and
> [corpus-batch-2-gates.md](corpus-batch-2-gates.md) for what it measured.
>
> **Separate the two axes and state both.** The class is not negotiable; the
> quality is come-as-you-are.

---

## The email

> **Subject:** Can I borrow ~10 working drawings to test a drawing tool?
>
> Hi [name],
>
> I'm building [one line: what it is — e.g. "a browser tool that reads a floor
> plan image and rebuilds it as an editable 2D/3D model"], and I've hit the
> point where it needs to be tested against real drawings rather than ones I
> made up. Mine are too clean, and they're hiding problems.
>
> **Could you forward about ten floor plans that actually went out — sent to a
> client, issued to a contractor, or submitted for sanction?**
>
> That last part is the whole ask, so to be specific about what I mean:
>
> **What I'm after**
>
> - the **DWG or the PDF that left your office** — the drawing itself, not a
>   presentation of it
> - **black-and-white line work**: walls as poché or double lines, doors and
>   windows as symbols, room names as text
> - **with the dimension strings on** — that's how I check the tool got the
>   sizes right, and it's the single most valuable thing on the sheet
> - **scans and photos of printed sheets are very welcome**, including bad ones
>
> **What isn't useful, so please don't spend time finding them**
>
> - coloured presentation plans with furniture, tiles and cars drawn in
> - 3D views, isometrics, cutaways, walkthrough stills
> - anything laid out as a sales or listing sheet — legends, photos and the plan
>   arranged as a poster
>
> Not a criticism of those; my tool just can't read them, and knowing that is
> already settled.
>
> **One plan per sheet if that's how they come.** If a sheet has the ground and
> first floor side by side that's fine and I'll cope, but a single plan per file
> is easier for me.
>
> **Please send them at full size — don't let anything shrink them.** This is
> the one thing that can't be fixed at my end. Email attachments, a Drive or
> Dropbox link, or "send as file" rather than as a photo in a chat app all keep
> the original; pasting into a message or sharing from a phone gallery usually
> resizes it down to a few hundred pixels, and detail that's been resized away
> can't be recovered. If it's easier to just send them however is convenient and
> let me tell you whether they arrived intact, that's completely fine.
>
> **Quality genuinely does not matter.** A skewed 72 dpi scan, a phone photo
> with a shadow across it, a fax-quality print, a title block over the corner —
> those are the ones that break tools and the ones I most want. A pristine CAD
> export is the case that already works. Old projects, superseded revisions and
> part-sets are all fine; I don't need complete packages and I don't need
> anything current.
>
> **If it's easy** (and please skip either if it isn't):
>
> - one real dimension you know — "the building is 12.4 m across", "that wall is
>   9 feet". One number per drawing is plenty, and the dimension strings on the
>   sheet usually cover this anyway
> - the DWG alongside the PDF, if it happens to exist
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

**Name the class in the subject line and the first sentence.** "Working
drawings", "issued for construction", "submitted for sanction" — these are
phrases with a precise meaning to an architect, and they exclude presentation
artwork without anyone having to be told their renders are unwanted. "Floor
plan" does not exclude anything.

**Say what isn't useful, explicitly, and say why it isn't their fault.** The
version-1 reply was seven files someone went to real trouble to find. Listing
the excluded classes costs three lines and saves that effort next time.

**Keep saying the messy ones are valuable — just not instead of the class.**
Both statements are true and they are about different things. The failure was
running them together so that "whatever state" swallowed "delivered drawing".

**Resolution is the one axis where "whatever state" is wrong**, and v2 did not
say so. Batch 3 answered v2 correctly — four genuine CAD drawings — and all four
arrived **473–474 px wide**, a fixed-width resize applied in transit. At that
size a 115 mm partition is under four pixels and no gate downstream can pass.
Skew, creases, shadows and coffee rings are all recoverable in principle;
**resampling is not**. Say it as a transport instruction rather than a quality
demand, because the contributor did nothing wrong — their sharing app did.

**Ask for dimension strings, not for the scale.** They are already on a working
drawing, so it costs nothing, and it is worth more than a calibration number
because it lets a *drawing* be checked for internal consistency. One sheet in
batch 2 turned out to be stretched to fit its panel — the width and height
implied scales 15% apart. A supplied `metresPerPixel` would have hidden that;
the dimension strings revealed it.

**Do not ask for ground truth.** Tracing a drawing accurately is an hour of an
architect's time per sheet. That work is ours, later, and only for the subset
that turns out to matter.

**Permission wording is deliberately narrow.** "Engineering validation, not
redistribution" is a claim we can actually keep: the corpus lives in a
gitignored directory and only a manifest of hashes and tags is committed. Do
not widen it to anything that sounds like a licence.

**What arrives is not the corpus yet.** It is intake. Sorting, tagging against
`corpus.md`'s axes, and hashing into the manifest come after, and that work is
ours.

## Where the files go

```
corpus/                     gitignored — real drawings never enter the repo
  <name>.<ext>              the image, as delivered
  <name>.<ext>.meta.json    optional: { "metresPerPixel", "calibrationSource", "note" }
docs/testing/corpus-manifest.md   committed: hash · dims · tags · source · permission
docs/testing/corpus-baseline-*.csv  committed: one row per drawing, per run
```

`npm run corpus corpus/` reads that directory and writes one row per drawing.
It runs headless and needs nothing but the files.
