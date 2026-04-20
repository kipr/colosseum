export interface BracketFormData {
  name: string;
  bracket_size: number;
  actual_team_count: string;
  weight: string;
}

export interface CreateModalTeam {
  id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface CreateModalScore {
  team_id: number;
  round_number: number;
  score: number | null;
  team_number: number;
  team_name: string;
}

export interface CreateModalRanking {
  team_id: number;
  seed_average: number | null;
  seed_rank: number | null;
  raw_seed_score: number | null;
  team_number: number;
  team_name: string;
}

export interface AssignedTeam {
  team_id: number;
  team_number: number;
  team_name: string;
  bracket_id: number;
  bracket_name: string;
}

export interface BracketCreateMatrixRow {
  team: CreateModalTeam;
  scoreMap: Map<number, number | null>;
  ranking: CreateModalRanking | undefined;
  assigned: AssignedTeam | undefined;
  hasOverlap: boolean;
}

export const BRACKET_SIZES = [4, 8, 16, 32, 64];

export const defaultFormData: BracketFormData = {
  name: '',
  bracket_size: 8,
  actual_team_count: '',
  weight: '1',
};

export function nextPowerOfTwo(n: number): number {
  if (n <= 0) return 4;
  const p = Math.pow(2, Math.ceil(Math.log2(n)));
  return Math.max(4, Math.min(64, p));
}
