import AjvModule from 'ajv';
import addFormatsModule from 'ajv-formats';

const Ajv = AjvModule.default ?? AjvModule;
const addFormats = addFormatsModule.default ?? addFormatsModule;
import { CURRENT_SPEC_VERSION, SCHEMAS } from './schemas.js';
import type { SyntaxValidationResult } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators = Object.fromEntries(
  Object.entries(SCHEMAS).map(([version, schema]) => [version, ajv.compile(schema)])
);

const SUPPORTED = Object.keys(SCHEMAS);

function parseManifestInput(input: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Invalid JSON string: ${(err as Error).message}`);
    }
  }
  return input;
}

export function validateManifestSyntax(manifestInput: string | Record<string, unknown>): SyntaxValidationResult {
  const manifest = parseManifestInput(manifestInput);
  const specVersion =
    typeof manifest.spec_version === 'string' ? manifest.spec_version : null;

  const version =
    specVersion && validators[specVersion] ? specVersion : CURRENT_SPEC_VERSION;
  const validate = validators[version];
  const valid = validate(manifest);

  if (!valid) {
    const errors =
      validate.errors?.map((e: { instancePath?: string; message?: string }) => {
        const path = e.instancePath || '/';
        return `${path} ${e.message ?? 'invalid'}`.trim();
      }) ?? ['Unknown schema error'];

    if (specVersion && !SUPPORTED.includes(specVersion)) {
      errors.unshift(
        `Unsupported spec_version "${specVersion}". Supported: ${SUPPORTED.join(', ')}.`
      );
    }

    return {
      valid: false,
      spec_version: specVersion,
      schema_checked: version,
      errors,
      success_token: null,
    };
  }

  const token = `amp-schema-valid:${version}:${typeof manifest.name === 'string' ? manifest.name : 'unknown'}`;

  return {
    valid: true,
    spec_version: specVersion ?? version,
    schema_checked: version,
    errors: [],
    success_token: token,
  };
}
