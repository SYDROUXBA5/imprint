import type { BreedId, Purpose } from './types';

/** Spec §13.3. The ids are stored on the dog (and checked by the database); the labels are for people. */
export const BREEDS: readonly { id: BreedId; label: string }[] = [
  { id: 'malinois', label: 'Malinois' },
  { id: 'german-shepherd', label: 'German Shepherd' },
  { id: 'dutch-shepherd', label: 'Dutch Shepherd' },
  { id: 'labrador', label: 'Labrador' },
  { id: 'golden-retriever', label: 'Golden Retriever' },
  { id: 'bloodhound', label: 'Bloodhound' },
  { id: 'hound', label: 'Hound' },
  { id: 'springer-spaniel', label: 'Springer Spaniel' },
  { id: 'other', label: 'Other' },
];

/**
 * Where each drawing's nose is, as percentages of the square image (from its top-left corner). The scent
 * wisps in BreedPortrait drift in to this point. All nine drawings are side profiles facing left.
 */
export const BREED_NOSES: Readonly<Record<BreedId, { readonly x: number; readonly y: number }>> = {
  'malinois': { x: 6.9, y: 41.5 },
  'german-shepherd': { x: 6.9, y: 38.3 },
  'dutch-shepherd': { x: 6.9, y: 37.2 },
  'labrador': { x: 6.9, y: 28.8 },
  'golden-retriever': { x: 6.8, y: 26.1 },
  'bloodhound': { x: 6.8, y: 31.7 },
  'hound': { x: 6.9, y: 30.1 },
  'springer-spaniel': { x: 6.8, y: 29.5 },
  'other': { x: 6.9, y: 33.9 },
};

export const PURPOSES: readonly { id: Purpose; label: string }[] = [
  { id: 'single', label: 'Single purpose' },
  { id: 'dual', label: 'Dual purpose' },
];

export const isBreedId = (v: unknown): v is BreedId => BREEDS.some((b) => b.id === v);
export const isPurpose = (v: unknown): v is Purpose => PURPOSES.some((p) => p.id === v);

export const breedLabel = (id: BreedId): string => BREEDS.find((b) => b.id === id)?.label ?? id;
export const purposeLabel = (id: Purpose): string => PURPOSES.find((p) => p.id === id)?.label ?? id;
