/**
 * Catalog of draggable items. Flat for now — when we have enough verticals
 * to need grouping (wardrobes, kitchens, freestanding furniture) this becomes
 * a `{ category: items[] }` shape.
 *
 * Each entry knows three things:
 *   1. How to render itself in the sidebar (label + SVG icon).
 *   2. Its default size in millimetres — used by the drag ghost so the
 *      user sees the part at real-scale before releasing.
 *   3. How to emit a snippet of source code, given a drop world position
 *      in millimetres. The snippet is appended via the existing
 *      `applyEdit({ kind: 'append', code })` path so the new node lands as
 *      a top-level call with `position: [x, y, z]`.
 *
 * The `code` callback returns the FULL statement to append, ending with
 * a newline so subsequent appends don't pile onto the same line.
 */

import type { ComponentType, SVGProps } from 'react';

export interface CatalogItem {
  readonly id: string;
  readonly label: string;
  readonly nodeType: 'cabinet' | 'panel' | 'shelf' | 'door' | 'drawer';
  /** Default footprint [w, h, d] in mm — used to size the drag ghost. */
  readonly defaultSize: readonly [number, number, number];
  /**
   * Drop offset: where the item's centre sits relative to the cursor's
   * floor projection. A cabinet centres at (x, 0, z) because the cabinet's
   * `position` is its centre and we want it to sit on the floor. A door
   * (1798mm tall) centres at (x, height/2, z) so its bottom is on the floor.
   */
  readonly dropAnchor: 'floorPivot' | 'centreOnFloor';
  /** Generate the source snippet to append for a drop at world (x, y, z) in mm. */
  readonly code: (x: number, y: number, z: number) => string;
  /**
   * Snippet to insert into a cabinet's `children: [...]` array when the
   * drop landed on a cabinet (adoption path). Cabinet-floor-relative `y` —
   * the cursor's world y minus the parent cabinet's floor y, clamped to
   * the interior. Returns null for items that can't be adopted (cabinets,
   * panels) — the drop falls back to the top-level `code` path.
   */
  readonly childCode: ((cabRelY: number) => string) | null;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

// ─── Icons ────────────────────────────────────────────────────────────────

const stroke = '#c9a26a';

const CabinetIcon: CatalogItem['Icon'] = (props) => (
  <svg viewBox="0 0 32 32" fill="none" stroke={stroke} strokeWidth="1.5" {...props}>
    <rect x="6" y="3" width="20" height="26" rx="0.5" />
    <line x1="16" y1="3" x2="16" y2="29" />
    <circle cx="13" cy="16" r="0.6" fill={stroke} />
    <circle cx="19" cy="16" r="0.6" fill={stroke} />
  </svg>
);

const PanelIcon: CatalogItem['Icon'] = (props) => (
  <svg viewBox="0 0 32 32" fill="none" stroke={stroke} strokeWidth="1.5" {...props}>
    <rect x="10" y="4" width="12" height="24" rx="0.5" />
  </svg>
);

const ShelfIcon: CatalogItem['Icon'] = (props) => (
  <svg viewBox="0 0 32 32" fill="none" stroke={stroke} strokeWidth="1.5" {...props}>
    <rect x="4" y="14" width="24" height="4" rx="0.5" />
    <line x1="4" y1="22" x2="4" y2="26" strokeDasharray="1 2" />
    <line x1="28" y1="22" x2="28" y2="26" strokeDasharray="1 2" />
  </svg>
);

const DoorIcon: CatalogItem['Icon'] = (props) => (
  <svg viewBox="0 0 32 32" fill="none" stroke={stroke} strokeWidth="1.5" {...props}>
    <rect x="10" y="3" width="12" height="26" rx="0.5" />
    <circle cx="19" cy="16" r="0.6" fill={stroke} />
  </svg>
);

const DrawerIcon: CatalogItem['Icon'] = (props) => (
  <svg viewBox="0 0 32 32" fill="none" stroke={stroke} strokeWidth="1.5" {...props}>
    <rect x="4" y="11" width="24" height="10" rx="0.5" />
    <line x1="13" y1="16" x2="19" y2="16" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// ─── Items ────────────────────────────────────────────────────────────────

export const CATALOG_ITEMS: readonly CatalogItem[] = [
  {
    id: 'cabinet-800',
    label: 'Cabinet',
    nodeType: 'cabinet',
    defaultSize: [800, 1800, 400],
    dropAnchor: 'floorPivot',
    // Empty `children: []` makes the cabinet immediately able to adopt the
    // next dropped shelf/door/drawer — the AST helper just inserts into it.
    code: (x, y, z) =>
      `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [${round1(x)}, ${round1(y)}, ${round1(z)}], children: [] });\n`,
    childCode: null, // cabinets aren't adoptable in v1
    Icon: CabinetIcon,
  },
  {
    id: 'panel-600',
    label: 'Panel',
    nodeType: 'panel',
    defaultSize: [600, 1200, 18],
    dropAnchor: 'centreOnFloor',
    code: (x, y, z) =>
      `api.panel({ width: 600, height: 1200, thickness: 18, position: [${round1(x)}, ${round1(y)}, ${round1(z)}] });\n`,
    childCode: null, // standalone panels don't have natural interior semantics in v1
    Icon: PanelIcon,
  },
  {
    id: 'shelf',
    label: 'Shelf',
    nodeType: 'shelf',
    defaultSize: [600, 18, 300],
    dropAnchor: 'centreOnFloor',
    code: (x, y, z) =>
      `api.shelf({ y: ${round1(y)}, position: [${round1(x)}, ${round1(y)}, ${round1(z)}] });\n`,
    childCode: (cabRelY) => `api.shelf({ y: ${round1(cabRelY)} })`,
    Icon: ShelfIcon,
  },
  {
    id: 'door',
    label: 'Door',
    nodeType: 'door',
    defaultSize: [798, 1798, 18],
    dropAnchor: 'centreOnFloor',
    code: (x, y, z) =>
      `api.door({ side: 'full', position: [${round1(x)}, ${round1(y)}, ${round1(z)}] });\n`,
    // Doors don't carry a `y` field — `side` controls placement. Adoption
    // just emits the side; the cabinet's frame geometry handles the rest.
    childCode: () => `api.door({ side: 'full' })`,
    Icon: DoorIcon,
  },
  {
    id: 'drawer',
    label: 'Drawer',
    nodeType: 'drawer',
    defaultSize: [400, 200, 300],
    dropAnchor: 'centreOnFloor',
    code: (x, y, z) =>
      `api.drawer({ y: ${round1(y)}, height: 200, position: [${round1(x)}, ${round1(y)}, ${round1(z)}] });\n`,
    childCode: (cabRelY) => `api.drawer({ y: ${round1(cabRelY)}, height: 200 })`,
    Icon: DrawerIcon,
  },
];

/**
 * Given a catalog item and the cursor's floor-plane intersection (mm), where
 * should the part centre go? `floorPivot` means the part's `position` IS the
 * floor point (its frame is built UP from there — cabinet); `centreOnFloor`
 * means we shift Y up by half the height so the part sits on the floor at
 * the cursor.
 */
export function dropCentre(item: CatalogItem, floorX: number, floorZ: number): [number, number, number] {
  if (item.dropAnchor === 'floorPivot') return [floorX, 0, floorZ];
  const [, h] = item.defaultSize;
  return [floorX, h / 2, floorZ];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
