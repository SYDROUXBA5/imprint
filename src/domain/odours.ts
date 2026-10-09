export type OdourGroup = 'narcotics' | 'explosives';

export interface Odour {
  id: string;
  name: string;
  group: OdourGroup;
}

export const ODOURS: readonly Odour[] = [
  { id: 'cocaine', name: 'Cocaine', group: 'narcotics' },
  { id: 'heroin', name: 'Heroin', group: 'narcotics' },
  { id: 'methamphetamine', name: 'Methamphetamine', group: 'narcotics' },
  { id: 'mdma', name: 'MDMA', group: 'narcotics' },
  { id: 'cannabis', name: 'Cannabis', group: 'narcotics' },
  { id: 'fentanyl', name: 'Fentanyl', group: 'narcotics' },
  { id: 'tnt', name: 'TNT', group: 'explosives' },
  { id: 'c4-rdx', name: 'C4/RDX', group: 'explosives' },
  { id: 'petn', name: 'PETN', group: 'explosives' },
  { id: 'semtex', name: 'Semtex', group: 'explosives' },
  { id: 'black-powder', name: 'Black powder', group: 'explosives' },
  { id: 'smokeless-powder', name: 'Smokeless powder', group: 'explosives' },
  { id: 'ammonium-nitrate', name: 'Ammonium nitrate', group: 'explosives' },
  { id: 'det-cord', name: 'Det cord', group: 'explosives' },
  { id: 'dynamite', name: 'Dynamite', group: 'explosives' },
  { id: 'tatp', name: 'TATP', group: 'explosives' },
  { id: 'hmtd', name: 'HMTD', group: 'explosives' },
];

export const odoursIn = (group: OdourGroup): Odour[] =>
  ODOURS.filter((o) => o.group === group);

export const odourById = (id: string): Odour | undefined =>
  ODOURS.find((o) => o.id === id);
