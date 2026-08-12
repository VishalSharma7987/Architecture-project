# The reference target

The quality bar for the drawing editor, written by the project owner on
2026-08-12 against a real reference drawing and a first attempt at reproducing
it.

**This is a standard, not a task list.** It is what "good" means for the next
several sessions. Nothing here is scheduled by being here.

---

## The reference, verbatim

> THE REFERENCE: a 9.00 x 11.00 m three-bedroom plan, 99.00 sq.m built-up.
> Rooms: Living/Dining 6.00x3.50 · Kitchen 3.00x3.00 · Bedroom 1 3.00x3.50 ·
> Bedroom 2 3.00x3.50 · Bedroom 3 3.00x3.00 · Bath 1.50x2.40 · Foyer
> 1.50x2.00. It carries: thick shell walls and thin partitions, dimension
> chains on all four sides (3.00/3.00/3.00 top, 3.00/1.50/3.00/1.50 bottom),
> room name AND dimensions under each name, doors with swing arcs, windows as
> glazed openings in the wall thickness, furniture that reads as furniture,
> a room schedule, a north arrow, and a built-up area figure.

## The attempt, verbatim

> MY ATTEMPT, and the finding that matters most:
>
> ```
>   Reference           Mine
>   9.00 x 11.00 m      20.5 x 14.5 m
>   99 m²               299.7 m²
>   Bedroom 3.50x3.00   45.7 m²
>   Kitchen 9 m²        27.9 m²
>   Living 21 m²        137.8 m²
> ```
>
> The LAYOUT is right. The SIZE is 3x wrong in every room. I drew by eye on
> the grid and nothing told me the building was wrong. Typed length exists
> (B29) but I would have had to know to use it on every wall, and there is no
> way to state "this building is 9 x 11 m" or to see that it isn't.

---

## The rule that outranks the rest

> dimensional correctness before visual fidelity — a plan that looks
> right and is 3x wrong is worse than one that looks plain and measures
> right

## What counts as done

Two tests, and BOTH must pass for any element on this page:

1. **The editor can produce it.**
2. **It READS correctly on screen.**

*"Function exists" is not "feature is usable."*

## What is out of scope by default

> Do NOT invent tools because other CAD software has them. If the reference
> does not need it, it is not a gap.

---

## Scoring the attempt against this page

Recorded once, as the baseline the next sessions move. See the B31 audit for
the evidence behind each line.

| Reference element | Editor can produce it | Reads correctly |
|---|---|---|
| 9.00 × 11.00 m at a stated size | **no** | — |
| Thick shell walls, thin partitions | yes, per wall by hand | **no** — one default, 200 mm |
| Dimension chains on all four sides | **no** — per-wall labels only | **no** — they collide and drop out |
| Room name AND dimensions under it | 3D only | **no** on the canvas |
| Doors with swing arcs | yes | yes |
| Windows as glazed openings | 2D yes · 3D void only | **no** in 3D |
| Furniture that reads as furniture | 3D yes · 2D rectangles | **no** in 2D |
| Room schedule | yes | yes |
| North arrow | yes | yes |
| Built-up area figure | yes (status bar, live) | yes |
