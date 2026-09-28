export const ALLOWED_HEIGHTS_MM = [35, 45, 55] as const;
export const ALLOWED_HOLE_DIAMETERS_MM = [3.0, 3.2, 3.4, 3.6] as const;

export const DEFAULT_HEIGHT_MM = 45;
export const DEFAULT_HOLE_DIAMETER_MM = 3.2;
export const MAX_ROWS = 30;
export const MAX_CHARACTERS_PER_ROW = 20;
export const MAX_INPUT_BYTES = 10 * 1024;

export type AllowedHeightMm = (typeof ALLOWED_HEIGHTS_MM)[number];
export type AllowedHoleDiameterMm = (typeof ALLOWED_HOLE_DIAMETERS_MM)[number];

export type InputErrorCode =
  | 'INPUT_TYPE'
  | 'INPUT_EMPTY'
  | 'INPUT_TOO_LARGE'
  | 'TOO_MANY_ROWS'
  | 'EMPTY_LINE'
  | 'TOO_MANY_CHARACTERS'
  | 'UNSUPPORTED_CHARACTER'
  | 'INVALID_HEIGHT'
  | 'INVALID_HOLE_DIAMETER';

export interface InputError {
  row: number | null;
  code: InputErrorCode;
  message: string;
  character?: string;
  column?: number;
}

export interface InputRow {
  row: number;
  originalText: string;
  normalizedText: string;
  errors: InputError[];
}

export interface InputOptions {
  heightMm?: unknown;
  holeDiameterMm?: unknown;
}

export interface InputParameters {
  requested: {
    heightMm: unknown;
    holeDiameterMm: unknown;
  };
  selected: {
    heightMm: AllowedHeightMm | null;
    holeDiameterMm: AllowedHoleDiameterMm | null;
  };
}

export interface InputValidationResult {
  rows: InputRow[];
  parameters: InputParameters;
  errors: InputError[];
  valid: boolean;
}

const ALLOWED_CHARACTER = /^[A-Z0-9 -]$/;
const ASCII_LOWERCASE = /^[a-z]$/;

function normalizeText(value: string): string {
  const uppercased = Array.from(value, (character) => {
    if (ASCII_LOWERCASE.test(character)) {
      return character.toUpperCase();
    }

    const uppercaseCharacter = character.toUpperCase();

    // Preserve any Unicode character whose uppercase form contains permitted ASCII.
    // It must remain identifiable so the validation error can point to the original character.
    return Array.from(uppercaseCharacter).some((uppercasePart) => /^[A-Z]$/.test(uppercasePart))
      ? character
      : uppercaseCharacter;
  }).join('');

  return uppercased.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ');
}

function isAllowedHeight(value: unknown): value is AllowedHeightMm {
  return typeof value === 'number' && ALLOWED_HEIGHTS_MM.includes(value as AllowedHeightMm);
}

function isAllowedHoleDiameter(value: unknown): value is AllowedHoleDiameterMm {
  return (
    typeof value === 'number' &&
    ALLOWED_HOLE_DIAMETERS_MM.includes(value as AllowedHoleDiameterMm)
  );
}

function invalidParameterError(
  code: 'INVALID_HEIGHT' | 'INVALID_HOLE_DIAMETER',
  value: unknown,
): InputError {
  const expected =
    code === 'INVALID_HEIGHT'
      ? ALLOWED_HEIGHTS_MM.join(', ')
      : ALLOWED_HOLE_DIAMETERS_MM.map((diameter) => diameter.toFixed(1)).join(', ');
  const label = code === 'INVALID_HEIGHT' ? 'Height' : 'Hole diameter';

  return {
    row: null,
    code,
    message: `${label} must be one of: ${expected} mm. Received: ${String(value)}.`,
  };
}

function validateRow(originalText: string, row: number): InputRow {
  const normalizedText = normalizeText(originalText);
  const errors: InputError[] = [];

  if (normalizedText.length === 0) {
    errors.push({
      row,
      code: 'EMPTY_LINE',
      message: `Row ${row} must contain text after normalizing spaces.`,
    });
  }

  const characters = Array.from(normalizedText);

  if (characters.length > MAX_CHARACTERS_PER_ROW) {
    errors.push({
      row,
      code: 'TOO_MANY_CHARACTERS',
      message: `Row ${row} has ${characters.length} characters after normalization; the maximum is ${MAX_CHARACTERS_PER_ROW}.`,
    });
  }

  characters.forEach((character, index) => {
    if (!ALLOWED_CHARACTER.test(character)) {
      errors.push({
        row,
        code: 'UNSUPPORTED_CHARACTER',
        character,
        column: index + 1,
        message: `Row ${row}, character ${index + 1} (${JSON.stringify(character)}) is not allowed. Use A-Z, 0-9, spaces, or hyphens.`,
      });
    }
  });

  return { row, originalText, normalizedText, errors };
}

export function validateInput(input: unknown, options: InputOptions = {}): InputValidationResult {
  const requestedHeightMm = options.heightMm ?? DEFAULT_HEIGHT_MM;
  const requestedHoleDiameterMm = options.holeDiameterMm ?? DEFAULT_HOLE_DIAMETER_MM;
  const errors: InputError[] = [];
  const parameters: InputParameters = {
    requested: {
      heightMm: requestedHeightMm,
      holeDiameterMm: requestedHoleDiameterMm,
    },
    selected: {
      heightMm: isAllowedHeight(requestedHeightMm) ? requestedHeightMm : null,
      holeDiameterMm: isAllowedHoleDiameter(requestedHoleDiameterMm)
        ? requestedHoleDiameterMm
        : null,
    },
  };

  if (!isAllowedHeight(requestedHeightMm)) {
    errors.push(invalidParameterError('INVALID_HEIGHT', requestedHeightMm));
  }

  if (!isAllowedHoleDiameter(requestedHoleDiameterMm)) {
    errors.push(invalidParameterError('INVALID_HOLE_DIAMETER', requestedHoleDiameterMm));
  }

  if (typeof input !== 'string') {
    errors.push({
      row: null,
      code: 'INPUT_TYPE',
      message: 'Text input must be a string. Files and HTML objects are not accepted.',
    });

    return { rows: [], parameters, errors, valid: false };
  }

  const inputBytes = new TextEncoder().encode(input).byteLength;
  if (inputBytes > MAX_INPUT_BYTES) {
    errors.push({
      row: null,
      code: 'INPUT_TOO_LARGE',
      message: `Input is ${inputBytes} bytes; the maximum is ${MAX_INPUT_BYTES} bytes.`,
    });
  }

  if (input.length === 0) {
    errors.push({
      row: null,
      code: 'INPUT_EMPTY',
      message: 'Enter between 1 and 30 non-empty lines.',
    });
  }

  const rows = input.split(/\r\n|\r|\n/).map((originalText, index) => validateRow(originalText, index + 1));

  if (rows.length > MAX_ROWS) {
    errors.push({
      row: null,
      code: 'TOO_MANY_ROWS',
      message: `Input has ${rows.length} rows; the maximum is ${MAX_ROWS}.`,
    });
  }

  const rowErrors = rows.flatMap((row) => row.errors);
  return {
    rows,
    parameters,
    errors: [...errors, ...rowErrors],
    valid: errors.length === 0 && rowErrors.length === 0,
  };
}
