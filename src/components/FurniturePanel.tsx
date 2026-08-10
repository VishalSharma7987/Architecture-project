import { useState } from "react";
import { FURNITURE, type FurnitureType } from "../furniture/catalog";
import {
  placeKitchenCounters,
  placeToiletFixtures,
} from "../blueprint/detectOpenings";
import { useDesignStore, type Point } from "../store/useDesignStore";
import { provenance } from "../store/provenance";
import { MaterialPicker } from "./MaterialPicker";

/** MIME type used for the drag payload. Read by both viewport drop handlers. */
export const FURNITURE_DRAG_TYPE = "application/x-space-design-furniture";

/**
 * Left-docked panel: floor finish plus the furniture catalogue.
 *
 * Items are dragged onto either viewport — the 2D plan drops at the exact grid
 * point, the 3D view raycasts onto the floor. Clicking drops at the centre of
 * the layout, which keeps the feature usable without a pointer drag.
 */
export function FurniturePanel() {
  const setFurniturePanelOpen = useDesignStore((s) => s.setFurniturePanelOpen);
  const furnitureCount = useDesignStore((s) => s.furniture.length);
  const floorMaterial = useDesignStore((s) => s.floorMaterial);
  const setFloorMaterial = useDesignStore((s) => s.setFloorMaterial);
  const wallCount = useDesignStore((s) => s.walls.length);
  const [note, setNote] = useState<string | null>(null);

  const centreOfPlan = (): Point => {
    const { walls } = useDesignStore.getState();
    if (walls.length === 0) return { x: 0, z: 0 };
    const sum = walls.reduce(
      (acc, w) => ({
        x: acc.x + (w.start.x + w.end.x) / 2,
        z: acc.z + (w.start.z + w.end.z) / 2,
      }),
      { x: 0, z: 0 },
    );
    return { x: sum.x / walls.length, z: sum.z / walls.length };
  };

  const dropAtCentre = (type: FurnitureType) => {
    const { addFurniture, select } = useDesignStore.getState();
    select({
      kind: "furniture",
      furnitureId: addFurniture(type, centreOfPlan(), provenance.manual()),
    });
  };

  const addStaircase = () => {
    const { addStair, select } = useDesignStore.getState();
    select({
      kind: "stair",
      stairId: addStair(centreOfPlan(), provenance.manual()),
    });
    setNote("Added a staircase in the middle. Drag it into place.");
  };

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white"
      data-testid="furniture-panel"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Materials & furniture
        </h2>
        <button
          type="button"
          onClick={() => setFurniturePanelOpen(false)}
          className="text-xs text-slate-400 hover:text-slate-700"
          aria-label="Close furniture panel"
        >
          Close
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Floor finish
          </h3>
          {wallCount === 0 ? (
            <p className="text-[11px] text-slate-400">
              Draw walls to create a floor.
            </p>
          ) : (
            <MaterialPicker
              surface="floor"
              value={floorMaterial}
              onChange={setFloorMaterial}
              testId="floor-material"
            />
          )}
        </section>

        <section className="border-t border-slate-100 pt-4">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Furniture
          </h3>
          <p className="mb-2 text-[11px] text-slate-400">
            Drag into the plan or the 3D view, or click to drop it in the
            middle.
          </p>

          <ul className="space-y-1">
            {FURNITURE.map((item) => (
              <li key={item.type}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(FURNITURE_DRAG_TYPE, item.type);
                    // `copy` gives the cursor the right affordance and stops
                    // the browser treating this as a text drag.
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => dropAtCentre(item.type)}
                  data-testid={`furniture-${item.type}`}
                  className="flex w-full cursor-grab items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:cursor-grabbing"
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="tabular-nums text-[10px] text-slate-400">
                    {item.width} × {item.depth} m
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Quick fills. Each seats a fixture against the wall in every space
              of the matching type, so an imported plan furnishes without
              hunting for the piece and dragging it there. All are normal
              furniture, so they drag, rotate and delete like the rest. */}
          <div className="mt-2 space-y-1.5">
            <button
              type="button"
              onClick={() => {
                const { placed } = placeKitchenCounters();
                setNote(
                  placed > 0
                    ? `Added ${placed} counter${placed === 1 ? "" : "s"}. Drag to match your plan.`
                    : "Name a space “Kitchen” first, then try again.",
                );
              }}
              data-testid="place-kitchen-counters"
              className="w-full rounded-md border border-dashed border-slate-300 px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50"
            >
              Place counters in kitchens
            </button>
            <button
              type="button"
              onClick={() => {
                const { placed } = placeToiletFixtures();
                setNote(
                  placed > 0
                    ? `Added ${placed} toilet${placed === 1 ? "" : "s"}. Drag to match your plan.`
                    : "Name a space “Toilet” or “Bathroom” first, then try again.",
                );
              }}
              data-testid="place-toilets"
              className="w-full rounded-md border border-dashed border-slate-300 px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50"
            >
              Place toilets in bathrooms
            </button>
            <button
              type="button"
              onClick={addStaircase}
              data-testid="add-staircase"
              className="w-full rounded-md border border-dashed border-slate-300 px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50"
            >
              Add staircase
            </button>
          </div>
          {note && <p className="mt-1.5 text-[11px] text-slate-500">{note}</p>}

          {furnitureCount > 0 && (
            <p className="mt-2 text-[11px] text-slate-400">
              {furnitureCount} item{furnitureCount === 1 ? "" : "s"} placed.
              Click one to move, rotate, or delete it.
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}
