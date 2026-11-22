export type Id = string;
export type Scenario = 'current' | 'future';
export type Area = { id: Id; name: string; sortOrder: number; operationalCostPerPieceCurrent: string; operationalCostPerPieceFuture: string };
export type WorkElement = {
  id: Id; areaId: Id; name: string; sortOrder: number;
  current: { stationIndex: number; vaSeconds: string; nvaSeconds: string };
  future: { stationIndex: number; vaSeconds: string; nvaSeconds: string };
  ergonomicZone: 'green' | 'yellow' | 'red' | null; fixedEquipmentId: Id | null;
  validationStatus: 'hypothesis' | 'validated'; evidenceRef?: string | null;
};
export type EquipmentResource = { id: Id; name: string; currentStationIndex: number | null; futureStationIndex: number | null };
export type Study = {
  id: Id; version: number; name: string; productFamily: string;
  parameters: { shiftSeconds: string; demandPerShift: string; productiveDaysPerMonth: number; baselineUnitsPerDay: string; laborCostPerShiftCurrent: string; laborCostPerShiftFuture: string };
  stations: { current: number; future: number };
  areas: Area[]; elements: WorkElement[]; equipment: EquipmentResource[]; precedences: { predecessorId: Id; successorId: Id }[];
  status?: string;
};
export type OutboxItem = { id: string; studyId: Id; baseVersion: number; operations: Record<string, unknown>[]; createdAt: string };
