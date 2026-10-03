import schemaV02 from '../../schemas/v0.2/manifest.json' with { type: 'json' };
import schemaV03 from '../../schemas/v0.3/manifest.json' with { type: 'json' };

export const CURRENT_SPEC_VERSION = 'agentmanifest-0.3';

export const SCHEMAS: Record<string, object> = {
  'agentmanifest-0.2': schemaV02,
  'agentmanifest-0.3': schemaV03,
};
