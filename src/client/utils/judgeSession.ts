import type { TemplateDetail } from '../api/templates';

export const CURRENT_TEMPLATE_STORAGE_KEY = 'currentTemplate';
export const JUDGE_SESSION_GENERATION_STORAGE_KEY = 'judgeSessionGeneration';

export const createJudgeSessionGeneration = () => crypto.randomUUID();

export function clearJudgeSessionStorage(): void {
  sessionStorage.removeItem(CURRENT_TEMPLATE_STORAGE_KEY);
  sessionStorage.removeItem(JUDGE_SESSION_GENERATION_STORAGE_KEY);
}

export function writeJudgeSession(
  template: TemplateDetail,
  generation: string,
): void {
  sessionStorage.setItem(
    CURRENT_TEMPLATE_STORAGE_KEY,
    JSON.stringify(template),
  );
  sessionStorage.setItem(JUDGE_SESSION_GENERATION_STORAGE_KEY, generation);
}

export function readStoredJudgeScoresheet(): {
  template: TemplateDetail;
  generation: string;
} | null {
  try {
    const template = JSON.parse(
      sessionStorage.getItem(CURRENT_TEMPLATE_STORAGE_KEY) ?? '',
    ) as TemplateDetail;
    const generation = sessionStorage.getItem(
      JUDGE_SESSION_GENERATION_STORAGE_KEY,
    );
    return template?.schema?.fields && generation
      ? { template, generation }
      : null;
  } catch {
    return null;
  }
}
