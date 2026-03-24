export interface ParsedDocRow {
  team_number: number;
  scores: number[];
}

export interface BulkImportCategory {
  id: number;
}

export interface BulkImportSubScore {
  category_id: number;
  score: number;
}

export function parseDocScoresText(
  text: string,
  categoryCount: number,
): { rows: ParsedDocRow[]; errors: string[] } {
  const lines = text
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const rows: ParsedDocRow[] = [];
  const errors: string[] = [];
  const expectedCols = 1 + categoryCount;

  let startIndex = 0;
  if (lines.length > 0) {
    const first = lines[0];
    const delim = first.includes('\t') ? '\t' : ',';
    const firstParts = first.split(delim).map((p) => p.trim());
    const firstCol = firstParts[0];
    if (
      firstCol &&
      firstCol.length > 0 &&
      !/^\d+$/.test(firstCol) &&
      Number.isNaN(parseInt(firstCol, 10))
    ) {
      startIndex = 1;
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const delim = line.includes('\t') ? '\t' : ',';
    const parts = line.split(delim).map((p) => p.trim());

    if (parts.length !== expectedCols) {
      errors.push(
        `Line ${i + 1}: Expected ${expectedCols} columns, got ${parts.length}`,
      );
      continue;
    }

    const teamNumber = parseInt(parts[0], 10);
    if (Number.isNaN(teamNumber) || teamNumber <= 0) {
      errors.push(`Line ${i + 1}: Invalid team number "${parts[0]}"`);
      continue;
    }

    const scores: number[] = [];
    let rowError = false;
    for (let c = 1; c < parts.length; c++) {
      const val = parseFloat(parts[c]);
      if (!Number.isFinite(val) || val < 0) {
        errors.push(`Line ${i + 1}, col ${c + 1}: Invalid score "${parts[c]}"`);
        rowError = true;
        break;
      }
      scores.push(val);
    }
    if (!rowError) {
      rows.push({ team_number: teamNumber, scores });
    }
  }

  return { rows, errors };
}

export function buildBulkImportSubScores(params: {
  categories: BulkImportCategory[];
  rowScores: number[];
  selectedCategoryId: number | null;
  existingSubScores?: BulkImportSubScore[];
}): BulkImportSubScore[] {
  const { categories, rowScores, selectedCategoryId, existingSubScores } =
    params;

  if (selectedCategoryId == null) {
    return categories.map((cat, idx) => ({
      category_id: cat.id,
      score: rowScores[idx] ?? 0,
    }));
  }

  const mergedScores = new Map<number, number>(
    (existingSubScores ?? []).map((subScore) => [
      subScore.category_id,
      subScore.score,
    ]),
  );
  mergedScores.set(selectedCategoryId, rowScores[0] ?? 0);

  return categories.flatMap((cat) => {
    const score = mergedScores.get(cat.id);
    return score == null ? [] : [{ category_id: cat.id, score }];
  });
}
