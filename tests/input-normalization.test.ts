import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEIGHT_MM,
  DEFAULT_HOLE_DIAMETER_MM,
  MAX_INPUT_BYTES,
  validateInput,
} from '../src/lib/input/normalize';
import {
  exactlyTwentyCharacters,
  maximumRows,
  overTenKilobytes,
  tooManyRows,
  twentyOneCharacters,
  validSingleRow,
  validTwoRows,
} from './fixtures/input-normalization';

function errorCodes(result: ReturnType<typeof validateInput>) {
  return result.errors.map((error) => error.code);
}

describe('validateInput', () => {
  it('accepts one row and applies the default parameters', () => {
    const result = validateInput(validSingleRow);

    expect(result.valid).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ originalText: 'ANNA', normalizedText: 'ANNA', errors: [] });
    expect(result.parameters).toEqual({
      requested: { heightMm: DEFAULT_HEIGHT_MM, holeDiameterMm: DEFAULT_HOLE_DIAMETER_MM },
      selected: { heightMm: 45, holeDiameterMm: 3.2 },
    });
  });

  it('accepts two rows and keeps their order', () => {
    const result = validateInput(validTwoRows);

    expect(result.valid).toBe(true);
    expect(result.rows.map((row) => row.normalizedText)).toEqual(['ANNA', '23']);
  });

  it('accepts 30 rows and rejects 31 without discarding rows', () => {
    expect(validateInput(maximumRows).valid).toBe(true);

    const result = validateInput(tooManyRows);
    expect(result.rows).toHaveLength(31);
    expect(errorCodes(result)).toContain('TOO_MANY_ROWS');
    expect(result.rows[30].normalizedText).toBe('ROW-31');
  });

  it('accepts 20 normalized characters and rejects 21', () => {
    expect(validateInput(exactlyTwentyCharacters).valid).toBe(true);

    const result = validateInput(twentyOneCharacters);
    expect(result.rows[0].normalizedText).toBe(twentyOneCharacters);
    expect(errorCodes(result)).toContain('TOO_MANY_CHARACTERS');
  });

  it('normalizes visible casing and only the allowed whitespace transformations', () => {
    const result = validateInput('  anna   maria-2  ');

    expect(result.valid).toBe(true);
    expect(result.rows[0]).toMatchObject({
      originalText: '  anna   maria-2  ',
      normalizedText: 'ANNA MARIA-2',
    });
  });

  it('keeps duplicate rows and original order', () => {
    const result = validateInput('anna\nANNA\nanna');

    expect(result.valid).toBe(true);
    expect(result.rows.map((row) => row.originalText)).toEqual(['anna', 'ANNA', 'anna']);
    expect(result.rows.map((row) => row.normalizedText)).toEqual(['ANNA', 'ANNA', 'ANNA']);
  });

  it('rejects empty input and preserves blank rows for correction', () => {
    const result = validateInput('');

    expect(errorCodes(result)).toEqual(expect.arrayContaining(['INPUT_EMPTY', 'EMPTY_LINE']));
    expect(result.rows).toEqual([
      expect.objectContaining({ row: 1, originalText: '', normalizedText: '' }),
    ]);
  });

  it.each([
    ['Ñ', 'Ñ'],
    ['José', 'JOSÉ'],
    ['NIÑO', 'NIÑO'],
    ['ANNA 😀', 'ANNA 😀'],
    ['<script>', '<SCRIPT>'],
  ])('rejects unsupported input %s without transliterating or deleting it', (input, normalizedText) => {
    const result = validateInput(input);
    const unsupported = result.rows[0].errors.filter((error) => error.code === 'UNSUPPORTED_CHARACTER');

    expect(result.rows[0].normalizedText).toBe(normalizedText);
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported.every((error) => error.row === 1 && error.character && error.column)).toBe(true);
  });

  it.each(['ı', 'ſ', 'ß'])('does not normalize Unicode %s into permitted ASCII', (input) => {
    const result = validateInput(input);

    expect(result.valid).toBe(false);
    expect(result.rows[0].normalizedText).toBe(input);
    expect(result.rows[0].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNSUPPORTED_CHARACTER',
          character: input,
          row: 1,
          column: 1,
        }),
      ]),
    );
  });

  it('does not drop valid rows when another row is invalid', () => {
    const result = validateInput('ANNA\nJosé\nMIA');

    expect(result.rows.map((row) => row.normalizedText)).toEqual(['ANNA', 'JOSÉ', 'MIA']);
    expect(result.rows[1].errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNSUPPORTED_CHARACTER', character: 'É' })]),
    );
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[2].errors).toEqual([]);
  });

  it('rejects input larger than 10 KB without parsing a file or HTML object', () => {
    const tooLarge = validateInput(overTenKilobytes);
    const fileLike = validateInput({ name: 'names.txt', size: MAX_INPUT_BYTES + 1 });

    expect(errorCodes(tooLarge)).toContain('INPUT_TOO_LARGE');
    expect(errorCodes(fileLike)).toContain('INPUT_TYPE');
    expect(fileLike.rows).toEqual([]);
  });

  it.each([
    [35, 3.0],
    [45, 3.2],
    [55, 3.4],
    [35, 3.6],
  ])('accepts allowed height %d and hole diameter %f', (heightMm, holeDiameterMm) => {
    const result = validateInput('ANNA', { heightMm, holeDiameterMm });

    expect(result.valid).toBe(true);
    expect(result.parameters.selected).toEqual({ heightMm, holeDiameterMm });
  });

  it('rejects invalid parameter selections without replacing them', () => {
    const invalid = validateInput('ANNA', { heightMm: 40, holeDiameterMm: 3.1 });

    expect(invalid.parameters.requested).toEqual({ heightMm: 40, holeDiameterMm: 3.1 });
    expect(invalid.parameters.selected).toEqual({ heightMm: null, holeDiameterMm: null });
    expect(errorCodes(invalid)).toEqual(
      expect.arrayContaining(['INVALID_HEIGHT', 'INVALID_HOLE_DIAMETER']),
    );
  });
});
