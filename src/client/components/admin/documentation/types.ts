export interface DocCategory {
  id: number;
  event_id: number;
  ordinal: number;
  name: string;
  weight: number;
  max_score: number;
}

export interface GlobalCategory {
  id: number;
  name: string;
  weight: number;
  max_score: number;
}

export interface DocSubScore {
  category_id: number;
  category_name: string;
  ordinal: number;
  max_score: number;
  weight: number;
  score: number;
}

export interface DocScore {
  id: number;
  event_id: number;
  team_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  overall_score: number | null;
  scored_at: string | null;
  sub_scores?: DocSubScore[];
}

export interface Team {
  id: number;
  event_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface CategoryFormData {
  ordinal: string;
  name: string;
  weight: string;
  max_score: string;
}

export const defaultCategoryForm: CategoryFormData = {
  ordinal: '1',
  name: '',
  weight: '1',
  max_score: '',
};
