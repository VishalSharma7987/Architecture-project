import { useEffect, useRef, useState } from 'react'
import { allFloors, useDesignStore } from '../store/useDesignStore'
import { isImageFile, loadBlueprintFromFile } from '../blueprint/load'
import { downloadDesign, readDesignFile } from '../persistence/files'
import {
  downloadPlanPng,
  downloadViewportPng,
} from '../persistence/imageExport'
import {
  downloadAreaStatementCsv,
  downloadAreaStatementPdf,
  downloadPlanPdf,
  type DocumentInput,
} from '../export/documents'
import { attachable, serializeDesign } from '../persistence/schema'
import {
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  type ProjectSummary,
} from '../persistence/storage'

type Status = { tone: 'ok' | 'error'; message: string } | null

/**
 * Projects dropdown: name and save the current design, reopen a stored one,
 * start fresh, import a JSON file, and export — as a printable plan image, a
 * 3D snapshot, or the project file itself.
 */
export function ProjectsMenu() {
  const walls = useDesignStore((s) => s.walls)
  const furniture = useDesignStore((s) => s.furniture)
  const floorMaterial = useDesignStore((s) => s.floorMaterial)
  const units = useDesignStore((s) => s.units)
  const roomLabels = useDesignStore((s) => s.roomLabels)
  const northOffset = useDesignStore((s) => s.northOffset)
  const plot = useDesignStore((s) => s.plot)
  const constructionRate = useDesignStore((s) => s.constructionRate)
  const plotFacing = useDesignStore((s) => s.plotFacing)
  const viewMode = useDesignStore((s) => s.viewMode)
  const projectName = useDesignStore((s) => s.projectName)
  const blueprint = useDesignStore((s) => s.blueprint)
  const loadDesign = useDesignStore((s) => s.loadDesign)
  const newDesign = useDesignStore((s) => s.newDesign)
  const setProjectName = useDesignStore((s) => s.setProjectName)
  const setViewMode = useDesignStore((s) => s.setViewMode)
  const setBlueprintPanelOpen = useDesignStore((s) => s.setBlueprintPanelOpen)

  const [open, setOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [draftName, setDraftName] = useState('')
  const [status, setStatus] = useState<Status>(null)
  // Which document is being generated, by its test id. Rendering three storeys
  // at print resolution takes long enough that a menu giving no sign of it
  // reads as a menu whose buttons do nothing.
  const [pending, setPending] = useState<string | null>(null)
  /**
   * The destructive action awaiting a second click, as `verb:name`, or null.
   *
   * Save-over and delete both permanently destroy a stored project and had no
   * confirmation at all. Cleared whenever the menu opens or the name changes,
   * so a stale confirmation can never be armed by accident.
   */
  const [confirming, setConfirming] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // The stored list can change while the menu is open (autosave writes to it),
  // so refresh on open rather than holding a stale snapshot.
  //
  // Keyed on `open` alone: saving updates `projectName`, and depending on that
  // here would re-run this effect and wipe the "Saved …" confirmation the save
  // just set. The current name is read imperatively for the same reason.
  useEffect(() => {
    if (!open) return
    setProjects(listProjects())
    setDraftName(useDesignStore.getState().projectName ?? '')
    setStatus(null)
    setExportOpen(false)
    setConfirming(null)
  }, [open])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target)) {
        setOpen(false)
        return
      }
      // Inside the menu but outside the export popover: dismiss just the
      // popover, so the click still lands on whatever was pressed.
      if (!exportRef.current?.contains(target)) setExportOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Escape peels one layer at a time.
      if (exportOpen) setExportOpen(false)
      else setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, exportOpen])

  const refresh = () => setProjects(listProjects())

  const handleSave = () => {
    const name = draftName.trim()
    if (!name) {
      setStatus({ tone: 'error', message: 'Give the project a name first.' })
      return
    }

    // Saving is keyed on the name, so typing an existing one destroyed that
    // project with no warning. Confirmation is inline and two-step rather than
    // a `window.confirm`: it matches the vocabulary `copyToNextFloor` already
    // uses for a refusal the user can override, and it does not block the tab.
    const overwriting = name !== projectName && projects.some((p) => p.name === name)
    if (overwriting && confirming !== `save:${name}`) {
      setConfirming(`save:${name}`)
      setStatus({
        tone: 'error',
        message: `“${name}” already exists. Save again to replace it.`,
      })
      return
    }
    setConfirming(null)

    // Read the storeys at save time rather than subscribing: `allFloors`
    // builds a fresh array each call, so as a selector it would hand zustand a
    // new snapshot on every render and spin forever.
    const floors = allFloors(useDesignStore.getState())
    const result = saveProject(
      serializeDesign({
        name,
        walls,
        furniture,
        roomLabels,
        stairs: floors[0].stairs,
        floors,
        plot,
        floorMaterial,
        viewMode,
        units,
        constructionRate,
        northOffset,
        plotFacing,
        blueprint,
      }),
    )
    if (!result.ok) {
      setStatus({ tone: 'error', message: result.error })
      return
    }

    setProjectName(name)
    refresh()
    setStatus({ tone: 'ok', message: `Saved “${name}”.` })
  }

  const handleLoad = (name: string) => {
    const doc = loadProject(name)
    if (!doc) {
      setStatus({ tone: 'error', message: `Could not open “${name}”.` })
      refresh()
      return
    }

    loadDesign({
      name: doc.name,
      walls: doc.walls,
      furniture: doc.furniture,
      roomLabels: doc.rooms,
      plot: doc.plot,
      floors: doc.floors,
      stairs: doc.floors[0]?.stairs,
      floorMaterial: doc.settings.floorMaterial,
      viewMode: doc.settings.viewMode,
      units: doc.settings.units,
      constructionRate: doc.settings.constructionRate,
      northOffset: doc.settings.northOffset,
      plotFacing: doc.settings.plotFacing,
      blueprint: attachable(doc.blueprint),
    })
    setOpen(false)
  }

  const handleDelete = (name: string) => {
    // One stray click on a ✕ used to destroy a project outright. The second
    // click is the confirmation; the button relabels itself in between.
    if (confirming !== `delete:${name}`) {
      setConfirming(`delete:${name}`)
      return
    }
    setConfirming(null)
    deleteProject(name)
    // The open design keeps its contents but is no longer a stored project.
    if (projectName === name) setProjectName(null)
    refresh()
    setStatus({ tone: 'ok', message: `Deleted “${name}”.` })
  }

  const handleNew = () => {
    newDesign()
    setDraftName('')
    setOpen(false)
  }

  const exportName = projectName ?? 'Untitled'

  const handleExportPlanPng = async () => {
    setExportOpen(false)
    try {
      await downloadPlanPng({
        walls,
        furniture,
        name: exportName,
        northOffset,
        units,
        roomLabels,
        date: new Date().toISOString(),
      })
      setStatus({ tone: 'ok', message: 'Floor plan PNG downloaded.' })
    } catch (error) {
      setStatus({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not export the floor plan.',
      })
    }
  }

  const handleExportViewPng = async () => {
    setExportOpen(false)
    // False means no 3D canvas is mounted, or the browser refused the encode;
    // either way the user gets no file and needs telling.
    const done = await downloadViewportPng(exportName)
    setStatus(
      done
        ? { tone: 'ok', message: '3D view PNG downloaded.' }
        : {
            tone: 'error',
            message: 'Could not capture the 3D view. Open it and try again.',
          },
    )
  }

  const handleExportJson = () => {
    setExportOpen(false)
    const floors = allFloors(useDesignStore.getState())
    downloadDesign(
      serializeDesign({
        name: exportName,
        walls,
        furniture,
        roomLabels,
        stairs: floors[0].stairs,
        floors,
        plot,
        floorMaterial,
        viewMode,
        units,
        constructionRate,
        northOffset,
        plotFacing,
        blueprint,
      }),
    )
  }

  // Read imperatively, like `handleSave` does: `allFloors` builds a new array
  // every call, so subscribing to it would spin.
  const documentInput = (): DocumentInput => ({
    projectName,
    floors: allFloors(useDesignStore.getState()),
    plot,
    northOffset,
    plotFacing,
    constructionRate,
    units,
  })

  /**
   * Runs one document export, showing it is working and reporting failure.
   *
   * A rejected promise here — a canvas the browser would not encode, a design
   * too large to rasterise — would otherwise disappear into the console and
   * leave the user waiting for a file that is never coming.
   */
  const runExport = async (
    id: string,
    done: string,
    build: () => void | Promise<void>,
  ) => {
    setPending(id)
    setStatus(null)
    try {
      await build()
      setStatus({ tone: 'ok', message: done })
      setExportOpen(false)
    } catch (error) {
      setStatus({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not build that document.',
      })
    } finally {
      setPending(null)
    }
  }

  const handleImport = async (file: File) => {
    // An image is not a project file, but it is what most people reach for
    // first — a plan they have been sent. Rather than rejecting it as invalid
    // JSON, load it as a blueprint to trace and take them to it.
    if (isImageFile(file)) {
      const loaded = await loadBlueprintFromFile(file)
      if (!loaded.ok) {
        setStatus({ tone: 'error', message: loaded.error })
        return
      }
      setViewMode('2d')
      setBlueprintPanelOpen(true)
      setOpen(false)
      return
    }

    const result = await readDesignFile(file)
    if (!result.ok) {
      setStatus({ tone: 'error', message: result.error })
      return
    }

    loadDesign({
      name: result.doc.name,
      walls: result.doc.walls,
      furniture: result.doc.furniture,
      roomLabels: result.doc.rooms,
      plot: result.doc.plot,
      floors: result.doc.floors,
      stairs: result.doc.floors[0]?.stairs,
      floorMaterial: result.doc.settings.floorMaterial,
      viewMode: result.doc.settings.viewMode,
      units: result.doc.settings.units,
      constructionRate: result.doc.settings.constructionRate,
      northOffset: result.doc.settings.northOffset,
      plotFacing: result.doc.settings.plotFacing,
      blueprint: attachable(result.doc.blueprint),
    })
    setStatus(
      result.warnings.length > 0
        ? {
            tone: 'ok',
            message: `Imported with ${result.warnings.length} issue(s) repaired.`,
          }
        : { tone: 'ok', message: `Imported “${result.doc.name}”.` },
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="projects-menu"
        className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200"
      >
        {projectName ?? 'Untitled'}
        <span aria-hidden className="text-[9px] text-slate-400">
          ▼
        </span>
      </button>

      {open && (
        <div
          data-testid="projects-panel"
          className="absolute left-0 z-20 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="flex gap-1.5">
            <input
              value={draftName}
              onChange={(e) => {
                setDraftName(e.target.value)
                // Retyping invalidates a pending overwrite confirmation.
                setConfirming(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Project name"
              data-testid="project-name-input"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={handleSave}
              data-testid="project-save"
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white ${
                confirming === `save:${draftName.trim()}`
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-slate-900 hover:bg-slate-700'
              }`}
            >
              {confirming === `save:${draftName.trim()}` ? 'Replace' : 'Save'}
            </button>
          </div>

          {status && (
            <p
              data-testid="project-status"
              className={`mt-2 text-[11px] ${
                status.tone === 'error' ? 'text-red-600' : 'text-emerald-600'
              }`}
            >
              {status.message}
            </p>
          )}

          <div className="mt-3 border-t border-slate-100 pt-2">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Saved projects
            </h3>

            {projects.length === 0 ? (
              <p className="px-1 py-1 text-[11px] text-slate-400">
                Nothing saved yet.
              </p>
            ) : (
              <ul className="max-h-56 overflow-y-auto" data-testid="project-list">
                {projects.map((project) => (
                  <li key={project.name} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleLoad(project.name)}
                      data-testid={`project-open-${project.name}`}
                      className="flex-1 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <span className="font-medium">{project.name}</span>
                      <span className="ml-2 tabular-nums text-slate-400">
                        {project.wallCount}{' '}
                        {project.wallCount === 1 ? 'wall' : 'walls'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(project.name)}
                      aria-label={
                        confirming === `delete:${project.name}`
                          ? `Confirm deleting project ${project.name}`
                          : `Delete project ${project.name}`
                      }
                      data-testid={`project-delete-${project.name}`}
                      className={`shrink-0 rounded-md px-2 py-1.5 text-xs transition-colors ${
                        confirming === `delete:${project.name}`
                          ? 'bg-red-600 font-semibold text-white'
                          : 'text-slate-400 hover:bg-red-50 hover:text-red-600'
                      }`}
                    >
                      {confirming === `delete:${project.name}` ? 'Delete?' : '✕'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1 border-t border-slate-100 pt-2">
            <MenuAction onClick={handleNew} testId="project-new">
              New
            </MenuAction>
            <div ref={exportRef} className="relative">
              <MenuAction
                onClick={() => setExportOpen((v) => !v)}
                testId="project-export"
                expanded={exportOpen}
                className="w-full"
              >
                Export
                <span aria-hidden className="ml-1 text-[9px] text-slate-400">
                  ▾
                </span>
              </MenuAction>

              {exportOpen && (
                // Opens downwards. It used to open up, which fitted while it
                // held three items; at seven it is taller than the gap between
                // this row and the toolbar, and the top items fell off the
                // screen. Below there is room, and the cap plus scroll keeps
                // it honest on a short window or a long project list.
                <div
                  data-testid="export-panel"
                  className="absolute left-1/2 top-full z-30 mt-1.5 max-h-[calc(100vh-9rem)] w-72 -translate-x-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
                >
                  <ExportGroup label="Documents" />

                  <MenuAction
                    onClick={() =>
                      void runExport(
                        'export-pdf',
                        'Floor plan PDF downloaded.',
                        () => downloadPlanPdf(documentInput()),
                      )
                    }
                    testId="export-pdf"
                    tone="primary"
                    disabled={pending !== null}
                    busy={pending === 'export-pdf'}
                    className="w-full text-left"
                  >
                    <span className="block font-semibold">
                      Floor plan (PDF)
                    </span>
                    <span className="block text-[10px] font-normal text-slate-300">
                      {pending === 'export-pdf'
                        ? 'Drawing every storey…'
                        : 'Every storey, then the area statement'}
                    </span>
                  </MenuAction>

                  <MenuAction
                    onClick={() =>
                      void runExport(
                        'export-statement-pdf',
                        'Area statement PDF downloaded.',
                        () => downloadAreaStatementPdf(documentInput()),
                      )
                    }
                    testId="export-statement-pdf"
                    disabled={pending !== null}
                    busy={pending === 'export-statement-pdf'}
                    className="mt-1 w-full text-left"
                  >
                    <span className="block font-semibold">
                      Area statement (PDF)
                    </span>
                    <span className="block text-[10px] font-normal text-slate-400">
                      Areas, cost estimate and Vastu reading
                    </span>
                  </MenuAction>

                  <MenuAction
                    onClick={() =>
                      void runExport(
                        'export-statement-csv',
                        'Area statement CSV downloaded.',
                        () => downloadAreaStatementCsv(documentInput()),
                      )
                    }
                    testId="export-statement-csv"
                    disabled={pending !== null}
                    busy={pending === 'export-statement-csv'}
                    className="mt-1 w-full text-left"
                  >
                    <span className="block font-semibold">
                      Area statement (CSV)
                    </span>
                    <span className="block text-[10px] font-normal text-slate-400">
                      The same numbers, for a spreadsheet
                    </span>
                  </MenuAction>

                  <ExportGroup label="Images" />

                  <MenuAction
                    onClick={() => void handleExportPlanPng()}
                    testId="export-png"
                    className="w-full text-left"
                  >
                    <span className="block font-semibold">
                      Floor plan (PNG)
                    </span>
                    <span className="block text-[10px] font-normal text-slate-400">
                      The open storey, as one image
                    </span>
                  </MenuAction>

                  <MenuAction
                    onClick={() => void handleExportViewPng()}
                    testId="export-3d"
                    disabled={viewMode !== '3d'}
                    title={
                      viewMode === '3d'
                        ? 'Save the current 3D view as an image'
                        : 'Switch to the 3D view first — there is nothing on screen to capture.'
                    }
                    className="mt-1 w-full text-left"
                  >
                    <span className="block font-semibold">3D view (PNG)</span>
                    <span className="block text-[10px] font-normal text-slate-400">
                      Snapshot of the view on screen
                    </span>
                  </MenuAction>

                  <ExportGroup label="Project" />

                  <MenuAction
                    onClick={handleExportJson}
                    testId="export-json"
                    className="w-full text-left"
                  >
                    <span className="block font-semibold">
                      Project file (.json)
                    </span>
                    <span className="block text-[10px] font-normal text-slate-400">
                      To re-open later in Space Designer
                    </span>
                  </MenuAction>

                  <p className="mt-2 px-2 text-[10px] leading-relaxed text-slate-400">
                    Send a PDF or PNG to anyone; the .json only opens here.
                  </p>
                </div>
              )}
            </div>
            <MenuAction
              onClick={() => fileRef.current?.click()}
              testId="project-import"
              title="Open a .json project, or a plan image to trace over"
            >
              Import
            </MenuAction>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json,image/*"
            className="hidden"
            data-testid="project-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Reset first, so re-picking the same file fires change again.
              e.target.value = ''
              if (file) void handleImport(file)
            }}
          />
        </div>
      )}
    </div>
  )
}

const MENU_ACTION_TONE = {
  quiet:
    'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300 disabled:hover:bg-transparent',
  primary:
    'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400',
}

function MenuAction({
  onClick,
  testId,
  children,
  tone = 'quiet',
  disabled,
  busy,
  title,
  expanded,
  className,
}: {
  onClick: () => void
  testId: string
  children: React.ReactNode
  tone?: keyof typeof MENU_ACTION_TONE
  disabled?: boolean
  /** Work is running behind this item. Disable it too — this only announces. */
  busy?: boolean
  title?: string
  expanded?: boolean
  /** Layout-only extras; colours come from `tone` so nothing conflicts. */
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      title={title}
      aria-expanded={expanded}
      data-testid={testId}
      className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${MENU_ACTION_TONE[tone]} ${className ?? ''}`}
    >
      {children}
    </button>
  )
}

/** A labelled divider, so the popover's three kinds of file read apart. */
function ExportGroup({ label }: { label: string }) {
  return (
    <h4 className="mb-1 mt-3 border-t border-slate-100 px-2 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 first:mt-0 first:border-0 first:pt-0">
      {label}
    </h4>
  )
}
