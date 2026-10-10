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

export const PURPOSES: readonly { id: Purpose; label: string }[] = [
  { id: 'single', label: 'Single purpose' },
  { id: 'dual', label: 'Dual purpose' },
];

export const isBreedId = (v: unknown): v is BreedId => BREEDS.some((b) => b.id === v);
export const isPurpose = (v: unknown): v is Purpose => PURPOSES.some((p) => p.id === v);

export const breedLabel = (id: BreedId): string => BREEDS.find((b) => b.id === id)?.label ?? id;
export const purposeLabel = (id: Purpose): string => PURPOSES.find((p) => p.id === id)?.label ?? id;
