/**
 * Туман войны (Этап 3): что игрок видит на карте системы.
 * Своя планета — всё; чужая — только астрономические данные,
 * пока туда не слетает зонд. Данные скана «стареют» и остаются снимком.
 */
import type { BuildingLevels } from './rules.js';
import type { ShipCounts } from './ships.js';

export type PlanetVisibility = 'OWN' | 'SCANNED' | 'UNKNOWN';

/** Снимок планеты, который зонд сохраняет в PlanetScan.data. */
export interface ScanPayload {
  owner: string | null;
  colonized: boolean;
  richness: { metal: number; crystal: number; deuterium: number; energy: number; antimatter: number };
  buildings: BuildingLevels | null;
  resources: { metal: number; crystal: number; deuterium: number; antimatter: number } | null;
  fleet: ShipCounts | null;
}

export interface PlanetView {
  planetId: string;
  name: string;
  position: number;
  type: string;
  size: number;
  visibility: PlanetVisibility;
  /** null — неизвестно (планета не разведана). */
  colonized: boolean | null;
  owner: string | null;
  isOwn: boolean;
  richness: ScanPayload['richness'] | null;
  buildings: BuildingLevels | null;
  resources: ScanPayload['resources'] | null;
  fleet: ShipCounts | null;
  /** Возраст данных разведки в секундах. */
  scanAgeSeconds: number | null;
}

interface PlanetFacts {
  planetId: string;
  name: string;
  position: number;
  type: string;
  size: number;
}

/** Своя планета: видно всё и в реальном времени. */
export function ownPlanetView(facts: PlanetFacts, payload: ScanPayload): PlanetView {
  return {
    ...facts,
    visibility: 'OWN',
    colonized: true,
    owner: payload.owner,
    isOwn: true,
    richness: payload.richness,
    buildings: payload.buildings,
    resources: payload.resources,
    fleet: payload.fleet,
    scanAgeSeconds: 0,
  };
}

/** Чужая планета: данные только из последнего скана, иначе — пусто. */
export function foreignPlanetView(
  facts: PlanetFacts,
  scan: { data: ScanPayload; scannedAt: Date } | null,
  now: number,
): PlanetView {
  if (!scan) {
    return {
      ...facts,
      visibility: 'UNKNOWN',
      colonized: null,
      owner: null,
      isOwn: false,
      richness: null,
      buildings: null,
      resources: null,
      fleet: null,
      scanAgeSeconds: null,
    };
  }

  return {
    ...facts,
    visibility: 'SCANNED',
    colonized: scan.data.colonized,
    owner: scan.data.owner,
    isOwn: false,
    richness: scan.data.richness,
    buildings: scan.data.buildings,
    resources: scan.data.resources,
    fleet: scan.data.fleet,
    scanAgeSeconds: Math.max(0, Math.round((now - scan.scannedAt.getTime()) / 1000)),
  };
}
