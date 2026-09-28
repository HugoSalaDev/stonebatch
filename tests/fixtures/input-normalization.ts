import { MAX_INPUT_BYTES } from '../../src/lib/input/normalize';

export const validSingleRow = 'ANNA';
export const validTwoRows = 'ANNA\n23';
export const maximumRows = Array.from({ length: 30 }, (_, index) => `ROW-${index + 1}`).join('\n');
export const tooManyRows = Array.from({ length: 31 }, (_, index) => `ROW-${index + 1}`).join('\n');
export const exactlyTwentyCharacters = 'ABCDEFGHIJKLMNOPQRST';
export const twentyOneCharacters = 'ABCDEFGHIJKLMNOPQRSTU';
export const overTenKilobytes = 'A'.repeat(MAX_INPUT_BYTES + 1);
