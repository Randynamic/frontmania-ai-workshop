import { readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import { TalkId } from '../schemas/talk.js';
import { readJsonFile } from './json-file.js';
import { DATA_PATHS } from './paths.js';

/**
 * Contract for data/cvs/profiles/*.json. The exercise-1 Profile schema the
 * participant completes must agree with these bounds (outline: stack max 10,
 * interests max 8, avoid max 5, seniority junior|medior|senior|lead, and no
 * name, employer or contact field).
 */
export const SENIORITY = ['junior', 'medior', 'senior', 'lead'] as const;
export const PROFILE_BOUNDS = { stack: 10, interests: 8, avoid: 5 } as const;
export const IDENTITY_KEYS = ['name', 'email', 'phone', 'employer', 'company'] as const;

export const PersonaProfile = z
  .object({
    role: z.string().min(1),
    seniority: z.enum(SENIORITY),
    stack: z.array(z.string().min(1)).max(PROFILE_BOUNDS.stack),
    interests: z.array(z.string().min(1)).max(PROFILE_BOUNDS.interests),
    avoid: z.array(z.string().min(1)).max(PROFILE_BOUNDS.avoid),
  })
  .strict();
export type PersonaProfile = z.infer<typeof PersonaProfile>;

const PicksBySlot = z.object({ '14:15': TalkId, '15:30': TalkId, '16:30': TalkId }).strict();

export const PersonaLabel = z.object({
  persona: z.string().regex(/^0[1-5]-[a-z0-9-]+$/),
  picks: PicksBySlot,
  fixturePicks: PicksBySlot,
});
export type PersonaLabel = z.infer<typeof PersonaLabel>;

export const LabelsFile = z.object({
  note: z.string().min(1),
  labels: z.array(PersonaLabel).min(1),
});
export type LabelsFile = z.infer<typeof LabelsFile>;

export const loadLabels = (path: string = DATA_PATHS.labels): LabelsFile =>
  readJsonFile(path, LabelsFile);

export interface Persona {
  readonly name: string;
  readonly cvPath: string;
  readonly profilePath: string;
  readonly profile: PersonaProfile;
}

const isPersonaCv = (file: string): boolean => /^0[1-5]-[a-z0-9-]+\.md$/.test(file);

/** Every persona CV under data/cvs with its committed profile. */
export const loadPersonas = (cvsDir: string = DATA_PATHS.cvsDir): readonly Persona[] =>
  readdirSync(cvsDir)
    .filter(isPersonaCv)
    .sort()
    .map((file) => {
      const name = basename(file, '.md');
      const profilePath = resolve(cvsDir, 'profiles', `${name}.json`);
      return {
        name,
        cvPath: resolve(cvsDir, file),
        profilePath,
        profile: readJsonFile(profilePath, PersonaProfile),
      };
    });
